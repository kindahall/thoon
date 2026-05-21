from __future__ import annotations

import os
import json
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from execution.binance_connector import BinanceExecutionConnector, ExchangeAPIError
from execution.bitget_connector import BitgetExecutionConnector
from execution.bybit_connector import BybitExecutionConnector
from execution.dydx_connector import DydxExecutionConnector
from execution.hyperliquid_connector import HyperliquidExecutionConnector
from execution.kill_switch import KillSwitch, KillSwitchActiveError, KillSwitchCommand, KillSwitchStatus
from execution.risk_engine import RiskCheckResult, RiskEngine
from services.binance import normalize_symbol

ExchangeName = Literal["binance", "bybit", "bitget", "hyperliquid", "dydx"]
OrderSide = Literal["buy", "sell"]
OrderType = Literal["MARKET", "LIMIT"]
ExecutionMode = Literal["paper", "live"]

LIVE_CONFIRMATION_TEXT = "I_UNDERSTAND_LIVE_CRYPTO_TRADING"


class TradeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName = "binance"
    symbol: str = "BTCUSDT"
    side: OrderSide
    order_type: OrderType = "MARKET"
    quantity: float = Field(..., gt=0)
    price: float | None = Field(default=None, gt=0)
    category: Literal["spot", "linear", "inverse", "option"] = "spot"
    paper_trading: bool = True
    live_trading: bool = False
    leverage: float = Field(default=1.0, ge=1.0)
    reduce_only: bool = False
    client_order_id: str | None = Field(default=None, min_length=1, max_length=64)
    expected_price: float | None = Field(default=None, gt=0)
    max_slippage_bps: float = Field(default=25.0, gt=0)
    strategy_id: str | None = Field(default=None, max_length=128)
    strategy_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    live_confirmation: str | None = None

    @field_validator("symbol")
    @classmethod
    def normalize_request_symbol(cls, value: str) -> str:
        return normalize_symbol(value)

    @field_validator("side", mode="before")
    @classmethod
    def normalize_side(cls, value: str) -> str:
        return value.lower().strip()

    @field_validator("order_type", mode="before")
    @classmethod
    def normalize_order_type(cls, value: str) -> str:
        return value.upper().strip()


class CancelOrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName = "binance"
    symbol: str = "BTCUSDT"
    category: Literal["spot", "linear", "inverse", "option"] = "spot"
    order_id: str | None = None
    client_order_id: str | None = None
    paper_trading: bool = True
    live_trading: bool = False
    live_confirmation: str | None = None


class ExecutionOrderResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepted: bool
    mode: ExecutionMode
    exchange: ExchangeName
    symbol: str
    side: OrderSide
    order_type: OrderType
    status: str
    order_id: str | None
    client_order_id: str | None
    quantity: float
    submitted_price: float | None
    execution_price: float | None
    filled_quantity: float | None = None
    remaining_quantity: float | None = None
    average_execution_price: float | None = None
    fills: list["ExecutionFill"] = Field(default_factory=list)
    notional: float | None
    risk: RiskCheckResult | None
    source: str
    raw_exchange_response: dict[str, Any] | None = None
    timestamp: datetime


class ExecutionFill(BaseModel):
    model_config = ConfigDict(extra="forbid")

    price: float
    quantity: float
    commission: float | None = None
    commission_asset: str | None = None
    trade_id: str | None = None


class CancelOrderResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepted: bool
    mode: ExecutionMode
    exchange: ExchangeName
    symbol: str
    order_id: str | None
    client_order_id: str | None
    status: str
    raw_exchange_response: dict[str, Any] | None = None
    timestamp: datetime


class PositionRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName
    mode: ExecutionMode
    symbol: str
    quantity: float
    average_entry_price: float | None = None
    market_price: float | None = None
    notional: float | None = None
    unrealized_pnl: float | None = None
    realized_pnl: float | None = None
    source: str
    raw: dict[str, Any] | None = None


class ExecutionError(RuntimeError):
    pass


class LiveTradingDisabledError(ExecutionError):
    pass


