from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from arbitrage.market_data import ArbitrageDataError, ArbitrageMarketDataClient
from arbitrage.schemas import OrderBookLevel, OrderBookSnapshot
from microstructure.schemas import (
    MicrostructureAnalysis,
    MicrostructureDepth,
    MicrostructureExecution,
    MicrostructureRequest,
)


class MicrostructureError(RuntimeError):
    pass


@dataclass(frozen=True)
class _VwapResult:
    filled_quantity: float
    vwap_price: float | None
    levels_used: int


class MicrostructureEngine:
    BINANCE_WS_DEPTHS = {5, 10, 20}
    BYBIT_WS_DEPTHS = {1, 50, 200}

    def __init__(self, *, market_data: ArbitrageMarketDataClient | None = None) -> None:
        self.market_data = market_data or ArbitrageMarketDataClient()

    async def analyze(self, request: MicrostructureRequest) -> MicrostructureAnalysis:
        depth = self._resolve_depth(request)
        try:
            if request.use_websocket:
                orderbook = await self._collect_live_orderbook(request, depth=depth)
            else:
                orderbook = await self._fetch_rest_orderbook(request, depth=depth)
        except ArbitrageDataError as error:
            raise MicrostructureError(str(error)) from error
        return self.analyze_snapshot(request=request, orderbook=orderbook)

    def analyze_snapshot(
        self,
        *,
        request: MicrostructureRequest,
        orderbook: OrderBookSnapshot,
    ) -> MicrostructureAnalysis:
        self._validate_orderbook(orderbook)
        mid_price = orderbook.mid_price
        spread_bps = ((orderbook.best_ask - orderbook.best_bid) / mid_price) * 10_000.0
        imbalance_levels = min(request.imbalance_levels, len(orderbook.bids), len(orderbook.asks))
        bid_depth_usdt = self._notional(orderbook.bids)
        ask_depth_usdt = self._notional(orderbook.asks)
        top_bid_depth_usdt = self._notional(orderbook.bids[:imbalance_levels])
        top_ask_depth_usdt = self._notional(orderbook.asks[:imbalance_levels])
        top_total = top_bid_depth_usdt + top_ask_depth_usdt
        imbalance = ((top_bid_depth_usdt - top_ask_depth_usdt) / top_total) if top_total > 0 else 0.0
        liquidity_score = self._liquidity_score(
            request=request,
            spread_bps=spread_bps,
            latency_ms=orderbook.latency_ms,
            volatility_bps=orderbook.volatility_bps,
            total_depth_usdt=bid_depth_usdt + ask_depth_usdt,
            top_total_usdt=top_total,
            imbalance=imbalance,
        )
        execution = self._execution_analysis(request=request, orderbook=orderbook)
        anomaly_flags = self._anomaly_flags(
            request=request,
            orderbook=orderbook,
            spread_bps=spread_bps,
            imbalance=imbalance,
            liquidity_score=liquidity_score,
            total_depth_usdt=bid_depth_usdt + ask_depth_usdt,
            execution=execution,
        )
        execution_feasibility = not any(
            flag
            in {
                "wide_spread",
                "insufficient_depth_for_target_notional",
                "liquidity_score_below_threshold",
                "excessive_latency",
                "high_short_term_volatility",
                "crossed_or_locked_book",
            }
            for flag in anomaly_flags
        )
        return MicrostructureAnalysis(
            exchange=orderbook.exchange,
            symbol=orderbook.symbol,
            source=orderbook.source,
            received_at=orderbook.received_at,
            latency_ms=round(orderbook.latency_ms, 8),
            sample_count=orderbook.sample_count,
            best_bid=round(orderbook.best_bid, 8),
            best_ask=round(orderbook.best_ask, 8),
            mid_price=round(mid_price, 8),
            spread_bps=round(spread_bps, 8),
            order_book_depth=MicrostructureDepth(
                bid_levels=len(orderbook.bids),
                ask_levels=len(orderbook.asks),
                bid_depth_usdt=round(bid_depth_usdt, 8),
                ask_depth_usdt=round(ask_depth_usdt, 8),
                total_depth_usdt=round(bid_depth_usdt + ask_depth_usdt, 8),
                top_bid_depth_usdt=round(top_bid_depth_usdt, 8),
                top_ask_depth_usdt=round(top_ask_depth_usdt, 8),
            ),
            order_book_imbalance=round(imbalance, 8),
            liquidity_score=round(liquidity_score, 8),
            execution_pressure=self._execution_pressure(imbalance),
            short_term_volatility_bps=round(orderbook.volatility_bps, 8) if orderbook.volatility_bps is not None else None,
            execution=execution,
            abnormal_book=bool(anomaly_flags),
            anomaly_flags=anomaly_flags,
            execution_feasibility=execution_feasibility,
        )

    async def _collect_live_orderbook(self, request: MicrostructureRequest, *, depth: int) -> OrderBookSnapshot:
        if request.exchange == "binance":
            return await self.market_data.collect_binance_orderbook(
                request.symbol,
                depth=depth,
                sample_seconds=request.sample_seconds,
                timeout_seconds=request.ws_timeout_seconds,
                allow_rest_fallback=request.allow_rest_fallback,
            )
        return await self.market_data.collect_bybit_orderbook(
            request.symbol,
            depth=depth,
            sample_seconds=request.sample_seconds,
            timeout_seconds=request.ws_timeout_seconds,
            allow_rest_fallback=request.allow_rest_fallback,
        )

    async def _fetch_rest_orderbook(self, request: MicrostructureRequest, *, depth: int) -> OrderBookSnapshot:
        if request.exchange == "binance":
            return await self.market_data.fetch_binance_orderbook(request.symbol, depth=depth, source_suffix="microstructure")
        return await self.market_data.fetch_bybit_orderbook(request.symbol, depth=depth, source_suffix="microstructure")

    def _resolve_depth(self, request: MicrostructureRequest) -> int:
        if request.exchange == "binance":
            depth = request.depth or 20
            if depth not in self.BINANCE_WS_DEPTHS:
                raise ValueError("Binance microstructure depth must be one of 5, 10, 20")
            return depth
        depth = request.depth or 50
        if depth not in self.BYBIT_WS_DEPTHS:
            raise ValueError("Bybit microstructure depth must be one of 1, 50, 200")
        return depth

    def _validate_orderbook(self, orderbook: OrderBookSnapshot) -> None:
        if not orderbook.bids or not orderbook.asks:
            raise MicrostructureError("orderbook is empty")
        if orderbook.best_bid <= 0 or orderbook.best_ask <= 0 or orderbook.mid_price <= 0:
            raise MicrostructureError("orderbook has invalid top of book")

    def _execution_analysis(self, *, request: MicrostructureRequest, orderbook: OrderBookSnapshot) -> MicrostructureExecution:
        buy_quantity = request.target_notional / orderbook.best_ask
        sell_quantity = request.target_notional / orderbook.best_bid
        buy_vwap = self._vwap(orderbook.asks, quantity=buy_quantity)
        sell_vwap = self._vwap(orderbook.bids, quantity=sell_quantity)
        buy_slippage_bps = (
            max(0.0, (buy_vwap.vwap_price - orderbook.best_ask) / orderbook.best_ask * 10_000.0)
            if buy_vwap.vwap_price is not None
            else None
        )
        sell_slippage_bps = (
            max(0.0, (orderbook.best_bid - sell_vwap.vwap_price) / orderbook.best_bid * 10_000.0)
            if sell_vwap.vwap_price is not None
            else None
        )
        buy_market_impact_bps = (
            max(0.0, (buy_vwap.vwap_price - orderbook.mid_price) / orderbook.mid_price * 10_000.0)
            if buy_vwap.vwap_price is not None
            else None
        )
        sell_market_impact_bps = (
            max(0.0, (orderbook.mid_price - sell_vwap.vwap_price) / orderbook.mid_price * 10_000.0)
            if sell_vwap.vwap_price is not None
            else None
        )
        return MicrostructureExecution(
            target_notional=round(request.target_notional, 8),
            buy_quantity=round(buy_quantity, 12),
            sell_quantity=round(sell_quantity, 12),
            buy_vwap=round(buy_vwap.vwap_price, 8) if buy_vwap.vwap_price is not None else None,
            sell_vwap=round(sell_vwap.vwap_price, 8) if sell_vwap.vwap_price is not None else None,
            buy_slippage_bps=round(buy_slippage_bps, 8) if buy_slippage_bps is not None else None,
            sell_slippage_bps=round(sell_slippage_bps, 8) if sell_slippage_bps is not None else None,
            buy_market_impact_bps=round(buy_market_impact_bps, 8) if buy_market_impact_bps is not None else None,
            sell_market_impact_bps=round(sell_market_impact_bps, 8) if sell_market_impact_bps is not None else None,
            buy_levels_used=buy_vwap.levels_used,
            sell_levels_used=sell_vwap.levels_used,
        )

    def _vwap(self, levels: list[OrderBookLevel], *, quantity: float) -> _VwapResult:
        remaining = quantity
        notional = 0.0
        filled = 0.0
        levels_used = 0
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
        return _VwapResult(filled_quantity=filled, vwap_price=vwap, levels_used=levels_used)

    def _liquidity_score(
        self,
        *,
        request: MicrostructureRequest,
        spread_bps: float,
        latency_ms: float,
        volatility_bps: float | None,
        total_depth_usdt: float,
        top_total_usdt: float,
        imbalance: float,
    ) -> float:
        components: list[tuple[float, float]] = [
            (0.32, min(1.0, total_depth_usdt / max(request.target_notional * 20.0, 1.0))),
            (0.18, min(1.0, top_total_usdt / max(request.target_notional * 4.0, 1.0))),
            (0.20, max(0.0, 1.0 - min(1.0, spread_bps / request.max_spread_bps))),
            (0.12, max(0.0, 1.0 - min(1.0, latency_ms / request.max_latency_ms))),
            (0.10, max(0.0, 1.0 - min(1.0, abs(imbalance) / request.max_abs_imbalance))),
        ]
        if volatility_bps is not None:
            components.append((0.08, max(0.0, 1.0 - min(1.0, volatility_bps / request.max_volatility_bps))))
        total_weight = sum(weight for weight, _ in components)
        if total_weight <= 0:
            return 0.0
        return max(0.0, min(1.0, sum(weight * value for weight, value in components) / total_weight))

    def _anomaly_flags(
        self,
        *,
        request: MicrostructureRequest,
        orderbook: OrderBookSnapshot,
        spread_bps: float,
        imbalance: float,
        liquidity_score: float,
        total_depth_usdt: float,
        execution: MicrostructureExecution,
    ) -> list[str]:
        flags: list[str] = []
        if orderbook.best_bid >= orderbook.best_ask:
            flags.append("crossed_or_locked_book")
        if spread_bps > request.max_spread_bps:
            flags.append("wide_spread")
        if abs(imbalance) > request.max_abs_imbalance:
            flags.append("extreme_order_book_imbalance")
        if total_depth_usdt < request.target_notional * 2.0:
            flags.append("insufficient_depth_for_target_notional")
        if liquidity_score < request.min_liquidity_score:
            flags.append("liquidity_score_below_threshold")
        if orderbook.latency_ms > request.max_latency_ms:
            flags.append("excessive_latency")
        if orderbook.volatility_bps is None and orderbook.sample_count < 3:
            flags.append("short_term_volatility_unavailable")
        if orderbook.volatility_bps is not None and orderbook.volatility_bps > request.max_volatility_bps:
            flags.append("high_short_term_volatility")
        if execution.buy_vwap is None or execution.sell_vwap is None:
            flags.append("insufficient_vwap_depth")
        if len(orderbook.bids) < max(1, request.imbalance_levels // 2) or len(orderbook.asks) < max(1, request.imbalance_levels // 2):
            flags.append("thin_level_count")
        return list(dict.fromkeys(flags))

    def _execution_pressure(self, imbalance: float) -> str:
        if imbalance >= 0.20:
            return "buy_pressure"
        if imbalance <= -0.20:
            return "sell_pressure"
        return "neutral"

    def _notional(self, levels: Iterable[OrderBookLevel]) -> float:
        return sum(level.notional for level in levels)
