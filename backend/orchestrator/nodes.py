from __future__ import annotations

import asyncio
import json
import math
import statistics
from datetime import UTC, datetime

from agents.macro_market import MacroAnalysis, MacroAnalyzeRequest, MacroMarketAgent
from gateway.llm_gateway import LLMGatewayService
from orchestrator.schemas import (
    DataIngestionOutput,
    FinalStrategy,
    MarketAnalysisOutput,
    MarketCandle,
    MarketFeature,
    MarketSentiment,
    OrchestrationRequest,
    RiskProfile,
    StrategyCandidate,
    StrategyCritique,
    StrategyOrchestrationResult,
)
from paper.runtime import paper_engine
from services.binance import BinanceClient, normalize_symbol


class OrchestrationNodeError(RuntimeError):
    pass


class StrategyOrchestrationNodes:
    def __init__(
        self,
        *,
        binance_client: BinanceClient | None = None,
        macro_agent: MacroMarketAgent | None = None,
        gateway: LLMGatewayService | None = None,
    ) -> None:
        self.binance_client = binance_client or BinanceClient()
        self.gateway = gateway or LLMGatewayService()
        self.macro_agent = macro_agent or MacroMarketAgent(binance_client=self.binance_client, gateway=self.gateway)

    async def data_ingestion(self, request: OrchestrationRequest) -> DataIngestionOutput:
        symbol = normalize_symbol(request.symbol)
        macro_request = MacroAnalyzeRequest(
            interval=request.interval,
            limit=request.limit,
            include_fred=request.include_fred,
            llm_model=request.llm_model,
        )
        price, ticker, candles, macro_snapshot = await asyncio.gather(
            self.binance_client.get_price(symbol),
            self.binance_client.get_24h_ticker(symbol),
            self.binance_client.get_candles(symbol, interval=request.interval, limit=request.limit),
            self.macro_agent.collect_snapshot(macro_request),
        )
        market_candles = [MarketCandle(**candle.model_dump()) for candle in candles]
        sentiment = self._derive_sentiment(ticker.price_change_percent, market_candles)
        return DataIngestionOutput(
            symbol=symbol,
            interval=request.interval,
            price=price.price,
            ticker_24h=ticker,
            candles=market_candles,
            macro_snapshot=macro_snapshot,
            sentiment=sentiment,
            source="binance_rest_fred_optional",
            timestamp=datetime.now(UTC),
        )

    async def market_analysis(self, ingestion: DataIngestionOutput) -> MarketAnalysisOutput:
        closes = [candle.close for candle in ingestion.candles]
        if len(closes) < 30:
            raise OrchestrationNodeError("not enough real Binance candles for market analysis")

        trend_percent = self._trend_percent(closes)
        volatility_percent = self._realized_volatility_percent(closes)
        drawdown_percent = self._lookback_drawdown_percent(closes)
        liquidity_score = self._liquidity_score(ingestion.ticker_24h.quote_volume)

        trend_direction = self._direction(trend_percent, bullish_threshold=0.15, bearish_threshold=-0.15)
        momentum_direction = self._direction(ingestion.ticker_24h.price_change_percent, bullish_threshold=1.0, bearish_threshold=-1.0)
        volatility_direction = "bearish" if volatility_percent > 85 else "neutral"
        drawdown_direction = "bearish" if drawdown_percent < -5 else "neutral"

        features = [
            MarketFeature(name="trend_percent", value=round(trend_percent, 6), direction=trend_direction, weight=0.3),
            MarketFeature(
                name="momentum_24h_percent",
                value=round(ingestion.ticker_24h.price_change_percent, 6),
                direction=momentum_direction,
                weight=0.25,
            ),
            MarketFeature(
                name="realized_volatility_percent",
                value=round(volatility_percent, 6),
                direction=volatility_direction,
                weight=0.25,
            ),
            MarketFeature(name="lookback_drawdown_percent", value=round(drawdown_percent, 6), direction=drawdown_direction, weight=0.2),
        ]

        return MarketAnalysisOutput(
            symbol=ingestion.symbol,
            close=ingestion.price,
            trend_percent=round(trend_percent, 6),
            momentum_24h_percent=round(ingestion.ticker_24h.price_change_percent, 6),
            realized_volatility_percent=round(volatility_percent, 6),
            lookback_drawdown_percent=round(drawdown_percent, 6),
            quote_volume_24h=round(ingestion.ticker_24h.quote_volume, 4),
            liquidity_score=liquidity_score,
            features=features,
            timestamp=datetime.now(UTC),
        )

    async def macro_agent_node(
        self,
        request: OrchestrationRequest,
        ingestion: DataIngestionOutput,
        market_analysis: MarketAnalysisOutput,
    ) -> MacroAnalysis:
        prompt = (
            "Analyze this real market and macro snapshot for a quant trading workflow.\n"
            "Use only the provided JSON. Do not invent missing FRED values.\n"
            "Return a conservative macro regime.\n\n"
            f"REQUEST_JSON:\n{request.model_dump_json()}\n\n"
            f"MARKET_ANALYSIS_JSON:\n{market_analysis.model_dump_json()}\n\n"
            f"SENTIMENT_JSON:\n{ingestion.sentiment.model_dump_json()}\n\n"
            f"MACRO_SNAPSHOT_JSON:\n{ingestion.macro_snapshot.model_dump_json()}"
        )
        return await self.gateway.invoke_structured(
            prompt=prompt,
            output_model=MacroAnalysis,
            system_prompt=(
                "You are the Macro Agent in a trading multi-agent DAG. "
                "All inputs are real backend data. Output strict JSON only."
            ),
            model=request.llm_model,
            max_retries=request.max_llm_retries,
        )

    async def strategy_agent_node(
        self,
        request: OrchestrationRequest,
        ingestion: DataIngestionOutput,
        market_analysis: MarketAnalysisOutput,
        macro_analysis: MacroAnalysis,
    ) -> StrategyCandidate:
        prompt = (
            "Generate one candidate trading strategy for paper evaluation only.\n"
            "Use real backend data only. Do not assume unavailable data.\n"
            "Use side flat when evidence is weak or risk conflicts.\n"
            "For flat strategies, set stop_loss_price and take_profit_price to 0.\n\n"
            f"REQUEST_JSON:\n{request.model_dump_json()}\n\n"
            f"PRICE_JSON:\n{json.dumps({'symbol': ingestion.symbol, 'price': ingestion.price})}\n\n"
            f"MARKET_ANALYSIS_JSON:\n{market_analysis.model_dump_json()}\n\n"
            f"MACRO_ANALYSIS_JSON:\n{macro_analysis.model_dump_json()}\n\n"
            f"SENTIMENT_JSON:\n{ingestion.sentiment.model_dump_json()}"
        )
        return await self.gateway.invoke_structured(
            prompt=prompt,
            output_model=StrategyCandidate,
            system_prompt=(
                "You are the Strategy Agent in a quant trading system. "
                "You create candidates, not real broker orders. "
                "LLM access is only through this gateway."
            ),
            model=request.llm_model,
            max_retries=request.max_llm_retries,
        )

    async def critic_agent_node(
        self,
        request: OrchestrationRequest,
        market_analysis: MarketAnalysisOutput,
        macro_analysis: MacroAnalysis,
        strategy: StrategyCandidate,
    ) -> StrategyCritique:
        prompt = (
            "Critique the candidate strategy for consistency, overconfidence, and missing risk controls.\n"
            "Reject strategies that contradict the real market/macro data or lack coherent stops.\n\n"
            f"REQUEST_JSON:\n{request.model_dump_json()}\n\n"
            f"MARKET_ANALYSIS_JSON:\n{market_analysis.model_dump_json()}\n\n"
            f"MACRO_ANALYSIS_JSON:\n{macro_analysis.model_dump_json()}\n\n"
            f"STRATEGY_JSON:\n{strategy.model_dump_json()}"
        )
        return await self.gateway.invoke_structured(
            prompt=prompt,
            output_model=StrategyCritique,
            system_prompt=(
                "You are the Critic Agent in a trading multi-agent DAG. "
                "Prefer rejection when evidence is ambiguous. Output strict JSON only."
            ),
            model=request.llm_model,
            max_retries=request.max_llm_retries,
        )

    async def risk_agent_node(
        self,
        ingestion: DataIngestionOutput,
        market_analysis: MarketAnalysisOutput,
        strategy: StrategyCandidate,
    ) -> RiskProfile:
        state = await paper_engine.mark_to_market(
            ingestion.symbol,
            market_price=ingestion.price,
            source="binance_rest_orchestration_snapshot",
        )
        risk_limits = await paper_engine.get_risk_limits()

        side_multiplier = 1.0 if strategy.side == "long" else -1.0 if strategy.side == "short" else 0.0
        requested_notional = risk_limits.max_position_notional * strategy.position_size_fraction if side_multiplier else 0.0
        projected_exposure = abs(state.position.market_value + (side_multiplier * requested_notional))
        estimated_drawdown = requested_notional * self._drawdown_factor(market_analysis)

        violations: list[str] = []
        if requested_notional > risk_limits.max_order_notional:
            violations.append("max_order_notional")
        if projected_exposure > risk_limits.max_position_notional:
            violations.append("max_position_notional")
        if strategy.side == "short" and not risk_limits.allow_short:
            violations.append("short_selling_disabled")
        if estimated_drawdown > risk_limits.max_realized_loss:
            violations.append("max_realized_loss")

        return RiskProfile(
            symbol=ingestion.symbol,
            side=strategy.side,
            current_price=round(ingestion.price, 8),
            requested_notional=round(requested_notional, 8),
            projected_exposure=round(projected_exposure, 8),
            estimated_drawdown=round(estimated_drawdown, 8),
            realized_volatility_percent=market_analysis.realized_volatility_percent,
            lookback_drawdown_percent=market_analysis.lookback_drawdown_percent,
            current_position_quantity=state.position.quantity,
            current_position_market_value=state.position.market_value,
            risk_limits=risk_limits,
            within_limits=not violations,
            violations=violations,
        )

    async def final_decision_node(
        self,
        macro_analysis: MacroAnalysis,
        strategy: StrategyCandidate,
        critique: StrategyCritique,
        risk_profile: RiskProfile,
    ) -> StrategyOrchestrationResult:
        rejection_reasons = list(critique.violations) + list(risk_profile.violations)
        approved = critique.accepted and risk_profile.within_limits and strategy.side != "flat"
        status = "approved" if approved else "observe" if strategy.side == "flat" and risk_profile.within_limits else "rejected"
        confidence = min(strategy.confidence, critique.score, macro_analysis.confidence)
        if not risk_profile.within_limits:
            confidence = min(confidence, 0.35)

        final_strategy = FinalStrategy(
            status=status,
            name=strategy.name,
            symbol=strategy.symbol,
            side=strategy.side if approved else "flat",
            time_horizon=strategy.time_horizon,
            entry_price=strategy.entry_price if approved else 0.0,
            stop_loss_price=strategy.stop_loss_price if approved else 0.0,
            take_profit_price=strategy.take_profit_price if approved else 0.0,
            position_size_fraction=strategy.position_size_fraction if approved else 0.0,
            confidence=round(confidence, 6),
            rejection_reasons=rejection_reasons,
            signals=strategy.signals,
            rationale=strategy.rationale,
        )

        reasoning_chain = [
            f"macro_regime={macro_analysis.regime}; confidence={macro_analysis.confidence}",
            f"strategy_candidate={strategy.side}; strategy_confidence={strategy.confidence}",
            f"critic_accepted={critique.accepted}; critic_score={critique.score}",
            f"risk_within_limits={risk_profile.within_limits}; violations={risk_profile.violations}",
            f"final_status={status}",
        ]

        return StrategyOrchestrationResult(
            strategy=final_strategy,
            risk_profile=risk_profile,
            confidence=round(confidence, 6),
            regime=macro_analysis.regime,
            reasoning_chain=reasoning_chain,
        )

    def _derive_sentiment(self, change_24h_percent: float, candles: list[MarketCandle]) -> MarketSentiment:
        closes = [candle.close for candle in candles]
        trend = self._trend_percent(closes) if len(closes) >= 30 else 0.0
        volatility = self._realized_volatility_percent(closes) if len(closes) >= 30 else 0.0
        score = (change_24h_percent / 8.0) + (trend / 4.0)
        if volatility > 90 and score > 0:
            score *= 0.6
        score = max(-1.0, min(1.0, score))
        label = self._direction(score, bullish_threshold=0.1, bearish_threshold=-0.1)
        return MarketSentiment(
            source="binance_derived_market_sentiment",
            score=round(score, 6),
            label=label,
            inputs=["ticker_24h_price_change", "ohlcv_trend", "realized_volatility"],
        )

    def _trend_percent(self, closes: list[float]) -> float:
        lookback = min(20, len(closes))
        baseline = statistics.fmean(closes[-lookback:])
        if baseline <= 0:
            return 0.0
        return ((closes[-1] - baseline) / baseline) * 100

    def _realized_volatility_percent(self, closes: list[float]) -> float:
        returns = [
            math.log(closes[index] / closes[index - 1])
            for index in range(1, len(closes))
            if closes[index - 1] > 0 and closes[index] > 0
        ]
        if len(returns) < 2:
            return 0.0
        return statistics.stdev(returns) * math.sqrt(365 * 24) * 100

    def _lookback_drawdown_percent(self, closes: list[float]) -> float:
        running_max = closes[0]
        max_drawdown = 0.0
        for close in closes:
            running_max = max(running_max, close)
            if running_max > 0:
                max_drawdown = min(max_drawdown, (close / running_max - 1.0) * 100)
        return max_drawdown

    def _liquidity_score(self, quote_volume_24h: float) -> float:
        return round(max(0.0, min(1.0, math.log10(max(quote_volume_24h, 1.0)) / 10.0)), 6)

    def _drawdown_factor(self, market_analysis: MarketAnalysisOutput) -> float:
        volatility_component = max(0.01, market_analysis.realized_volatility_percent / 100 / math.sqrt(365))
        drawdown_component = abs(market_analysis.lookback_drawdown_percent) / 100
        return min(0.5, max(volatility_component, drawdown_component))

    def _direction(
        self,
        value: float,
        *,
        bullish_threshold: float,
        bearish_threshold: float,
    ) -> str:
        if value >= bullish_threshold:
            return "bullish"
        if value <= bearish_threshold:
            return "bearish"
        return "neutral"
