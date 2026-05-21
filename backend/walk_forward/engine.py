from __future__ import annotations

import math

import numpy as np
import pandas as pd

from backtest.engine import BacktestEngine, StrategyConfig
from backtest.metrics import MetricsCalculator, PerformanceMetrics
from rl.data_loader import MarketDataError, RLMarketDataLoader, normalize_market_error
from walk_forward.schemas import WalkForwardFoldResult, WalkForwardRequest, WalkForwardValidationResult


class WalkForwardValidationError(RuntimeError):
    pass


class WalkForwardValidationEngine:
    def __init__(
        self,
        *,
        data_loader: RLMarketDataLoader | None = None,
        backtest_engine: BacktestEngine | None = None,
        metrics: MetricsCalculator | None = None,
    ) -> None:
        self.data_loader = data_loader or RLMarketDataLoader()
        self.backtest_engine = backtest_engine or BacktestEngine()
        self.metrics = metrics or MetricsCalculator()

    async def validate(self, request: WalkForwardRequest) -> WalkForwardValidationResult:
        try:
            ohlcv = await self.data_loader.download_ohlcv(
                exchange=request.exchange,
                symbol=request.symbol,
                interval=request.interval,
                limit=request.limit,
            )
        except Exception as error:
            raise normalize_market_error(error) from error
        return self.validate_frame(request=request, ohlcv=ohlcv)

    def validate_frame(self, *, request: WalkForwardRequest, ohlcv: pd.DataFrame) -> WalkForwardValidationResult:
        frame = self._validate_input_frame(ohlcv, request.strategy)
        folds = self._build_folds(frame=frame, request=request)
        fold_results: list[WalkForwardFoldResult] = []

        for fold_index, train_frame, test_frame in folds:
            train_portfolio, train_signals = self.backtest_engine.run(train_frame, request.strategy)
            test_portfolio, test_signals = self.backtest_engine.run(test_frame, request.strategy)
            train_metrics = self.metrics.calculate(train_portfolio)
            test_metrics = self.metrics.calculate(test_portfolio)

            train_quality = self._quality_score(train_metrics)
            test_quality = self._quality_score(test_metrics)
            generalization_gap = self._clip01(train_quality - test_quality)
            stability_score = self._fold_stability_score(test_metrics, generalization_gap)
            rejection_reasons = self._fold_rejection_reasons(
                request=request,
                test_metrics=test_metrics,
                test_quality=test_quality,
                generalization_gap=generalization_gap,
            )

            fold_results.append(
                WalkForwardFoldResult(
                    fold_index=fold_index,
                    train_start=train_frame.index[0].to_pydatetime(),
                    train_end=train_frame.index[-1].to_pydatetime(),
                    test_start=test_frame.index[0].to_pydatetime(),
                    test_end=test_frame.index[-1].to_pydatetime(),
                    train_rows=len(train_frame),
                    test_rows=len(test_frame),
                    train_metrics=train_metrics,
                    test_metrics=test_metrics,
                    train_signals=train_signals,
                    test_signals=test_signals,
                    train_quality_score=round(train_quality, 8),
                    test_quality_score=round(test_quality, 8),
                    generalization_gap=round(generalization_gap, 8),
                    stability_score=round(stability_score, 8),
                    accepted=not rejection_reasons,
                    rejection_reasons=rejection_reasons,
                )
            )

        if not fold_results:
            raise WalkForwardValidationError("no valid walk-forward folds could be built from real OHLCV data")

        in_sample_score = float(np.mean([fold.train_quality_score for fold in fold_results]))
        out_of_sample_score = float(np.mean([fold.test_quality_score for fold in fold_results]))
        gaps = [fold.generalization_gap for fold in fold_results]
        overfit_risk = self._overfit_risk(fold_results, gaps)
        positive_test_ratio = self._positive_test_ratio(fold_results)
        stability_score = self._global_stability_score(fold_results)
        walk_forward_score = self._clip01(
            (0.45 * out_of_sample_score)
            + (0.25 * positive_test_ratio)
            + (0.20 * stability_score)
            + (0.10 * (1.0 - overfit_risk))
        )
        rejection_reasons = self._global_rejection_reasons(
            request=request,
            walk_forward_score=walk_forward_score,
            overfit_risk=overfit_risk,
            positive_test_ratio=positive_test_ratio,
            fold_results=fold_results,
        )

        return WalkForwardValidationResult(
            exchange=request.exchange,
            symbol=request.symbol,
            interval=request.interval,
            rows=len(frame),
            strategy=request.strategy,
            splits=len(fold_results),
            train_ratio=request.train_ratio,
            fold_results=fold_results,
            walk_forward_score=round(walk_forward_score, 8),
            overfit_risk=round(overfit_risk, 8),
            positive_test_ratio=round(positive_test_ratio, 8),
            stability_score=round(stability_score, 8),
            in_sample_score=round(in_sample_score, 8),
            out_of_sample_score=round(out_of_sample_score, 8),
            accepted=not rejection_reasons,
            rejection_reasons=rejection_reasons,
        )

    def _validate_input_frame(self, ohlcv: pd.DataFrame, strategy: StrategyConfig) -> pd.DataFrame:
        required_columns = {"open", "high", "low", "close", "volume"}
        missing_columns = required_columns.difference(ohlcv.columns)
        if missing_columns:
            raise WalkForwardValidationError(f"OHLCV frame missing columns: {', '.join(sorted(missing_columns))}")
        if ohlcv.empty:
            raise WalkForwardValidationError("OHLCV frame is empty")
        frame = ohlcv.sort_index()
        if not frame.index.is_monotonic_increasing:
            raise WalkForwardValidationError("OHLCV timestamps must be monotonic")
        if frame.index.has_duplicates:
            raise WalkForwardValidationError("OHLCV timestamps contain duplicates")
        min_required_rows = max(self.backtest_engine.required_lookback(strategy) + 3, 60)
        if len(frame) < min_required_rows:
            raise WalkForwardValidationError("not enough real OHLCV rows for walk-forward validation")
        return frame

    def _build_folds(
        self,
        *,
        frame: pd.DataFrame,
        request: WalkForwardRequest,
    ) -> list[tuple[int, pd.DataFrame, pd.DataFrame]]:
        required_lookback = self.backtest_engine.required_lookback(request.strategy)
        min_train_rows = max(request.min_train_rows, required_lookback + 3)
        min_test_rows = max(request.min_test_rows, required_lookback + 3)
        available_rows = len(frame)
        if available_rows < min_train_rows + min_test_rows:
            raise WalkForwardValidationError("not enough real OHLCV rows for one train/test split")

        max_test_rows = max(1, (available_rows - min_train_rows) // request.splits)
        test_rows = max(min_test_rows, max_test_rows)
        train_rows = max(min_train_rows, int(math.ceil(test_rows * request.train_ratio / (1.0 - request.train_ratio))))

        while train_rows + (request.splits * test_rows) > available_rows and test_rows > min_test_rows:
            test_rows -= 1
            train_rows = max(
                min_train_rows,
                int(math.ceil(test_rows * request.train_ratio / (1.0 - request.train_ratio))),
            )
        if train_rows + test_rows > available_rows:
            train_rows = max(min_train_rows, available_rows - (request.splits * min_test_rows))
            test_rows = min_test_rows
        if train_rows < min_train_rows or train_rows + test_rows > available_rows:
            raise WalkForwardValidationError("not enough real OHLCV rows for configured rolling windows")

        folds: list[tuple[int, pd.DataFrame, pd.DataFrame]] = []
        for zero_based_index in range(request.splits):
            train_start = zero_based_index * test_rows
            train_end = train_start + train_rows
            test_start = train_end
            test_end = test_start + test_rows
            if test_end > available_rows:
                break
            train_frame = frame.iloc[train_start:train_end]
            test_frame = frame.iloc[test_start:test_end]
            if len(train_frame) >= min_train_rows and len(test_frame) >= min_test_rows:
                folds.append((zero_based_index + 1, train_frame, test_frame))

        if len(folds) < 2:
            raise WalkForwardValidationError("walk-forward validation requires at least two valid folds")
        return folds

    def _quality_score(self, metrics: PerformanceMetrics) -> float:
        return_component = self._clip01((metrics.total_return + 0.05) / 0.20)
        drawdown_component = self._clip01(1.0 - (abs(metrics.max_drawdown) / 0.30))
        sharpe_component = self._clip01(((metrics.sharpe_ratio or 0.0) + 1.0) / 4.0)
        win_rate_component = self._clip01(metrics.win_rate if metrics.win_rate is not None else 0.0)
        trade_component = self._clip01(metrics.total_trades / 5.0)
        return self._clip01(
            (0.30 * return_component)
            + (0.25 * drawdown_component)
            + (0.20 * sharpe_component)
            + (0.15 * win_rate_component)
            + (0.10 * trade_component)
        )

    def _fold_stability_score(self, metrics: PerformanceMetrics, generalization_gap: float) -> float:
        drawdown_score = self._clip01(1.0 - (abs(metrics.max_drawdown) / 0.30))
        return_score = self._clip01((metrics.total_return + 0.03) / 0.12)
        trade_score = self._clip01(metrics.total_trades / 3.0)
        gap_score = self._clip01(1.0 - generalization_gap)
        return self._clip01((0.35 * drawdown_score) + (0.30 * return_score) + (0.20 * gap_score) + (0.15 * trade_score))

    def _fold_rejection_reasons(
        self,
        *,
        request: WalkForwardRequest,
        test_metrics: PerformanceMetrics,
        test_quality: float,
        generalization_gap: float,
    ) -> list[str]:
        reasons: list[str] = []
        if test_metrics.total_trades == 0:
            reasons.append("no_out_of_sample_trades")
        if test_metrics.total_return <= 0:
            reasons.append("negative_or_flat_out_of_sample_return")
        if generalization_gap > request.max_overfit_risk:
            reasons.append("excessive_in_sample_out_of_sample_gap")
        if test_quality < request.min_walk_forward_score * 0.5:
            reasons.append("weak_out_of_sample_quality")
        return reasons

    def _overfit_risk(self, fold_results: list[WalkForwardFoldResult], gaps: list[float]) -> float:
        mean_gap = float(np.mean(gaps)) if gaps else 1.0
        train_wins = sum(fold.train_quality_score > fold.test_quality_score for fold in fold_results) / len(fold_results)
        negative_tests = sum(fold.test_metrics.total_return <= 0 for fold in fold_results) / len(fold_results)
        instability = 1.0 - self._global_stability_score(fold_results)
        return self._clip01((0.45 * mean_gap) + (0.25 * train_wins) + (0.20 * negative_tests) + (0.10 * instability))

    def _positive_test_ratio(self, fold_results: list[WalkForwardFoldResult]) -> float:
        return sum(fold.test_metrics.total_return > 0 for fold in fold_results) / len(fold_results)

    def _global_stability_score(self, fold_results: list[WalkForwardFoldResult]) -> float:
        returns = np.array([fold.test_metrics.total_return for fold in fold_results], dtype=float)
        if len(returns) == 0:
            return 0.0
        volatility_penalty = self._clip01(float(np.std(returns)) / 0.10)
        fold_stability = float(np.mean([fold.stability_score for fold in fold_results]))
        return self._clip01((0.65 * fold_stability) + (0.35 * (1.0 - volatility_penalty)))

    def _global_rejection_reasons(
        self,
        *,
        request: WalkForwardRequest,
        walk_forward_score: float,
        overfit_risk: float,
        positive_test_ratio: float,
        fold_results: list[WalkForwardFoldResult],
    ) -> list[str]:
        reasons: list[str] = []
        if walk_forward_score < request.min_walk_forward_score:
            reasons.append("walk_forward_score_below_threshold")
        if overfit_risk > request.max_overfit_risk:
            reasons.append("overfit_risk_above_threshold")
        if positive_test_ratio < request.min_positive_test_ratio:
            reasons.append("positive_test_ratio_below_threshold")
        if not any(fold.accepted for fold in fold_results):
            reasons.append("all_folds_rejected")
        return reasons

    def _clip01(self, value: float) -> float:
        if not math.isfinite(value):
            return 0.0
        return max(0.0, min(1.0, float(value)))
