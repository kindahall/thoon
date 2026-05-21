from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from execution.audit import ExecutionAuditError, audit_trail
from execution.binance_connector import ExchangeAPIError
from execution.kill_switch import KillSwitchActiveError, KillSwitchCommand, KillSwitchStatus
from execution.order_manager import (
    CancelOrderRequest,
    CancelOrderResponse,
    ExecutionError,
    ExecutionMode,
    ExecutionOrderResponse,
    ExchangeName,
    LIVE_CONFIRMATION_TEXT,
    LiveTradingDisabledError,
    OrderManager,
    PositionRecord,
    RiskRejectedError,
    TradeRequest,
)
from observability.metrics import record_kill_switch, record_position, record_risk_rejection, record_trade, record_zero_position

router = APIRouter(tags=["execution"])
order_manager = OrderManager()


class ExecutionCapabilities(BaseModel):
    supported_exchanges: list[ExchangeName]
    supported_modes: list[ExecutionMode]
    supported_order_types: list[str]
    default_mode: ExecutionMode
    live_trading_enabled: bool
    live_confirmation_required: bool
    live_confirmation_text: str
    credential_env_vars: dict[str, list[str]]
    exchange_market_type: dict[str, str]
    live_execution_supported: dict[str, bool]
    safety_endpoints: dict[str, str]


@router.get("/execution/capabilities", response_model=ExecutionCapabilities)
async def execution_capabilities() -> ExecutionCapabilities:
    return ExecutionCapabilities(
        supported_exchanges=["binance", "bybit", "bitget", "hyperliquid", "dydx"],
        supported_modes=["paper", "live"],
        supported_order_types=["MARKET", "LIMIT"],
        default_mode="paper",
        live_trading_enabled=order_manager.live_trading_enabled,
        live_confirmation_required=True,
        live_confirmation_text=LIVE_CONFIRMATION_TEXT,
        credential_env_vars={
            "binance": ["BINANCE_API_KEY", "BINANCE_API_SECRET"],
            "bybit": ["BYBIT_API_KEY", "BYBIT_API_SECRET"],
            "bitget": ["BITGET_API_KEY", "BITGET_API_SECRET", "BITGET_API_PASSPHRASE"],
            "hyperliquid": ["HYPERLIQUID_MAIN_WALLET_ADDRESS", "HYPERLIQUID_API_WALLET_PRIVATE_KEY", "HYPERLIQUID_VAULT_ADDRESS"],
            "dydx": ["DYDX_OWNER_ADDRESS", "DYDX_PERMISSIONED_PRIVATE_KEY", "DYDX_AUTHENTICATOR_ID", "DYDX_SUBACCOUNT_NUMBER"],
        },
        exchange_market_type={
            "binance": "spot",
            "bybit": "spot/linear",
            "bitget": "spot",
            "hyperliquid": "perpetual_dex",
            "dydx": "perpetual_dex",
        },
        live_execution_supported={
            "binance": True,
            "bybit": True,
            "bitget": True,
            "hyperliquid": False,
            "dydx": False,
        },
        safety_endpoints={
            "live_readiness": "/live-readiness/check",
            "kill_switch": "/kill-switch",
            "positions": "/positions",
            "trade": "/trade",
            "cancel": "/trade/cancel",
        },
    )


