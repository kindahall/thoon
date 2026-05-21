from __future__ import annotations

import os
from dataclasses import dataclass

from arbitrage.market_data import ArbitrageDataError, ArbitrageMarketDataClient
from arbitrage.schemas import OrderBookLevel, OrderBookSnapshot
from execution.binance_connector import BinanceExecutionConnector, ExchangeAPIError
from execution.bybit_connector import BybitExecutionConnector
from transaction_cost.schemas import FeeEstimate, TransactionCostEstimate, TransactionCostRequest


class TransactionCostError(RuntimeError):
    pass


@dataclass(frozen=True)
class _VwapResult:
    filled_quantity: float
    vwap_price: float | None
    notional: float
    levels_used: int
    available_notional: float


class TransactionCostEngine:
    def __init__(
        self,
        *,
        market_data: ArbitrageMarketDataClient | None = None,
        binance_connector: BinanceExecutionConnector | None = None,
        bybit_connector: BybitExecutionConnector | None = None,
    ) -> None:
        self.market_data = market_data or ArbitrageMarketDataClient()
        self.binance_connector = binance_connector or BinanceExecutionConnector()
        self.bybit_connector = bybit_connector or BybitExecutionConnector()

    async def estimate(self, request: TransactionCostRequest) -> TransactionCostEstimate:
        orderbook = await self._orderbook(request)
        fee = await self._fee(request)
        return self._estimate_from_orderbook(request=request, orderbook=orderbook, fee=fee)

    async def _orderbook(self, request: TransactionCostRequest) -> OrderBookSnapshot:
        try:
            if request.exchange == "binance":
                return await self.market_data.fetch_binance_orderbook(request.symbol, depth=request.depth, source_suffix="transaction_cost")
            return await self.market_data.fetch_bybit_orderbook(request.symbol, depth=request.depth, source_suffix="transaction_cost")
        except ArbitrageDataError as error:
            raise TransactionCostError(str(error)) from error

    async def _fee(self, request: TransactionCostRequest) -> FeeEstimate:
        if request.fee_bps is not None:
            return FeeEstimate(fee_bps=round(request.fee_bps, 8), source="request_override", account_fee_available=False)

        account_fee = await self._account_fee_bps(request)
        if account_fee is not None:
            return FeeEstimate(fee_bps=round(account_fee, 8), source="account_api", account_fee_available=True)

        if request.require_account_fee:
            raise TransactionCostError("account fee requested but exchange API credentials or fee endpoint are unavailable")

        configured = self._configured_fee_bps(request.exchange)
        return FeeEstimate(fee_bps=round(configured, 8), source="configured_default", account_fee_available=False)

    async def _account_fee_bps(self, request: TransactionCostRequest) -> float | None:
        try:
            if request.exchange == "binance" and self.binance_connector.has_credentials():
                payload = await self.binance_connector._request("GET", "/api/v3/account", params={}, signed=True)
                taker_commission = payload.get("takerCommission")
                if taker_commission is not None:
                    return float(taker_commission)
            if request.exchange == "bybit" and self.bybit_connector.has_credentials():
                payload = await self.bybit_connector._request(
                    "GET",
                    "/v5/account/fee-rate",
                    params={"category": "spot", "symbol": request.symbol},
                    signed=True,
                )
                rows = payload.get("result", {}).get("list", [])
                if rows and rows[0].get("takerFeeRate") is not None:
                    return float(rows[0]["takerFeeRate"]) * 10_000.0
        except (ExchangeAPIError, KeyError, TypeError, ValueError):
            return None
        return None

    def _configured_fee_bps(self, exchange: str) -> float:
        if exchange == "binance":
            return float(os.getenv("BINANCE_SPOT_TAKER_FEE_BPS", "10.0"))
        return float(os.getenv("BYBIT_SPOT_TAKER_FEE_BPS", "10.0"))

    def _estimate_from_orderbook(
        self,
        *,
        request: TransactionCostRequest,
        orderbook: OrderBookSnapshot,
        fee: FeeEstimate,
    ) -> TransactionCostEstimate:
        if orderbook.best_bid <= 0 or orderbook.best_ask <= 0 or orderbook.mid_price <= 0:
            raise TransactionCostError("orderbook has invalid top of book")
        reference_price = orderbook.best_ask if request.side == "buy" else orderbook.best_bid
        quantity = request.order_notional / reference_price
        levels = orderbook.asks if request.side == "buy" else orderbook.bids
        vwap = self._vwap(levels, quantity=quantity)

        issues: list[str] = []
        if vwap.vwap_price is None:
            issues.append("insufficient_orderbook_depth")

        spread_bps = ((orderbook.best_ask - orderbook.best_bid) / orderbook.mid_price) * 10_000.0
        half_spread_bps = max(0.0, spread_bps / 2.0)
        if request.side == "buy" and vwap.vwap_price is not None:
            slippage_bps = max(0.0, (vwap.vwap_price - orderbook.best_ask) / orderbook.best_ask * 10_000.0)
            market_impact_bps = max(0.0, (vwap.vwap_price - orderbook.mid_price) / orderbook.mid_price * 10_000.0)
        elif request.side == "sell" and vwap.vwap_price is not None:
            slippage_bps = max(0.0, (orderbook.best_bid - vwap.vwap_price) / orderbook.best_bid * 10_000.0)
            market_impact_bps = max(0.0, (orderbook.mid_price - vwap.vwap_price) / orderbook.mid_price * 10_000.0)
        else:
            slippage_bps = 0.0
            market_impact_bps = half_spread_bps

        latency_penalty_bps = (orderbook.latency_ms / 1000.0) * request.latency_penalty_bps_per_second
        estimated_cost_bps = fee.fee_bps + half_spread_bps + slippage_bps + latency_penalty_bps
        fee_amount = request.order_notional * fee.fee_bps / 10_000.0
        estimated_cost_amount = request.order_notional * estimated_cost_bps / 10_000.0
        net_edge = (request.gross_edge_bps if request.gross_edge_bps is not None else 0.0) - estimated_cost_bps

        if request.max_estimated_cost_bps is not None and estimated_cost_bps > request.max_estimated_cost_bps:
            issues.append("estimated_cost_above_threshold")
        if request.reject_if_edge_below_costs:
            if request.gross_edge_bps is None:
                issues.append("gross_edge_required_for_cost_rejection")
            elif net_edge <= 0:
                issues.append("edge_below_transaction_costs")

        execution_feasibility = not any(
            issue
            in {
                "insufficient_orderbook_depth",
                "estimated_cost_above_threshold",
                "gross_edge_required_for_cost_rejection",
                "edge_below_transaction_costs",
            }
            for issue in issues
        )
        return TransactionCostEstimate(
            exchange=request.exchange,
            symbol=request.symbol,
            side=request.side,
            order_notional=round(request.order_notional, 8),
            quantity=round(quantity, 12),
            best_bid=round(orderbook.best_bid, 8),
            best_ask=round(orderbook.best_ask, 8),
            mid_price=round(orderbook.mid_price, 8),
            vwap_price=round(vwap.vwap_price, 8) if vwap.vwap_price is not None else None,
            spread_bps=round(spread_bps, 8),
            half_spread_bps=round(half_spread_bps, 8),
            fee=fee,
            fee_amount=round(fee_amount, 8),
            slippage_bps=round(slippage_bps, 8),
            market_impact_bps=round(market_impact_bps, 8),
            latency_ms=round(orderbook.latency_ms, 8),
            latency_penalty_bps=round(latency_penalty_bps, 8),
            estimated_cost_bps=round(estimated_cost_bps, 8),
            estimated_cost_amount=round(estimated_cost_amount, 8),
            gross_edge_bps=request.gross_edge_bps,
            net_edge_after_costs=round(net_edge, 8),
            available_liquidity_usdt=round(vwap.available_notional, 8),
            filled_quantity=round(vwap.filled_quantity, 12),
            levels_used=vwap.levels_used,
            execution_feasibility=execution_feasibility,
            issues=issues,
            orderbook_source=orderbook.source,
            received_at=orderbook.received_at,
        )

    def _vwap(self, levels: list[OrderBookLevel], *, quantity: float) -> _VwapResult:
        remaining = quantity
        notional = 0.0
        filled = 0.0
        levels_used = 0
        available_notional = sum(level.notional for level in levels)
        for level in levels:
            if remaining <= 1e-12:
                break
            fill_quantity = min(remaining, level.quantity)
            if fill_quantity <= 0:
                continue
            notional += fill_quantity * level.price
            filled += fill_quantity
            remaining -= fill_quantity
            levels_used += 1
        vwap = notional / filled if filled >= quantity - 1e-12 and filled > 0 else None
        return _VwapResult(
            filled_quantity=filled,
            vwap_price=vwap,
            notional=notional,
            levels_used=levels_used,
            available_notional=available_notional,
        )
