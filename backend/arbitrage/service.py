from __future__ import annotations

from datetime import UTC, datetime

from arbitrage.detector import ArbitrageDetector
from arbitrage.market_data import ArbitrageMarketDataClient
from arbitrage.schemas import (
    ArbitrageOpportunity,
    ArbitragePaperExecutionRequest,
    ArbitragePaperExecutionResponse,
    ArbitragePaperFill,
    ArbitrageScanRequest,
    ArbitrageScanResponse,
)


class ArbitrageService:
    def __init__(
        self,
        *,
        market_data: ArbitrageMarketDataClient | None = None,
        detector: ArbitrageDetector | None = None,
    ) -> None:
        self.market_data = market_data or ArbitrageMarketDataClient()
        self.detector = detector or ArbitrageDetector()

    async def scan(self, request: ArbitrageScanRequest) -> ArbitrageScanResponse:
        snapshots = await self.market_data.collect_orderbooks(
            symbols=request.symbols,
            binance_depth=request.binance_depth,
            bybit_depth=request.bybit_depth,
            sample_seconds=request.sample_seconds,
            timeout_seconds=request.ws_timeout_seconds,
            allow_rest_fallback=request.allow_rest_fallback,
        )
        opportunities = self.detector.detect(snapshots=snapshots, request=request)
        feasible = [opportunity for opportunity in opportunities if opportunity.execution_feasibility]
        expected_profit = sum(max(0.0, opportunity.expected_profit) for opportunity in feasible)
        risk_score = min((opportunity.risk_score for opportunity in opportunities), default=1.0)
        return ArbitrageScanResponse(
            arbitrage_opportunities=opportunities,
            expected_profit=round(expected_profit, 8),
            risk_score=round(risk_score, 6),
            execution_feasibility=bool(feasible),
        )

    async def execute_paper(self, request: ArbitragePaperExecutionRequest) -> ArbitragePaperExecutionResponse:
        scan = await self.scan(request)
        feasible = [opportunity for opportunity in scan.arbitrage_opportunities if opportunity.execution_feasibility]
        if not feasible:
            return ArbitragePaperExecutionResponse(
                executed=False,
                status="no_feasible_opportunity",
                opportunity=scan.arbitrage_opportunities[0] if scan.arbitrage_opportunities else None,
                fills=[],
                gross_profit=0.0,
                fees_paid=0.0,
                net_profit=0.0,
                latency_ms=None,
                timestamp=datetime.now(UTC),
            )

        selected = max(feasible, key=lambda opportunity: opportunity.expected_profit)
        fills = self._paper_fills(selected)
        gross_profit = fills[1].notional - fills[0].notional
        fees_paid = sum(fill.fee for fill in fills)
        net_profit = gross_profit - fees_paid
        return ArbitragePaperExecutionResponse(
            executed=True,
            status="filled_paper_from_real_orderbooks",
            opportunity=selected,
            fills=fills,
            gross_profit=round(gross_profit, 8),
            fees_paid=round(fees_paid, 8),
            net_profit=round(net_profit, 8),
            latency_ms=selected.latency_ms,
            timestamp=datetime.now(UTC),
        )

    def _paper_fills(self, opportunity: ArbitrageOpportunity) -> list[ArbitragePaperFill]:
        buy_vwap = opportunity.buy_vwap or opportunity.buy_price
        sell_vwap = opportunity.sell_vwap or opportunity.sell_price
        buy_notional = buy_vwap * opportunity.quantity
        sell_notional = sell_vwap * opportunity.quantity
        buy_fee = buy_notional * opportunity.buy_fee_bps / 10_000.0
        sell_fee = sell_notional * opportunity.sell_fee_bps / 10_000.0
        return [
            ArbitragePaperFill(
                exchange=opportunity.buy_exchange,
                symbol=opportunity.symbol,
                side="buy",
                quantity=opportunity.quantity,
                vwap_price=round(buy_vwap, 8),
                notional=round(buy_notional, 8),
                fee=round(buy_fee, 8),
                source=opportunity.buy_orderbook_source,
            ),
            ArbitragePaperFill(
                exchange=opportunity.sell_exchange,
                symbol=opportunity.symbol,
                side="sell",
                quantity=opportunity.quantity,
                vwap_price=round(sell_vwap, 8),
                notional=round(sell_notional, 8),
                fee=round(sell_fee, 8),
                source=opportunity.sell_orderbook_source,
            ),
        ]
