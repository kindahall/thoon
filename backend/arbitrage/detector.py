from __future__ import annotations

from dataclasses import dataclass

from arbitrage.schemas import ArbitrageOpportunity, ArbitrageScanRequest, ExchangeName, OrderBookLevel, OrderBookSnapshot


@dataclass(frozen=True)
class _VwapResult:
    filled_quantity: float
    vwap_price: float | None
    notional: float
    levels_used: int
    available_notional: float


class ArbitrageDetector:
    def detect(
        self,
        snapshots: dict[tuple[ExchangeName, str], OrderBookSnapshot],
        request: ArbitrageScanRequest,
    ) -> list[ArbitrageOpportunity]:
        opportunities: list[ArbitrageOpportunity] = []
        for symbol in request.symbols:
            binance = snapshots.get(("binance", symbol))
            bybit = snapshots.get(("bybit", symbol))
            if binance is None or bybit is None:
                continue
            opportunities.extend(
                [
                    self._evaluate_direction(symbol=symbol, buy_book=binance, sell_book=bybit, request=request),
                    self._evaluate_direction(symbol=symbol, buy_book=bybit, sell_book=binance, request=request),
                ]
            )

        candidates = [opportunity for opportunity in opportunities if opportunity.gross_spread_bps > 0]
        candidates.sort(key=lambda opportunity: opportunity.expected_profit, reverse=True)
        return candidates[: request.max_opportunities]

    def _evaluate_direction(
        self,
        *,
        symbol: str,
        buy_book: OrderBookSnapshot,
        sell_book: OrderBookSnapshot,
        request: ArbitrageScanRequest,
    ) -> ArbitrageOpportunity:
        buy_price = buy_book.best_ask
        sell_price = sell_book.best_bid
        quantity = request.target_notional / buy_price if buy_price > 0 else 0.0
        buy_vwap = self._vwap(buy_book.asks, quantity=quantity)
        sell_vwap = self._vwap(sell_book.bids, quantity=quantity)
        buy_fee_bps = self._fee_bps(buy_book.exchange, request)
        sell_fee_bps = self._fee_bps(sell_book.exchange, request)
        latency_ms = max(buy_book.latency_ms, sell_book.latency_ms)
        latency_penalty_bps = ((buy_book.latency_ms + sell_book.latency_ms) / 1000.0) * request.latency_penalty_bps_per_second
        gross_spread_bps = ((sell_price - buy_price) / buy_price) * 10_000.0 if buy_price > 0 else -10_000.0
        buy_slippage_bps = None
        sell_slippage_bps = None
        expected_profit = -request.target_notional
        net_spread_bps = gross_spread_bps - buy_fee_bps - sell_fee_bps - latency_penalty_bps

        if buy_vwap.vwap_price is not None and sell_vwap.vwap_price is not None and quantity > 0:
            buy_slippage_bps = max(0.0, (buy_vwap.vwap_price - buy_price) / buy_price * 10_000.0)
            sell_slippage_bps = max(0.0, (sell_price - sell_vwap.vwap_price) / sell_price * 10_000.0) if sell_price > 0 else 0.0
            buy_fee = buy_vwap.notional * buy_fee_bps / 10_000.0
            sell_fee = sell_vwap.notional * sell_fee_bps / 10_000.0
            expected_profit = sell_vwap.notional - buy_vwap.notional - buy_fee - sell_fee
            net_spread_bps = (
                ((sell_vwap.vwap_price - buy_vwap.vwap_price) / buy_vwap.vwap_price) * 10_000.0
                - buy_fee_bps
                - sell_fee_bps
                - latency_penalty_bps
            )

        volatility_bps = self._combined_volatility_bps(buy_book, sell_book)
        liquidity_usdt = min(buy_vwap.available_notional, sell_vwap.available_notional)
        violations = self._risk_violations(
            request=request,
            expected_profit=expected_profit,
            net_spread_bps=net_spread_bps,
            quantity=quantity,
            buy_vwap=buy_vwap,
            sell_vwap=sell_vwap,
            liquidity_usdt=liquidity_usdt,
            latency_ms=latency_ms,
            volatility_bps=volatility_bps,
        )
        risk_score = self._risk_score(
            request=request,
            net_spread_bps=net_spread_bps,
            liquidity_usdt=liquidity_usdt,
            latency_ms=latency_ms,
            volatility_bps=volatility_bps,
            violations=violations,
        )
        return ArbitrageOpportunity(
            symbol=symbol,
            buy_exchange=buy_book.exchange,
            sell_exchange=sell_book.exchange,
            buy_price=round(buy_price, 8),
            sell_price=round(sell_price, 8),
            buy_vwap=round(buy_vwap.vwap_price, 8) if buy_vwap.vwap_price is not None else None,
            sell_vwap=round(sell_vwap.vwap_price, 8) if sell_vwap.vwap_price is not None else None,
            quantity=round(quantity, 12),
            target_notional=round(request.target_notional, 8),
            gross_spread_bps=round(gross_spread_bps, 6),
            buy_fee_bps=round(buy_fee_bps, 6),
            sell_fee_bps=round(sell_fee_bps, 6),
            buy_slippage_bps=round(buy_slippage_bps, 6) if buy_slippage_bps is not None else None,
            sell_slippage_bps=round(sell_slippage_bps, 6) if sell_slippage_bps is not None else None,
            latency_ms=round(latency_ms, 3),
            latency_penalty_bps=round(latency_penalty_bps, 6),
            volatility_bps=round(volatility_bps, 6) if volatility_bps is not None else None,
            liquidity_usdt=round(liquidity_usdt, 8),
            fee_adjusted_profitability_bps=round(net_spread_bps, 6),
            expected_profit=round(expected_profit, 8),
            risk_score=round(risk_score, 6),
            execution_feasibility=not violations,
            risk_violations=violations,
            buy_orderbook_source=buy_book.source,
            sell_orderbook_source=sell_book.source,
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

    def _fee_bps(self, exchange: ExchangeName, request: ArbitrageScanRequest) -> float:
        return request.binance_taker_fee_bps if exchange == "binance" else request.bybit_taker_fee_bps

    def _combined_volatility_bps(self, first: OrderBookSnapshot, second: OrderBookSnapshot) -> float | None:
        values = [value for value in [first.volatility_bps, second.volatility_bps] if value is not None]
        if not values:
            return None
        return max(values)

    def _risk_violations(
        self,
        *,
        request: ArbitrageScanRequest,
        expected_profit: float,
        net_spread_bps: float,
        quantity: float,
        buy_vwap: _VwapResult,
        sell_vwap: _VwapResult,
        liquidity_usdt: float,
        latency_ms: float,
        volatility_bps: float | None,
    ) -> list[str]:
        violations: list[str] = []
        if quantity <= 0 or buy_vwap.filled_quantity < quantity - 1e-12 or sell_vwap.filled_quantity < quantity - 1e-12:
            violations.append("insufficient_orderbook_depth")
        if liquidity_usdt < request.min_liquidity_usdt:
            violations.append("liquidity_below_threshold")
        if net_spread_bps < request.min_net_spread_bps:
            violations.append("spread_below_threshold")
        if expected_profit <= 0:
            violations.append("expected_profit_not_positive")
        if latency_ms > request.max_latency_ms:
            violations.append("latency_above_threshold")
        if volatility_bps is None:
            violations.append("volatility_unavailable")
        elif volatility_bps > request.max_volatility_bps:
            violations.append("volatility_above_threshold")
        return violations

    def _risk_score(
        self,
        *,
        request: ArbitrageScanRequest,
        net_spread_bps: float,
        liquidity_usdt: float,
        latency_ms: float,
        volatility_bps: float | None,
        violations: list[str],
    ) -> float:
        spread_shortfall = max(0.0, request.min_net_spread_bps - net_spread_bps) / max(request.min_net_spread_bps, 1.0)
        liquidity_risk = max(0.0, request.min_liquidity_usdt - liquidity_usdt) / max(request.min_liquidity_usdt, 1.0)
        latency_risk = min(2.0, latency_ms / request.max_latency_ms)
        volatility_risk = 1.0 if volatility_bps is None else min(2.0, volatility_bps / request.max_volatility_bps)
        violation_risk = min(1.0, len(violations) * 0.18)
        score = 0.3 * spread_shortfall + 0.2 * liquidity_risk + 0.2 * latency_risk + 0.15 * volatility_risk + violation_risk
        return max(0.0, min(1.0, score))
