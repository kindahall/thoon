from __future__ import annotations

import os

import optuna
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field

from backtest.data_loader import BinanceHistoricalDataLoader, parse_utc_datetime
from evolution.evaluator import PerformanceEvaluator
from evolution.mutation_engine import StrategyMutationEngine
from evolution.selection import CandidateEvaluation, StrategySelectionEngine
from evolution.strategy_store import (
    EvolvableStrategy,
    EvolutionRunRecord,
    StrategyRepository,
)


class EvolutionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str = "BTCUSDT"
    interval: str = "1h"
    start: str | None = None
    end: str | None = None
    limit: int = Field(default=500, ge=120, le=1000)
    train_ratio: float = Field(default=0.7, gt=0.5, lt=0.9)
    trials: int = Field(default=16, ge=3, le=100)
    min_validation_trades: int = Field(default=2, ge=0, le=100)
    max_slow_window: int = Field(default=240, ge=10, le=500)
    sampler_seed: int | None = 42
    baseline_strategy: EvolvableStrategy = Field(default_factory=EvolvableStrategy)


class EvolutionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    best_strategy_id: str
    improvements_applied: list[str]
    performance_delta: dict[str, float]
    risk_adjustment: str
    confidence_score: float


class StrategyEvolutionEngine:
    def __init__(
        self,
        *,
        data_loader: BinanceHistoricalDataLoader | None = None,
        repository: StrategyRepository | None = None,
        evaluator: PerformanceEvaluator | None = None,
        mutation_engine: StrategyMutationEngine | None = None,
        selection_engine: StrategySelectionEngine | None = None,
    ) -> None:
        self.data_loader = data_loader or BinanceHistoricalDataLoader(
            base_url=os.getenv("BINANCE_REST_BASE_URL", "https://api.binance.com")
        )
        self.repository = repository or StrategyRepository()
        self.evaluator = evaluator or PerformanceEvaluator()
        self.mutation_engine = mutation_engine or StrategyMutationEngine()
        self.selection_engine = selection_engine or StrategySelectionEngine()

    async def run(self, request: EvolutionRequest) -> EvolutionResult:
        ohlcv = await self.data_loader.download_ohlcv(
            symbol=request.symbol,
            interval=request.interval,
            start=parse_utc_datetime(request.start),
            end=parse_utc_datetime(request.end),
            limit=request.limit,
        )
        train, validation = self._split_ohlcv(ohlcv, train_ratio=request.train_ratio)
        max_slow_window = min(request.max_slow_window, len(train) - 5, len(validation) - 5)
        if max_slow_window < 10:
            raise ValueError("not enough real OHLCV rows for train/validation optimization")

        baseline = self._normalize_baseline(request.baseline_strategy, max_slow_window=max_slow_window)
        self.repository.upsert_strategy(baseline, status="candidate", generation=0)
        baseline_evaluation = self._evaluate_candidate(
            strategy=baseline,
            train=train,
            validation=validation,
            request=request,
        )

        strategies_by_id: dict[str, EvolvableStrategy] = {baseline.strategy_id: baseline}
        candidate_evaluations: list[CandidateEvaluation] = []
        optuna.logging.set_verbosity(optuna.logging.WARNING)
        study = optuna.create_study(
            direction="maximize",
            sampler=optuna.samplers.TPESampler(seed=request.sampler_seed),
        )

        def objective(trial: optuna.Trial) -> float:
            try:
                strategy = self.mutation_engine.suggest(
                    trial,
                    baseline=baseline,
                    max_slow_window=max_slow_window,
                )
                strategies_by_id[strategy.strategy_id] = strategy
                self.repository.upsert_strategy(
                    strategy,
                    parent_strategy_id=baseline.strategy_id,
                    generation=1,
                )
                evaluation = self._evaluate_candidate(
                    strategy=strategy,
                    train=train,
                    validation=validation,
                    request=request,
                )
                candidate_evaluations.append(evaluation)
                trial.set_user_attr("strategy_id", strategy.strategy_id)
                trial.set_user_attr("overfit_score", evaluation.overfit_score)
                trial.set_user_attr("robust", evaluation.robust)
                return float(evaluation.validation.score - 0.6 * evaluation.overfit_score)
            except Exception as error:
                trial.set_user_attr("error", str(error))
                return -1.0

        study.optimize(objective, n_trials=request.trials, show_progress_bar=False)
        selection = self.selection_engine.select(
            baseline=baseline_evaluation,
            candidates=candidate_evaluations,
        )
        selected_strategy = strategies_by_id[selection.selected.strategy_id]

        for evaluation in candidate_evaluations:
            status = "selected" if evaluation.strategy_id == selection.selected.strategy_id else "rejected"
            self.repository.update_strategy_status(evaluation.strategy_id, status)
        if selection.selected.strategy_id == baseline.strategy_id:
            self.repository.update_strategy_status(baseline.strategy_id, "selected")

        self.repository.append_run(
            EvolutionRunRecord(
                symbol=request.symbol.upper(),
                interval=request.interval,
                baseline_strategy_id=baseline.strategy_id,
                best_strategy_id=selection.selected.strategy_id,
                trials=request.trials,
                performance_delta=selection.performance_delta,
                confidence_score=selection.confidence_score,
                overfit_score=selection.selected.overfit_score,
            )
        )

        improvements = (
            self.mutation_engine.improvements(baseline, selected_strategy)
            if selected_strategy.strategy_id != baseline.strategy_id
            else ["baseline_retained_no_robust_improvement"]
        )
        return EvolutionResult(
            best_strategy_id=selection.selected.strategy_id,
            improvements_applied=improvements,
            performance_delta=selection.performance_delta,
            risk_adjustment=self.mutation_engine.risk_adjustment(baseline, selected_strategy),
            confidence_score=selection.confidence_score,
        )

    def _evaluate_candidate(
        self,
        *,
        strategy: EvolvableStrategy,
        train: pd.DataFrame,
        validation: pd.DataFrame,
        request: EvolutionRequest,
    ) -> CandidateEvaluation:
        train_record = self.evaluator.evaluate_backtest(
            ohlcv=train,
            strategy=strategy,
            source="backtest_train",
            symbol=request.symbol,
            interval=request.interval,
        )
        validation_record = self.evaluator.evaluate_backtest(
            ohlcv=validation,
            strategy=strategy,
            source="backtest_validation",
            symbol=request.symbol,
            interval=request.interval,
        )
        self.repository.append_performance(train_record)
        self.repository.append_performance(validation_record)
        return self.selection_engine.evaluate_candidate(
            strategy_id=strategy.strategy_id,
            train=train_record,
            validation=validation_record,
            min_validation_trades=request.min_validation_trades,
        )

    def _split_ohlcv(self, ohlcv: pd.DataFrame, *, train_ratio: float) -> tuple[pd.DataFrame, pd.DataFrame]:
        if len(ohlcv) < 120:
            raise ValueError("at least 120 real OHLCV rows are required for strategy evolution")
        split_index = int(len(ohlcv) * train_ratio)
        train = ohlcv.iloc[:split_index].copy()
        validation = ohlcv.iloc[split_index:].copy()
        if len(train) < 60 or len(validation) < 60:
            raise ValueError("train and validation windows must each contain at least 60 real OHLCV rows")
        return train, validation

    def _normalize_baseline(self, strategy: EvolvableStrategy, *, max_slow_window: int) -> EvolvableStrategy:
        if strategy.slow_window <= max_slow_window:
            return strategy
        slow_window = max_slow_window
        fast_window = min(strategy.fast_window, max(2, slow_window - 3))
        momentum_window = min(strategy.momentum_window, slow_window)
        return strategy.model_copy(
            update={
                "fast_window": fast_window,
                "slow_window": slow_window,
                "momentum_window": momentum_window,
            }
        )
