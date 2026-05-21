from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import UTC, datetime

import numpy as np
import pandas as pd

from paper.schemas import TradeExecution
from data_quality.engine import DataQualityEngine
from data_quality.schemas import DataQualityRequest
from research_platform.evaluation import EvaluationEngine
from research_platform.registry import StrategyRegistry
from research_platform.schemas import (
    PaperResultRecord,
    PerformanceMatrixEntry,
    QuantResearchOutput,
    QuantResearchRequest,
    RegimeName,
    RegimePerformance,
    ResearchRunRecord,
    StrategyEvaluationRecord,
    StrategyRegistryInput,
    StrategyRegistryRecord,
)
from research_platform.selection import SelectionEngine
from research_platform.storage import PostgresResearchStore, strategy_ids
from rl.data_loader import RLMarketDataLoader


class ResearchLoopController:
    def __init__(
        self,
        *,
        store: PostgresResearchStore | None = None,
        data_loader: RLMarketDataLoader | None = None,
        registry: StrategyRegistry | None = None,
        evaluation_engine: EvaluationEngine | None = None,
        selection_engine: SelectionEngine | None = None,
        quality_engine: DataQualityEngine | None = None,
    ) -> None:
        self.store = store or PostgresResearchStore()
        self.data_loader = data_loader or RLMarketDataLoader()
        self.registry = registry or StrategyRegistry(self.store)
        self.evaluation_engine = evaluation_engine or EvaluationEngine()
        self.selection_engine = selection_engine or SelectionEngine()
        self.quality_engine = quality_engine or DataQualityEngine()

    async def run(self, request: QuantResearchRequest) -> QuantResearchOutput:
        await asyncio.to_thread(self.store.ensure_schema)
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
            raise ValueError(f"research platform blocked by data quality: {issue_codes}")
        candidates = await asyncio.to_thread(
            self.registry.generated_candidates,
            ohlcv=ohlcv,
            max_candidates=request.max_candidates,
            exploration_rate=request.exploration_rate,
            force_new_generation=request.force_new_generation,
            train_ratio=request.train_ratio,
            validation_ratio=request.validation_ratio,
        )
        evaluations, failures = await self._evaluate_candidates(request=request, ohlcv=ohlcv, candidates=candidates)
        best, rejected = self.selection_engine.select(evaluations=evaluations, top_n=request.top_n)
        final_records = [*best, *rejected]
        for record in final_records:
            await asyncio.to_thread(self.store.insert_evaluation, record)

        performance_matrix = self._performance_matrix(final_records)
        regime_breakdown = self._regime_breakdown(final_records)
        system_health_score = self._system_health_score(
            requested_rows=request.limit,
            actual_rows=len(ohlcv),
            candidate_count=len(candidates),
            evaluated_count=len(evaluations),
            selected_count=len(best),
            failure_count=failures,
        )
        output = QuantResearchOutput(
            best_strategies=best,
            rejected_strategies=rejected,
            performance_matrix=performance_matrix,
            regime_breakdown=regime_breakdown,
            system_health_score=system_health_score,
        )
        run_record = ResearchRunRecord(
            run_id=self._run_id(request=request, output=output, data_start=ohlcv.index[0], data_end=ohlcv.index[-1]),
            request=request,
            best_strategy_ids=strategy_ids(best),
            rejected_strategy_ids=strategy_ids(rejected),
            performance_matrix=performance_matrix,
            regime_breakdown=regime_breakdown,
            system_health_score=system_health_score,
            created_at=datetime.now(UTC),
        )
        await asyncio.to_thread(self.store.insert_run, run_record)
        return output

    async def register_strategy(self, strategy: StrategyRegistryInput) -> StrategyRegistryRecord:
        return await asyncio.to_thread(self.registry.register, strategy)

    async def list_strategies(self, *, limit: int, status: str | None) -> list[StrategyRegistryRecord]:
        return await asyncio.to_thread(self.store.list_strategies, limit=limit, status=status)

    async def list_evaluations(
        self,
        *,
        limit: int,
        strategy_id: str | None,
        selection_status: str | None,
    ) -> list[StrategyEvaluationRecord]:
        return await asyncio.to_thread(
            self.store.list_evaluations,
            limit=limit,
            strategy_id=strategy_id,
            selection_status=selection_status,
        )

    async def list_runs(self, *, limit: int) -> list[ResearchRunRecord]:
        return await asyncio.to_thread(self.store.list_runs, limit=limit)

    async def record_paper_feedback(
        self,
        *,
        strategy_id: str,
        symbol: str,
        trades: list[TradeExecution],
    ) -> PaperResultRecord:
        if not trades:
            raise ValueError("no real paper trades available for strategy feedback")
        realized = float(sum(trade.realized_pnl_delta for trade in trades))
        total_notional = float(sum(trade.notional for trade in trades))
        if total_notional <= 0:
            raise ValueError("paper trades contain no positive notional")
        closing_trades = [trade for trade in trades if trade.realized_pnl_delta != 0]
        win_rate = None
        if closing_trades:
            win_rate = float(sum(trade.realized_pnl_delta > 0 for trade in closing_trades) / len(closing_trades))
        payload = {
            "strategy_id": strategy_id,
            "symbol": symbol,
            "trade_ids": [trade.id for trade in trades],
            "realized": round(realized, 8),
            "total_notional": round(total_notional, 8),
        }
        record = PaperResultRecord(
            paper_result_id=f"paper_{hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:18]}",
            strategy_id=strategy_id,
            symbol=symbol,
            trade_count=len(trades),
            realized_pnl=round(realized, 8),
            total_notional=round(total_notional, 8),
            win_rate=round(win_rate, 8) if win_rate is not None else None,
            source="real_paper_trading_engine_trades",
            created_at=datetime.now(UTC),
        )
        return await asyncio.to_thread(self.store.insert_paper_result, record)

    async def _evaluate_candidates(
        self,
        *,
        request: QuantResearchRequest,
        ohlcv: pd.DataFrame,
        candidates: list[StrategyRegistryRecord],
    ) -> tuple[list[StrategyEvaluationRecord], int]:
        evaluations: list[StrategyEvaluationRecord] = []
        failures = 0
        for strategy in candidates:
            try:
                evaluations.append(
                    await asyncio.to_thread(
                        self.evaluation_engine.evaluate,
                        request=request,
                        strategy=strategy,
                        ohlcv=ohlcv,
                    )
                )
            except Exception as error:
                failures += 1
                await asyncio.to_thread(
                    self.store.record_error,
                    component="evaluation_engine",
                    strategy_id=strategy.strategy_id,
                    payload={
                        "version_id": strategy.version_id,
                        "exchange": request.exchange,
                        "symbol": request.symbol,
                        "interval": request.interval,
                        "error": str(error),
                    },
                )
        return evaluations, failures

    def _performance_matrix(self, records: list[StrategyEvaluationRecord]) -> dict[str, PerformanceMatrixEntry]:
        return {
            record.version_id: PerformanceMatrixEntry(
                strategy_id=record.strategy_id,
                version_id=record.version_id,
                ranking_score=record.ranking_score,
                selection_status=record.selection_status,
                train_return=record.train.metrics.total_return,
                validation_return=record.validation.metrics.total_return,
                test_return=record.test.metrics.total_return,
                full_return=record.full.metrics.total_return,
                test_sharpe=record.test.metrics.sharpe_ratio,
                test_sortino=record.test.metrics.sortino_ratio,
                test_drawdown=record.test.metrics.max_drawdown,
                test_win_rate=record.test.metrics.win_rate,
                test_profit_factor=record.test.metrics.profit_factor,
                test_stability=record.test.metrics.stability_over_time,
                overfit_score=record.overfit_score,
            )
            for record in records
        }

    def _regime_breakdown(self, records: list[StrategyEvaluationRecord]) -> dict[RegimeName, list[RegimePerformance]]:
        output: dict[RegimeName, list[RegimePerformance]] = {
            "bull_market": [],
            "bear_market": [],
            "high_volatility": [],
            "low_liquidity": [],
        }
        for record in records:
            for regime, breakdown in record.regime_breakdown.items():
                output[regime].append(breakdown)
        return output

    def _system_health_score(
        self,
        *,
        requested_rows: int,
        actual_rows: int,
        candidate_count: int,
        evaluated_count: int,
        selected_count: int,
        failure_count: int,
    ) -> float:
        data_health = min(1.0, actual_rows / max(1, requested_rows))
        evaluation_health = evaluated_count / max(1, candidate_count)
        selected_health = min(1.0, selected_count / max(1, evaluated_count))
        error_penalty = min(0.5, failure_count / max(1, candidate_count))
        health = 0.42 * data_health + 0.33 * evaluation_health + 0.15 * selected_health + 0.10 * (1.0 - error_penalty)
        return round(float(np.clip(health, 0.0, 1.0)), 8)

    def _run_id(
        self,
        *,
        request: QuantResearchRequest,
        output: QuantResearchOutput,
        data_start: pd.Timestamp,
        data_end: pd.Timestamp,
    ) -> str:
        payload = {
            "request": request.model_dump(mode="json"),
            "best": [item.evaluation_id for item in output.best_strategies],
            "rejected": [item.evaluation_id for item in output.rejected_strategies],
            "data_start": data_start.isoformat(),
            "data_end": data_end.isoformat(),
            "created_at": datetime.now(UTC).isoformat(),
        }
        return f"research_platform_run_{hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:18]}"
