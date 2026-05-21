from __future__ import annotations

import hashlib
import json
import math
import statistics
from datetime import UTC, datetime
from typing import Any

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

from backtest.engine import BacktestEngine, StrategyConfig
from backtest.metrics import MetricsCalculator, PerformanceMetrics
from data_quality.engine import DataQualityEngine
from data_quality.schemas import DataQualityRequest
from gateway.llm_gateway import LLMGatewayService
from research.memory import ResearchMemoryStore
from research.schemas import (
    BacktestSplitResult,
    PerformanceEvolutionPoint,
    ResearchCritique,
    ResearchLabRequest,
    ResearchRiskValidation,
    ResearchRunRecord,
    ResearchStrategyProposal,
    ResearchStrategyResult,
    StrategyGenerationPlan,
)
from rl.data_loader import RLMarketDataLoader


class ResearchLabNodeError(RuntimeError):
    pass


class ResearchLabNodes:
    def __init__(
        self,
        *,
        data_loader: RLMarketDataLoader | None = None,
        backtest_engine: BacktestEngine | None = None,
        metrics: MetricsCalculator | None = None,
        memory: ResearchMemoryStore | None = None,
        gateway: LLMGatewayService | None = None,
        quality_engine: DataQualityEngine | None = None,
    ) -> None:
        self.data_loader = data_loader or RLMarketDataLoader()
        self.backtest_engine = backtest_engine or BacktestEngine()
        self.metrics = metrics or MetricsCalculator()
        self.memory = memory or ResearchMemoryStore()
        self.gateway = gateway or LLMGatewayService()
        self.quality_engine = quality_engine or DataQualityEngine()

    async def data_ingestion(self, request: ResearchLabRequest) -> dict[str, Any]:
        ohlcv = await self.data_loader.download_ohlcv(
            exchange=request.exchange,
            symbol=request.symbol,
            interval=request.interval,
            limit=request.limit,
        )
        quality = self.quality_engine.evaluate_frame(
            request=DataQualityRequest(
                exchange=request.exchange,
                symbol=request.symbol,
                interval=request.interval,
                limit=request.limit,
                compare_cross_exchange=False,
            ),
            frame=ohlcv,
        )
        if not quality.usable_for_backtest:
            issue_codes = ", ".join(issue.code for issue in quality.issues) or "quality_score_below_threshold"
            raise ResearchLabNodeError(f"research lab blocked by data quality: {issue_codes}")
        train, validation, test = self._split_ohlcv(
            ohlcv,
            train_ratio=request.train_ratio,
            validation_ratio=request.validation_ratio,
        )
        market_summary = self._market_summary(train)
        return {
            "ohlcv": ohlcv,
            "train": train,
            "validation": validation,
            "test": test,
            "market_summary": market_summary,
            "memory_best": self.memory.best_strategies(limit=3),
            "recent_insights": self.memory.recent_insights(limit=3),
        }

    async def strategy_generator(self, request: ResearchLabRequest, ingestion: dict[str, Any]) -> dict[str, Any]:
        deterministic = self._deterministic_proposals(request, ingestion)
        llm_plan = StrategyGenerationPlan(proposals=[], research_insight="")
        if request.use_llm_generator:
            llm_plan = await self._llm_proposals(request, ingestion, deterministic)
        proposals = self._dedupe_and_bound(
            [*deterministic, *llm_plan.proposals],
            max_candidates=request.max_candidates,
            max_slow_window=max(4, min(len(ingestion["train"]) - 2, 1000)),
            fees=request.fees,
        )
        if not proposals:
            raise ResearchLabNodeError("strategy generator produced no valid candidates")
        insight = llm_plan.research_insight or self._deterministic_insight(ingestion)
        return {"proposals": proposals, "generator_insight": insight}

    async def backtesting_engine(
        self,
        request: ResearchLabRequest,
        ingestion: dict[str, Any],
        generation: dict[str, Any],
    ) -> dict[str, Any]:
        results: list[ResearchStrategyResult] = []
        for proposal in generation["proposals"]:
            try:
                train_result = self._run_split("train", ingestion["train"], proposal, request)
                validation_result = self._run_split("validation", ingestion["validation"], proposal, request)
                test_result = self._run_split("test", ingestion["test"], proposal, request)
                full_result = self._run_split("full", ingestion["ohlcv"], proposal, request)
                critique = self.critic_agent(
                    request=request,
                    proposal=proposal,
                    train=train_result,
                    validation=validation_result,
                    test=test_result,
                )
                risk = self.risk_validator(request=request, validation=validation_result, test=test_result, full=full_result)
                rejection_reasons = [*critique.statistical_issues, *risk.violations]
                selected = critique.accepted and risk.accepted
                selection_score = self._selection_score(validation_result, test_result, critique, risk)
                results.append(
                    ResearchStrategyResult(
                        strategy_id=self._strategy_id(proposal, request.exchange, request.symbol, request.interval),
                        status="selected" if selected else "rejected",
                        proposal=proposal,
                        exchange=request.exchange,
                        symbol=request.symbol,
                        interval=request.interval,
                        train=train_result,
                        validation=validation_result,
                        test=test_result,
                        full=full_result,
                        critique=critique,
                        risk_validation=risk,
                        selection_score=round(selection_score, 8),
                        rejection_reasons=rejection_reasons,
                        created_at=datetime.now(UTC),
                    )
                )
            except Exception as error:
                results.append(self._failed_result(request, proposal, str(error), ingestion))
        return {"evaluated_strategies": results}

    def critic_agent(
        self,
        *,
        request: ResearchLabRequest,
        proposal: ResearchStrategyProposal,
        train: BacktestSplitResult,
        validation: BacktestSplitResult,
        test: BacktestSplitResult,
    ) -> ResearchCritique:
        issues: list[str] = []
        overfit_score = self._overfit_score(train.metrics, validation.metrics, test.metrics)
        if overfit_score > request.max_overfit_score:
            issues.append("overfit_score_above_threshold")
        if validation.metrics.total_trades < request.min_validation_trades:
            issues.append("insufficient_validation_trades")
        if test.metrics.total_trades < request.min_test_trades:
            issues.append("insufficient_test_trades")
        if validation.metrics.total_return <= 0:
            issues.append("non_positive_validation_return")
        if test.metrics.total_return <= 0:
            issues.append("non_positive_test_return")
        validation_sharpe = validation.metrics.sharpe_ratio if validation.metrics.sharpe_ratio is not None else -math.inf
        test_sharpe = test.metrics.sharpe_ratio if test.metrics.sharpe_ratio is not None else -math.inf
        if validation_sharpe <= 0 and test_sharpe <= 0:
            issues.append("non_positive_out_of_sample_sharpe")
        if validation.metrics.total_return > 0 and test.metrics.total_return < 0:
            issues.append("validation_test_return_sign_flip")
        if proposal.fast_window >= proposal.slow_window:
            issues.append("invalid_window_order")
        if proposal.slow_window > validation.rows // 2:
            issues.append("slow_window_too_large_for_validation")

        accepted = not issues
        return ResearchCritique(
            accepted=accepted,
            overfit_score=round(overfit_score, 8),
            statistical_issues=issues,
            rationale=(
                "accepted: validation/test behavior is consistent"
                if accepted
                else f"rejected: {', '.join(issues)}"
            ),
        )

    def risk_validator(
        self,
        *,
        request: ResearchLabRequest,
        validation: BacktestSplitResult,
        test: BacktestSplitResult,
        full: BacktestSplitResult,
    ) -> ResearchRiskValidation:
        violations: list[str] = []
        worst_drawdown = min(validation.metrics.max_drawdown, test.metrics.max_drawdown, full.metrics.max_drawdown)
        if abs(worst_drawdown) > request.max_drawdown:
            violations.append("max_drawdown_exceeded")
        if validation.stability_score < request.min_stability_score:
            violations.append("validation_stability_below_threshold")
        if test.stability_score < request.min_stability_score:
            violations.append("test_stability_below_threshold")
        if test.metrics.final_value <= 0:
            violations.append("capital_depleted")
        risk_score = min(
            1.0,
            0.5 * min(1.0, abs(worst_drawdown) / request.max_drawdown)
            + 0.25 * (1.0 - validation.stability_score)
            + 0.25 * (1.0 - test.stability_score)
            + 0.12 * len(violations),
        )
        return ResearchRiskValidation(
            accepted=not violations,
            risk_score=round(risk_score, 8),
            violations=violations,
        )

    async def selector(
        self,
        request: ResearchLabRequest,
        backtests: dict[str, Any],
    ) -> dict[str, Any]:
        evaluated = list(backtests["evaluated_strategies"])
        selected = [strategy for strategy in evaluated if strategy.status == "selected"]
        selected.sort(key=lambda strategy: strategy.selection_score, reverse=True)
        rejected = [strategy for strategy in evaluated if strategy.status == "rejected"]
        return {
            "best_strategies": selected,
            "rejected_strategies": rejected,
            "run_point": self._run_point(request, selected, rejected),
        }

    async def memory_store(self, selector_output: dict[str, Any], research_insights: str) -> dict[str, Any]:
        strategies = [*selector_output["best_strategies"], *selector_output["rejected_strategies"]]
        run_record = ResearchRunRecord(
            run=selector_output["run_point"],
            strategies=strategies,
            research_insights=research_insights,
        )
        self.memory.append_run(run_record)
        performance_evolution = self.memory.list_runs(limit=50)
        return {"performance_evolution": performance_evolution}

    def _deterministic_proposals(self, request: ResearchLabRequest, ingestion: dict[str, Any]) -> list[ResearchStrategyProposal]:
        summary = ingestion["market_summary"]
        rows = len(ingestion["train"])
        max_slow = max(6, min(rows // 2, 240))
        trend_abs = abs(summary["trend_return"])
        volatility = summary["realized_volatility"]
        base_pairs = [(8, 21), (12, 36), (20, 60), (34, 120)]
        if volatility > 0.9:
            base_pairs.extend([(24, 96), (48, 180)])
        if trend_abs > 0.05:
            base_pairs.extend([(5, 30), (16, 80)])

        proposals = [
            ResearchStrategyProposal(
                name=f"sma_cross_{fast}_{slow}",
                fast_window=fast,
                slow_window=slow,
                rationale="deterministic proposal derived from real train-window trend and volatility",
                source="deterministic_real_data_agent",
            )
            for fast, slow in base_pairs
            if fast < slow <= max_slow
        ]
        proposals.extend(self._memory_mutations(ingestion, max_slow=max_slow))
        return proposals

    async def _llm_proposals(
        self,
        request: ResearchLabRequest,
        ingestion: dict[str, Any],
        deterministic: list[ResearchStrategyProposal],
    ) -> StrategyGenerationPlan:
        prompt = (
            "Generate SMA cross strategy candidates for real historical backtesting only.\n"
            "Do not invent performance results. Return only candidate parameters and concise research insight.\n"
            "Candidates must satisfy fast_window < slow_window and fit inside the train rows.\n\n"
            f"REQUEST_JSON:\n{request.model_dump_json()}\n\n"
            f"REAL_MARKET_SUMMARY_JSON:\n{json.dumps(ingestion['market_summary'], ensure_ascii=False)}\n\n"
            f"MEMORY_BEST_STRATEGIES_JSON:\n"
            f"{json.dumps([item.model_dump(mode='json') for item in ingestion['memory_best']], ensure_ascii=False)}\n\n"
            f"DETERMINISTIC_BASELINES_JSON:\n"
            f"{json.dumps([item.model_dump(mode='json') for item in deterministic], ensure_ascii=False)}"
        )
        return await self.gateway.invoke_structured(
            prompt=prompt,
            output_model=StrategyGenerationPlan,
            system_prompt=(
                "You are a Strategy Generator Agent in an autonomous quant research lab. "
                "All OpenAI access must go through this LLM Gateway. Output strict JSON only."
            ),
            model=request.llm_model,
            max_retries=request.max_llm_retries,
        )

    def _run_split(
        self,
        split: str,
        ohlcv: pd.DataFrame,
        proposal: ResearchStrategyProposal,
        request: ResearchLabRequest,
    ) -> BacktestSplitResult:
        config = StrategyConfig(
            name="sma_cross",
            fast_window=proposal.fast_window,
            slow_window=proposal.slow_window,
            initial_cash=request.initial_cash,
            fees=request.fees,
        )
        if len(ohlcv) < config.slow_window + 2:
            raise ValueError(f"not enough rows for {split} split")
        portfolio, signals = self.backtest_engine.run(ohlcv, config)
        metrics = self.metrics.calculate(portfolio)
        stability = self._stability_score(portfolio.value())
        return BacktestSplitResult(
            split=split,  # type: ignore[arg-type]
            rows=len(ohlcv),
            start=ohlcv.index[0].to_pydatetime().astimezone(UTC),
            end=ohlcv.index[-1].to_pydatetime().astimezone(UTC),
            metrics=metrics,
            entries_count=signals.entries_count,
            exits_count=signals.exits_count,
            stability_score=round(stability, 8),
        )

    def _split_ohlcv(
        self,
        ohlcv: pd.DataFrame,
        *,
        train_ratio: float,
        validation_ratio: float,
    ) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        if len(ohlcv) < 180:
            raise ValueError("at least 180 real OHLCV rows are required for autonomous research")
        train_end = int(len(ohlcv) * train_ratio)
        validation_end = train_end + int(len(ohlcv) * validation_ratio)
        train = ohlcv.iloc[:train_end].copy()
        validation = ohlcv.iloc[train_end:validation_end].copy()
        test = ohlcv.iloc[validation_end:].copy()
        if min(len(train), len(validation), len(test)) < 30:
            raise ValueError("train, validation, and test splits must each contain at least 30 real OHLCV rows")
        return train, validation, test

    def _market_summary(self, ohlcv: pd.DataFrame) -> dict[str, Any]:
        close = ohlcv["close"].astype(float)
        returns = close.pct_change().replace([np.inf, -np.inf], np.nan).dropna()
        trend_return = float((close.iloc[-1] / close.iloc[0]) - 1.0)
        realized_volatility = float(returns.std(ddof=1) * math.sqrt(max(1, len(returns)))) if len(returns) > 1 else 0.0
        running_max = close.cummax()
        max_drawdown = float(((close / running_max) - 1.0).min())
        return {
            "rows": len(ohlcv),
            "start": ohlcv.index[0].isoformat(),
            "end": ohlcv.index[-1].isoformat(),
            "first_close": round(float(close.iloc[0]), 8),
            "last_close": round(float(close.iloc[-1]), 8),
            "trend_return": round(trend_return, 8),
            "realized_volatility": round(realized_volatility, 8),
            "max_drawdown": round(max_drawdown, 8),
            "median_volume": round(float(ohlcv["volume"].median()), 8),
        }

    def _memory_mutations(self, ingestion: dict[str, Any], *, max_slow: int) -> list[ResearchStrategyProposal]:
        proposals: list[ResearchStrategyProposal] = []
        for record in ingestion["memory_best"]:
            fast = record.proposal.fast_window
            slow = record.proposal.slow_window
            for delta_fast, delta_slow in [(-2, -5), (2, 5), (4, 10)]:
                candidate_fast = max(2, fast + delta_fast)
                candidate_slow = min(max_slow, max(candidate_fast + 3, slow + delta_slow))
                if candidate_fast < candidate_slow:
                    proposals.append(
                        ResearchStrategyProposal(
                            name=f"memory_mutation_{candidate_fast}_{candidate_slow}",
                            fast_window=candidate_fast,
                            slow_window=candidate_slow,
                            rationale="mutation of previously selected real-backtested strategy",
                            source="memory_mutation",
                        )
                    )
        return proposals

    def _dedupe_and_bound(
        self,
        proposals: list[ResearchStrategyProposal],
        *,
        max_candidates: int,
        max_slow_window: int,
        fees: float,
    ) -> list[ResearchStrategyProposal]:
        del fees
        unique: dict[tuple[int, int], ResearchStrategyProposal] = {}
        for proposal in proposals:
            if proposal.fast_window >= proposal.slow_window:
                continue
            if proposal.slow_window > max_slow_window:
                continue
            unique.setdefault((proposal.fast_window, proposal.slow_window), proposal)
        return list(unique.values())[:max_candidates]

    def _overfit_score(
        self,
        train: PerformanceMetrics,
        validation: PerformanceMetrics,
        test: PerformanceMetrics,
    ) -> float:
        train_score = self._metric_score(train)
        validation_score = self._metric_score(validation)
        test_score = self._metric_score(test)
        train_validation_gap = max(0.0, train_score - validation_score)
        validation_test_gap = max(0.0, validation_score - test_score)
        trade_penalty = 0.1 if validation.total_trades == 0 or test.total_trades == 0 else 0.0
        return float(min(1.0, 0.55 * train_validation_gap + 0.35 * validation_test_gap + trade_penalty))

    def _metric_score(self, metrics: PerformanceMetrics) -> float:
        sharpe_component = 0.0 if metrics.sharpe_ratio is None else np.clip((metrics.sharpe_ratio + 1.0) / 4.0, 0.0, 1.0)
        return_component = np.clip((metrics.total_return + 0.2) / 0.6, 0.0, 1.0)
        drawdown_component = 1.0 - np.clip(abs(metrics.max_drawdown) / 0.5, 0.0, 1.0)
        trade_component = np.clip(metrics.total_trades / 10.0, 0.0, 1.0)
        return float(0.35 * sharpe_component + 0.3 * return_component + 0.25 * drawdown_component + 0.1 * trade_component)

    def _selection_score(
        self,
        validation: BacktestSplitResult,
        test: BacktestSplitResult,
        critique: ResearchCritique,
        risk: ResearchRiskValidation,
    ) -> float:
        return float(
            0.35 * self._metric_score(validation.metrics)
            + 0.4 * self._metric_score(test.metrics)
            + 0.15 * test.stability_score
            + 0.1 * (1.0 - critique.overfit_score)
            - 0.2 * risk.risk_score
        )

    def _stability_score(self, value: pd.Series) -> float:
        clean = value.astype(float).replace([np.inf, -np.inf], np.nan).dropna()
        if len(clean) < 5:
            return 0.0
        normalized = (clean / clean.iloc[0]) - 1.0
        x = np.arange(len(normalized), dtype=float).reshape(-1, 1)
        y = normalized.to_numpy(dtype=float)
        model = LinearRegression().fit(x, y)
        r2 = max(0.0, float(model.score(x, y)))
        slope_component = 1.0 if float(model.coef_[0]) > 0 else 0.0
        segments = min(8, max(3, len(clean) // 20))
        segment_returns = [
            float((segment[-1] / segment[0]) - 1.0)
            for segment in np.array_split(clean.to_numpy(dtype=float), segments)
            if len(segment) >= 2 and segment[0] != 0
        ]
        positive_ratio = float(statistics.fmean([item > 0 for item in segment_returns])) if segment_returns else 0.0
        return float(np.clip(0.4 * r2 + 0.35 * positive_ratio + 0.25 * slope_component, 0.0, 1.0))

    def _strategy_id(self, proposal: ResearchStrategyProposal, exchange: str, symbol: str, interval: str) -> str:
        payload = {
            "exchange": exchange,
            "symbol": symbol,
            "interval": interval,
            "fast_window": proposal.fast_window,
            "slow_window": proposal.slow_window,
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return f"research_{hashlib.sha256(encoded).hexdigest()[:16]}"

    def _run_point(
        self,
        request: ResearchLabRequest,
        selected: list[ResearchStrategyResult],
        rejected: list[ResearchStrategyResult],
    ) -> PerformanceEvolutionPoint:
        best = selected[0] if selected else None
        run_payload = {
            "exchange": request.exchange,
            "symbol": request.symbol,
            "interval": request.interval,
            "timestamp": datetime.now(UTC).isoformat(),
            "selected": [item.strategy_id for item in selected],
            "rejected": [item.strategy_id for item in rejected],
        }
        run_id = f"research_run_{hashlib.sha256(json.dumps(run_payload, sort_keys=True).encode()).hexdigest()[:16]}"
        return PerformanceEvolutionPoint(
            run_id=run_id,
            created_at=datetime.now(UTC),
            exchange=request.exchange,
            symbol=request.symbol,
            interval=request.interval,
            selected_count=len(selected),
            rejected_count=len(rejected),
            best_strategy_id=best.strategy_id if best else None,
            best_score=best.selection_score if best else None,
            best_test_return=best.test.metrics.total_return if best else None,
            best_test_sharpe=best.test.metrics.sharpe_ratio if best else None,
            best_test_drawdown=best.test.metrics.max_drawdown if best else None,
        )

    def _deterministic_insight(self, ingestion: dict[str, Any]) -> str:
        summary = ingestion["market_summary"]
        return (
            "Generated SMA cross candidates from real train-window trend, volatility, drawdown, "
            f"and prior memory. trend_return={summary['trend_return']}, "
            f"realized_volatility={summary['realized_volatility']}, max_drawdown={summary['max_drawdown']}."
        )

    def _failed_result(
        self,
        request: ResearchLabRequest,
        proposal: ResearchStrategyProposal,
        error: str,
        ingestion: dict[str, Any],
    ) -> ResearchStrategyResult:
        placeholder_metrics = PerformanceMetrics(
            total_return=0.0,
            sharpe_ratio=None,
            max_drawdown=0.0,
            win_rate=None,
            total_trades=0,
            final_value=request.initial_cash,
        )
        timestamp = ingestion["ohlcv"].index[0].to_pydatetime().astimezone(UTC)
        split = BacktestSplitResult(
            split="train",
            rows=0,
            start=timestamp,
            end=timestamp,
            metrics=placeholder_metrics,
            entries_count=0,
            exits_count=0,
            stability_score=0.0,
        )
        critique = ResearchCritique(
            accepted=False,
            overfit_score=1.0,
            statistical_issues=[f"backtest_failed:{error}"],
            rationale=f"rejected: backtest failed with real data: {error}",
        )
        risk = ResearchRiskValidation(accepted=False, risk_score=1.0, violations=["backtest_failed"])
        return ResearchStrategyResult(
            strategy_id=self._strategy_id(proposal, request.exchange, request.symbol, request.interval),
            status="rejected",
            proposal=proposal,
            exchange=request.exchange,
            symbol=request.symbol,
            interval=request.interval,
            train=split,
            validation=split.model_copy(update={"split": "validation"}),
            test=split.model_copy(update={"split": "test"}),
            full=split.model_copy(update={"split": "full"}),
            critique=critique,
            risk_validation=risk,
            selection_score=0.0,
            rejection_reasons=[*critique.statistical_issues, *risk.violations],
            created_at=datetime.now(UTC),
        )