@router.post("/trade", response_model=ExecutionOrderResponse)
async def trade(request: TradeRequest) -> ExecutionOrderResponse:
    try:
        audit_trail.record(
            event_type="trade_request",
            status="received",
            exchange=request.exchange,
            symbol=request.symbol,
            mode="live" if request.live_trading else "paper",
            idempotency_key=request.client_order_id,
            payload=request.model_dump(mode="json", exclude={"live_confirmation"}),
        )
        response = await order_manager.place_order(request)
        audit_trail.record(
            event_type="trade_response",
            status=response.status,
            exchange=response.exchange,
            symbol=response.symbol,
            mode=response.mode,
            idempotency_key=response.client_order_id,
            payload=response.model_dump(mode="json"),
        )
        record_trade(response)
        if response.mode == "paper":
            records = await order_manager.get_open_positions(exchange=response.exchange, mode=response.mode, symbol=response.symbol)
            if records:
                for record in records:
                    record_position(record)
            else:
                record_zero_position(response.exchange, response.mode, response.symbol)
        return response
    except RiskRejectedError as error:
        audit_trail.record(
            event_type="trade_response",
            status="risk_rejected",
            exchange=request.exchange,
            symbol=request.symbol,
            mode="live" if request.live_trading else "paper",
            idempotency_key=request.client_order_id,
            payload={"error": str(error), "risk": error.risk.model_dump(mode="json")},
        )
        record_risk_rejection(error.risk.violations)
        raise HTTPException(status_code=400, detail={"message": str(error), "risk": error.risk.model_dump()}) from error
    except KillSwitchActiveError as error:
        audit_trail.record(
            event_type="trade_response",
            status="kill_switch_active",
            exchange=request.exchange,
            symbol=request.symbol,
            mode="live" if request.live_trading else "paper",
            idempotency_key=request.client_order_id,
            payload=error.status.model_dump(mode="json"),
        )
        raise HTTPException(status_code=423, detail=error.status.model_dump(mode="json")) from error
    except LiveTradingDisabledError as error:
        audit_trail.record(
            event_type="trade_response",
            status="live_disabled",
            exchange=request.exchange,
            symbol=request.symbol,
            mode="live",
            idempotency_key=request.client_order_id,
            payload={"error": str(error)},
        )
        raise HTTPException(status_code=403, detail=str(error)) from error
    except ExecutionError as error:
        audit_trail.record(
            event_type="trade_response",
            status="execution_error",
            exchange=request.exchange,
            symbol=request.symbol,
            mode="live" if request.live_trading else "paper",
            idempotency_key=request.client_order_id,
            payload={"error": str(error)},
        )
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ExchangeAPIError as error:
        audit_trail.record(
            event_type="trade_response",
            status="exchange_error",
            exchange=request.exchange,
            symbol=request.symbol,
            mode="live" if request.live_trading else "paper",
            idempotency_key=request.client_order_id,
            payload={"error": str(error)},
        )
        raise HTTPException(status_code=502, detail=str(error)) from error
    except ExecutionAuditError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.post("/trade/cancel", response_model=CancelOrderResponse)
async def cancel_trade(request: CancelOrderRequest) -> CancelOrderResponse:
    try:
        audit_trail.record(
            event_type="cancel_request",
            status="received",
            exchange=request.exchange,
            symbol=request.symbol,
            mode="live" if request.live_trading else "paper",
            idempotency_key=request.client_order_id,
            payload=request.model_dump(mode="json", exclude={"live_confirmation"}),
        )
        response = await order_manager.cancel_order(request)
        audit_trail.record(
            event_type="cancel_response",
            status=response.status,
            exchange=response.exchange,
            symbol=response.symbol,
            mode=response.mode,
            idempotency_key=response.client_order_id,
            payload=response.model_dump(mode="json"),
        )
        return response
    except KillSwitchActiveError as error:
        raise HTTPException(status_code=423, detail=error.status.model_dump(mode="json")) from error
    except LiveTradingDisabledError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except ExecutionError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ExchangeAPIError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except ExecutionAuditError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.post("/kill-switch", response_model=KillSwitchStatus)
async def kill_switch(command: KillSwitchCommand | None = None) -> KillSwitchStatus:
    command = command or KillSwitchCommand()
    status = order_manager.handle_kill_switch(command)
    audit_trail.record(
        event_type="kill_switch",
        status="active" if status.active else "inactive",
        payload={"command": command.model_dump(mode="json"), "status": status.model_dump(mode="json")},
    )
    record_kill_switch(status, triggered=command.action == "trigger")
    return status


@router.get("/positions", response_model=list[PositionRecord])
async def positions(
    exchange: ExchangeName | None = Query(default=None),
    mode: ExecutionMode = Query(default="paper"),
    symbol: str | None = Query(default=None),
    category: str = Query(default="spot"),
) -> list[PositionRecord]:
    try:
        records = await order_manager.get_open_positions(exchange=exchange, mode=mode, symbol=symbol, category=category)
        audit_trail.record(
            event_type="positions_query",
            status="ok",
            exchange=exchange,
            symbol=symbol,
            mode=mode,
            payload={"category": category, "positions_count": len(records)},
        )
        for record in records:
            record_position(record)
        return records
    except KillSwitchActiveError as error:
        raise HTTPException(status_code=423, detail=error.status.model_dump(mode="json")) from error
    except LiveTradingDisabledError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except ExecutionError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except ExchangeAPIError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