class RiskRejectedError(ExecutionError):
    def __init__(self, risk: RiskCheckResult) -> None:
        self.risk = risk
        super().__init__(f"risk rejected order: {', '.join(risk.violations)}")


@dataclass
class PaperPosition:
    exchange: ExchangeName
    symbol: str
    quantity: float = 0.0
    average_entry_price: float = 0.0
    realized_pnl: float = 0.0


@dataclass
class IdempotencyEntry:
    signature: str
    response: ExecutionOrderResponse


class OrderManager:
    def __init__(
        self,
        *,
        binance: BinanceExecutionConnector | None = None,
        bybit: BybitExecutionConnector | None = None,
        bitget: BitgetExecutionConnector | None = None,
        hyperliquid: HyperliquidExecutionConnector | None = None,
        dydx: DydxExecutionConnector | None = None,
        risk_engine: RiskEngine | None = None,
        kill_switch: KillSwitch | None = None,
    ) -> None:
        self.binance = binance or BinanceExecutionConnector()
        self.bybit = bybit or BybitExecutionConnector()
        self.bitget = bitget or BitgetExecutionConnector()
        self.hyperliquid = hyperliquid or HyperliquidExecutionConnector()
        self.dydx = dydx or DydxExecutionConnector()
        self.risk_engine = risk_engine or RiskEngine()
        self.kill_switch = kill_switch or KillSwitch(
            api_error_spike_threshold=int(os.getenv("EXECUTION_API_ERROR_SPIKE_THRESHOLD", "5")),
            api_error_window_seconds=int(os.getenv("EXECUTION_API_ERROR_WINDOW_SECONDS", "60")),
            latency_threshold_ms=float(os.getenv("EXECUTION_LATENCY_THRESHOLD_MS", "2500")),
        )
        self.live_trading_enabled = os.getenv("EXECUTION_LIVE_TRADING_ENABLED", "false").lower() == "true"
        self._paper_positions: dict[tuple[ExchangeName, str], PaperPosition] = {}
        self._paper_orders: dict[str, ExecutionOrderResponse] = {}
        self._idempotency: dict[str, IdempotencyEntry] = {}

    async def place_order(self, request: TradeRequest) -> ExecutionOrderResponse:
        self.kill_switch.ensure_not_active()
        mode = self._resolve_mode(request.paper_trading, request.live_trading, request.live_confirmation)
        if mode == "live" and not request.client_order_id:
            raise ExecutionError("client_order_id is required for live trading idempotency")
        idempotency_key = self._idempotency_key(mode, request)
        existing = self._idempotency_response(idempotency_key, request)
        if existing is not None:
            return existing

        connector = self._connector(request.exchange)

        first_price = await self._guarded_call(
            request.exchange,
            "get_market_price",
            connector.get_market_price(request.symbol, request.category),
            trip_kill_switch_on_latency=mode == "live",
        )
        second_price = await self._guarded_call(
            request.exchange,
            "confirm_market_price",
            connector.get_market_price(request.symbol, request.category),
            trip_kill_switch_on_latency=mode == "live",
        )

        if self.risk_engine.price_incoherence_breached(first_price, second_price):
            self.kill_switch.trigger("price_incoherence", f"{request.exchange}:{request.symbol} price changed from {first_price} to {second_price}")
            raise ExecutionError("price incoherence detected; kill switch triggered")

        if request.expected_price and self.risk_engine.reference_price_breached(request.expected_price, second_price, request.max_slippage_bps):
            self.kill_switch.trigger("price_incoherence", f"expected_price={request.expected_price}; market_price={second_price}")
            raise ExecutionError("expected price slippage exceeded; kill switch triggered")

        if mode == "live" and request.strategy_confidence is not None:
            if request.strategy_confidence < self.risk_engine.settings.min_live_strategy_confidence:
                self.kill_switch.trigger("abnormal_strategy_behavior", "strategy confidence below live execution minimum")
                raise ExecutionError("abnormal strategy behavior; kill switch triggered")

        current_position_quantity = self._current_position_quantity(request.exchange, request.symbol, mode)
        current_position_notional = abs(current_position_quantity * second_price)
        total_exposure = await self._total_exposure(mode)
        risk = self.risk_engine.validate_order(
            request=request,
            market_price=second_price,
            current_position_quantity=current_position_quantity,
            current_position_notional=current_position_notional,
            total_exposure=total_exposure,
            live=mode == "live",
        )
        if not risk.accepted:
            raise RiskRejectedError(risk)

        if mode == "paper":
            response = self._place_paper_order(request, market_price=second_price, risk=risk)
            self._store_idempotency(idempotency_key, request, response)
            return response

        raw = await self._guarded_call(
            request.exchange,
            "place_order",
            connector.place_order(
                symbol=request.symbol,
                side=request.side,
                order_type=request.order_type,
                quantity=request.quantity,
                price=request.price,
                client_order_id=request.client_order_id,
                reduce_only=request.reduce_only,
                category=request.category,
            ),
        )
        filled_quantity, remaining_quantity, average_execution_price, fills = self._execution_details(
            exchange=request.exchange,
            raw=raw,
            request=request,
        )
        response = ExecutionOrderResponse(
            accepted=True,
            mode="live",
            exchange=request.exchange,
            symbol=request.symbol,
            side=request.side,
            order_type=request.order_type,
            status=str(raw.get("status") or raw.get("result", {}).get("orderStatus") or "ACCEPTED"),
            order_id=str(raw.get("orderId") or raw.get("result", {}).get("orderId") or raw.get("data", {}).get("orderId") or ""),
            client_order_id=request.client_order_id,
            quantity=request.quantity,
            submitted_price=request.price,
            execution_price=average_execution_price,
            filled_quantity=filled_quantity,
            remaining_quantity=remaining_quantity,
            average_execution_price=average_execution_price,
            fills=fills,
            notional=risk.notional,
            risk=risk,
            source=f"{request.exchange}_official_rest_live",
            raw_exchange_response=raw,
            timestamp=datetime.now(UTC),
        )
        self._store_idempotency(idempotency_key, request, response)
        return response

    async def cancel_order(self, request: CancelOrderRequest) -> CancelOrderResponse:
        self.kill_switch.ensure_not_active()
        mode = self._resolve_mode(request.paper_trading, request.live_trading, request.live_confirmation)
        if mode == "paper":
            order_id = request.order_id or request.client_order_id
            status = "NOT_FOUND"
            if order_id and order_id in self._paper_orders:
                status = "ALREADY_FILLED_PAPER_ORDER"
            return CancelOrderResponse(
                accepted=False,
                mode="paper",
                exchange=request.exchange,
                symbol=request.symbol,
                order_id=request.order_id,
                client_order_id=request.client_order_id,
                status=status,
                timestamp=datetime.now(UTC),
            )

        connector = self._connector(request.exchange)
        raw = await self._guarded_call(
            request.exchange,
            "cancel_order",
            connector.cancel_order(
                symbol=request.symbol,
                order_id=request.order_id,
                client_order_id=request.client_order_id,
                category=request.category,
            ),
        )
        return CancelOrderResponse(
            accepted=True,
            mode="live",
            exchange=request.exchange,
            symbol=request.symbol,
            order_id=request.order_id or str(raw.get("orderId") or raw.get("result", {}).get("orderId") or raw.get("data", {}).get("orderId") or ""),
            client_order_id=request.client_order_id,
            status="CANCEL_REQUESTED",
            raw_exchange_response=raw,
            timestamp=datetime.now(UTC),
        )

    async def get_open_positions(
        self,
        *,
        exchange: ExchangeName | None = None,
        mode: ExecutionMode = "paper",
        symbol: str | None = None,
        category: str = "spot",
    ) -> list[PositionRecord]:
        if mode == "paper":
            return await self._paper_position_records(exchange=exchange, symbol=symbol, category=category)

        if not exchange:
            raise ExecutionError("exchange is required for live positions")
        self._ensure_live_allowed(None, require_confirmation=False)
        connector = self._connector(exchange)
        raw_positions = await self._guarded_call(
            exchange,
            "get_open_positions",
            connector.get_open_positions(symbol=symbol, category=category),
        )
        return [PositionRecord.model_validate(row) for row in raw_positions]

    def handle_kill_switch(self, command: KillSwitchCommand) -> KillSwitchStatus:
        if command.action == "reset":
            return self.kill_switch.reset()
        if command.action == "status":
            return self.kill_switch.status()
        return self.kill_switch.trigger(command.reason, command.detail)

    def _place_paper_order(self, request: TradeRequest, *, market_price: float, risk: RiskCheckResult) -> ExecutionOrderResponse:
        if request.order_type == "LIMIT" and request.price is not None:
            marketable = (request.side == "buy" and request.price >= market_price) or (request.side == "sell" and request.price <= market_price)
            if not marketable:
                raise ExecutionError("paper LIMIT order is not marketable at the current real market price")

        position = self._paper_positions.setdefault((request.exchange, request.symbol), PaperPosition(exchange=request.exchange, symbol=request.symbol))
        signed_quantity = request.quantity if request.side == "buy" else -request.quantity
        self._apply_paper_fill(position, signed_quantity, market_price)
        order_id = str(uuid4())
        response = ExecutionOrderResponse(
            accepted=True,
            mode="paper",
            exchange=request.exchange,
            symbol=request.symbol,
            side=request.side,
            order_type=request.order_type,
            status="FILLED",
            order_id=order_id,
            client_order_id=request.client_order_id,
            quantity=request.quantity,
            submitted_price=request.price,
            execution_price=round(market_price, 8),
            filled_quantity=round(request.quantity, 12),
            remaining_quantity=0.0,
            average_execution_price=round(market_price, 8),
            fills=[
                ExecutionFill(
                    price=round(market_price, 8),
                    quantity=round(request.quantity, 12),
                    commission=None,
                    commission_asset=None,
                    trade_id=order_id,
                )
            ],
            notional=round(request.quantity * market_price, 8),
            risk=risk,
            source=f"{request.exchange}_real_price_paper_execution",
            raw_exchange_response=None,
            timestamp=datetime.now(UTC),
        )
        self._paper_orders[order_id] = response
        if request.client_order_id:
            self._paper_orders[request.client_order_id] = response
        return response

    def _apply_paper_fill(self, position: PaperPosition, signed_quantity: float, price: float) -> None:
        if position.quantity == 0 or position.quantity * signed_quantity > 0:
            new_abs = abs(position.quantity) + abs(signed_quantity)
            if new_abs > 0:
                position.average_entry_price = (
                    (position.average_entry_price * abs(position.quantity)) + (price * abs(signed_quantity))
                ) / new_abs
            position.quantity += signed_quantity
            return

        close_quantity = min(abs(position.quantity), abs(signed_quantity))
        if position.quantity > 0:
            position.realized_pnl += (price - position.average_entry_price) * close_quantity
        else:
            position.realized_pnl += (position.average_entry_price - price) * close_quantity
        position.quantity += signed_quantity
        if abs(position.quantity) < 1e-12:
            position.quantity = 0.0
            position.average_entry_price = 0.0
        elif position.quantity * signed_quantity > 0:
            position.average_entry_price = price

    async def _paper_position_records(
        self,
        *,
        exchange: ExchangeName | None,
        symbol: str | None,
        category: str,
    ) -> list[PositionRecord]:
        records: list[PositionRecord] = []
        for (position_exchange, position_symbol), position in self._paper_positions.items():
            if exchange and position_exchange != exchange:
                continue
            if symbol and position_symbol != normalize_symbol(symbol):
                continue
            if abs(position.quantity) < 1e-12:
                continue
            connector = self._connector(position_exchange)
            market_price = await self._guarded_call(
                position_exchange,
                "mark_paper_position",
                connector.get_market_price(position_symbol, category),
                trip_kill_switch_on_latency=False,
            )
            unrealized = self._paper_unrealized(position, market_price)
            records.append(
                PositionRecord(
                    exchange=position_exchange,
                    mode="paper",
                    symbol=position_symbol,
                    quantity=round(position.quantity, 12),
                    average_entry_price=round(position.average_entry_price, 8),
                    market_price=round(market_price, 8),
                    notional=round(abs(position.quantity) * market_price, 8),
                    unrealized_pnl=round(unrealized, 8),
                    realized_pnl=round(position.realized_pnl, 8),
                    source=f"{position_exchange}_real_price_paper_position",
                )
            )
        return records

    def _paper_unrealized(self, position: PaperPosition, market_price: float) -> float:
        if position.quantity > 0:
            return (market_price - position.average_entry_price) * position.quantity
        if position.quantity < 0:
            return (position.average_entry_price - market_price) * abs(position.quantity)
        return 0.0

    def _current_position_quantity(
        self,
        exchange: ExchangeName,
        symbol: str,
        mode: ExecutionMode,
    ) -> float:
        if mode == "paper":
            position = self._paper_positions.get((exchange, symbol))
            return position.quantity if position else 0.0
        return 0.0

    async def _total_exposure(self, mode: ExecutionMode) -> float:
        if mode != "paper":
            return 0.0
        exposure = 0.0
        for (exchange, symbol), position in self._paper_positions.items():
            connector = self._connector(exchange)
            market_price = await self._guarded_call(
                exchange,
                "paper_exposure_mark",
                connector.get_market_price(symbol, "spot"),
                trip_kill_switch_on_latency=False,
            )
            exposure += abs(position.quantity * market_price)
        return exposure

    async def _guarded_call(self, exchange: ExchangeName, operation: str, awaitable: Any, *, trip_kill_switch_on_latency: bool = True) -> Any:
        start = time.perf_counter()
        try:
            result = await awaitable
            latency_ms = (time.perf_counter() - start) * 1000
            if trip_kill_switch_on_latency:
                self.kill_switch.record_latency(latency_ms, f"{exchange}.{operation}")
                self.kill_switch.ensure_not_active()
            return result
        except KillSwitchActiveError:
            raise
        except Exception as error:
            self.kill_switch.record_api_error(f"{exchange}.{operation}: {error}")
            raise

    def _resolve_mode(self, paper_trading: bool, live_trading: bool, live_confirmation: str | None) -> ExecutionMode:
        if live_trading and paper_trading:
            raise ExecutionError("paper_trading and live_trading cannot both be true")
        if live_trading:
            self._ensure_live_allowed(live_confirmation, require_confirmation=True)
            return "live"
        if not paper_trading:
            raise ExecutionError("paper_trading=false requires live_trading=true")
        return "paper"

    def _ensure_live_allowed(self, live_confirmation: str | None, *, require_confirmation: bool) -> None:
        if not self.live_trading_enabled:
            raise LiveTradingDisabledError("live trading is disabled; set EXECUTION_LIVE_TRADING_ENABLED=true")
        if require_confirmation and live_confirmation != LIVE_CONFIRMATION_TEXT:
            raise LiveTradingDisabledError(f"live_confirmation must equal {LIVE_CONFIRMATION_TEXT}")

    def _connector(
        self,
        exchange: ExchangeName,
    ) -> BinanceExecutionConnector | BybitExecutionConnector | BitgetExecutionConnector | HyperliquidExecutionConnector | DydxExecutionConnector:
        if exchange == "binance":
            return self.binance
        if exchange == "bybit":
            return self.bybit
        if exchange == "bitget":
            return self.bitget
        if exchange == "hyperliquid":
            return self.hyperliquid
        if exchange == "dydx":
            return self.dydx
        raise ExecutionError("unsupported exchange")

    def _idempotency_key(self, mode: ExecutionMode, request: TradeRequest) -> str | None:
        if not request.client_order_id:
            return None
        return f"{mode}:{request.exchange}:{request.client_order_id}"

    def _idempotency_response(self, key: str | None, request: TradeRequest) -> ExecutionOrderResponse | None:
        if key is None:
            return None
        entry = self._idempotency.get(key)
        if entry is None:
            return None
        signature = self._request_signature(request)
        if signature != entry.signature:
            raise ExecutionError("idempotency key reused with different order payload")
        return entry.response

    def _store_idempotency(self, key: str | None, request: TradeRequest, response: ExecutionOrderResponse) -> None:
        if key is None:
            return
        self._idempotency[key] = IdempotencyEntry(signature=self._request_signature(request), response=response)

    def _request_signature(self, request: TradeRequest) -> str:
        payload = request.model_dump(mode="json", exclude={"live_confirmation"})
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        import hashlib

        return hashlib.sha256(encoded).hexdigest()

    def _execution_details(
        self,
        *,
        exchange: ExchangeName,
        raw: dict[str, Any],
        request: TradeRequest,
    ) -> tuple[float | None, float | None, float | None, list[ExecutionFill]]:
        if exchange == "binance":
            return self._binance_execution_details(raw=raw, request=request)
        if exchange == "bybit":
            return self._bybit_execution_details(raw=raw, request=request)
        if exchange == "bitget":
            return self._bitget_execution_details(raw=raw, request=request)
        return (None, None, None, [])

    def _binance_execution_details(
        self,
        *,
        raw: dict[str, Any],
        request: TradeRequest,
    ) -> tuple[float | None, float | None, float | None, list[ExecutionFill]]:
        original_quantity = self._float_or_none(raw.get("origQty")) or request.quantity
        filled_quantity = self._float_or_none(raw.get("executedQty"))
        remaining_quantity = None if filled_quantity is None else max(0.0, original_quantity - filled_quantity)
        cumulative_quote = self._float_or_none(raw.get("cummulativeQuoteQty"))
        fills: list[ExecutionFill] = []
        for item in raw.get("fills", []) or []:
            fill_price = self._float_or_none(item.get("price"))
            fill_quantity = self._float_or_none(item.get("qty"))
            if fill_price is None or fill_quantity is None:
                continue
            fills.append(
                ExecutionFill(
                    price=round(fill_price, 8),
                    quantity=round(fill_quantity, 12),
                    commission=self._float_or_none(item.get("commission")),
                    commission_asset=item.get("commissionAsset"),
                    trade_id=None if item.get("tradeId") is None else str(item.get("tradeId")),
                )
            )
        average_execution_price = None
        if filled_quantity and filled_quantity > 0:
            if cumulative_quote is not None and cumulative_quote > 0:
                average_execution_price = cumulative_quote / filled_quantity
            elif fills:
                filled_notional = sum(fill.price * fill.quantity for fill in fills)
                filled_size = sum(fill.quantity for fill in fills)
                average_execution_price = filled_notional / filled_size if filled_size > 0 else None
        return (
            None if filled_quantity is None else round(filled_quantity, 12),
            None if remaining_quantity is None else round(remaining_quantity, 12),
            None if average_execution_price is None else round(average_execution_price, 8),
            fills,
        )

    def _bybit_execution_details(
        self,
        *,
        raw: dict[str, Any],
        request: TradeRequest,
    ) -> tuple[float | None, float | None, float | None, list[ExecutionFill]]:
        result = raw.get("result", {}) if isinstance(raw.get("result"), dict) else {}
        filled_quantity = self._float_or_none(result.get("cumExecQty"))
        remaining_quantity = self._float_or_none(result.get("leavesQty"))
        average_execution_price = self._float_or_none(result.get("avgPrice"))
        return (
            None if filled_quantity is None else round(filled_quantity, 12),
            None if remaining_quantity is None else round(remaining_quantity, 12),
            None if average_execution_price is None else round(average_execution_price, 8),
            [],
        )

    def _bitget_execution_details(
        self,
        *,
        raw: dict[str, Any],
        request: TradeRequest,
    ) -> tuple[float | None, float | None, float | None, list[ExecutionFill]]:
        return (None, None, None, [])

    def _float_or_none(self, value: Any) -> float | None:
        if value in (None, ""):
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
