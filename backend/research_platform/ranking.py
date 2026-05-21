from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from research_platform.schemas import EvaluationSplitMetrics, QuantResearchRequest, StrategyPerformanceMetrics


@dataclass(frozen=True)
class RankingDecision:
    ranking_score: float
    overfit_score: float
    rejection_reasons: list[str]


class RankingSystem:
    def score(
        self,
        *,
        request: QuantResearchRequest,
        train: EvaluationSplitMetrics,
        validation: EvaluationSplitMetrics,
        test: EvaluationSplitMetrics,
    ) -> RankingDecision:
        overfit_score = self._overfit_score(train.metrics, validation.metrics, test.metrics)
        rejection_reasons: list[str] = []

        if validation.metrics.total_trades < request.min_trades:
            rejection_reasons.append("insufficient_validation_trades")
        if test.metrics.total_trades < request.min_trades:
            rejection_reasons.append("insufficient_test_trades")
        if validation.metrics.total_return <= 0:
            rejection_reasons.append("non_positive_validation_return")
        if test.metrics.total_return <= 0:
            rejection_reasons.append("non_positive_test_return")
        if abs(validation.metrics.max_drawdown) > request.max_drawdown:
            rejection_reasons.append("validation_drawdown_exceeded")
        if abs(test.metrics.max_drawdown) > request.max_drawdown:
            rejection_reasons.append("test_drawdown_exceeded")
        if validation.metrics.stability_over_time < request.min_stability_score:
            rejection_reasons.append("validation_stability_below_threshold")
        if test.metrics.stability_over_time < request.min_stability_score:
            rejection_reasons.append("test_stability_below_threshold")
        if overfit_score > request.max_overfit_score:
            rejection_reasons.append("overfit_score_above_threshold")
        if validation.metrics.total_return > 0 and test.metrics.total_return < 0:
            rejection_reasons.append("validation_test_return_sign_flip")

        score = (
            0.22 * self._quality(validation.metrics)
            + 0.42 * self._quality(test.metrics)
            + 0.16 * min(validation.metrics.stability_over_time, test.metrics.stability_over_time)
            + 0.10 * self._profit_factor_score(test.metrics.profit_factor)
            + 0.10 * (1.0 - overfit_score)
        )
        score -= 0.07 * len(rejection_reasons)
        return RankingDecision(
            ranking_score=round(float(np.clip(score, -1.0, 1.0)), 8),
            overfit_score=round(overfit_score, 8),
            rejection_reasons=rejection_reasons,
        )

    def _overfit_score(
        self,
        train: StrategyPerformanceMetrics,
        validation: StrategyPerformanceMetrics,
        test: StrategyPerformanceMetrics,
    ) -> float:
        train_quality = self._quality(train)
        validation_quality = self._quality(validation)
        test_quality = self._quality(test)
        train_validation_gap = max(0.0, train_quality - validation_quality)
        validation_test_gap = max(0.0, validation_quality - test_quality)
        trade_penalty = 0.1 if validation.total_trades == 0 or test.total_trades == 0 else 0.0
        return float(np.clip(0.55 * train_validation_gap + 0.35 * validation_test_gap + trade_penalty, 0.0, 1.0))

    def _quality(self, metrics: StrategyPerformanceMetrics) -> float:
        return_component = float(np.clip((metrics.total_return + 0.2) / 0.7, 0.0, 1.0))
        sharpe_component = self._signed_ratio_score(metrics.sharpe_ratio)
        sortino_component = self._signed_ratio_score(metrics.sortino_ratio)
        drawdown_component = float(1.0 - np.clip(abs(metrics.max_drawdown) / 0.5, 0.0, 1.0))
        win_component = 0.0 if metrics.win_rate is None else float(np.clip(metrics.win_rate, 0.0, 1.0))
        trade_component = float(np.clip(metrics.total_trades / 12.0, 0.0, 1.0))
        return float(
            0.26 * return_component
            + 0.18 * sharpe_component
            + 0.14 * sortino_component
            + 0.18 * drawdown_component
            + 0.12 * metrics.stability_over_time
            + 0.07 * win_component
            + 0.05 * trade_component
        )

    def _signed_ratio_score(self, value: float | None) -> float:
        if value is None:
            return 0.0
        return float(np.clip((value + 1.0) / 4.0, 0.0, 1.0))

    def _profit_factor_score(self, value: float | None) -> float:
        if value is None:
            return 0.0
        return float(np.clip(value / 3.0, 0.0, 1.0))
