from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from evolution.strategy_store import PerformanceRecord


class CandidateEvaluation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    strategy_id: str
    train: PerformanceRecord
    validation: PerformanceRecord
    overfit_score: float
    robust: bool
    rejection_reasons: list[str] = Field(default_factory=list)


class SelectionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selected: CandidateEvaluation
    confidence_score: float
    performance_delta: dict[str, float]


class StrategySelectionEngine:
    def evaluate_candidate(
        self,
        *,
        strategy_id: str,
        train: PerformanceRecord,
        validation: PerformanceRecord,
        min_validation_trades: int,
    ) -> CandidateEvaluation:
        overfit_score = self.overfit_score(train=train, validation=validation)
        reasons: list[str] = []
        if validation.total_trades < min_validation_trades:
            reasons.append("insufficient_validation_trades")
        if overfit_score > 0.28:
            reasons.append("overfit_score_above_threshold")
        if validation.stability_score < 0.2:
            reasons.append("unstable_validation_equity_curve")
        if validation.max_drawdown < -0.45:
            reasons.append("validation_drawdown_too_deep")
        if validation.score <= 0.0:
            reasons.append("non_positive_validation_score")
        return CandidateEvaluation(
            strategy_id=strategy_id,
            train=train,
            validation=validation,
            overfit_score=round(overfit_score, 8),
            robust=not reasons,
            rejection_reasons=reasons,
        )

    def select(
        self,
        *,
        baseline: CandidateEvaluation,
        candidates: list[CandidateEvaluation],
    ) -> SelectionResult:
        robust_candidates = [candidate for candidate in candidates if candidate.robust]
        selected = max([baseline, *robust_candidates], key=lambda item: item.validation.score)
        confidence = self.confidence_score(selected)
        performance_delta = self.performance_delta(baseline.validation, selected.validation)
        return SelectionResult(selected=selected, confidence_score=confidence, performance_delta=performance_delta)

    def overfit_score(self, *, train: PerformanceRecord, validation: PerformanceRecord) -> float:
        score_gap = max(0.0, train.score - validation.score)
        sharpe_gap = self._metric_gap(train.sharpe_ratio, validation.sharpe_ratio, scale=4.0)
        return_gap = max(0.0, train.total_return - validation.total_return)
        stability_gap = max(0.0, train.stability_score - validation.stability_score)
        trade_penalty = 0.08 if validation.total_trades == 0 and train.total_trades > 0 else 0.0
        return float(min(1.0, 0.45 * score_gap + 0.25 * sharpe_gap + 0.15 * return_gap + 0.15 * stability_gap + trade_penalty))

    def confidence_score(self, candidate: CandidateEvaluation) -> float:
        trade_component = min(1.0, candidate.validation.total_trades / 15.0)
        overfit_component = max(0.0, 1.0 - candidate.overfit_score)
        confidence = (
            0.45 * candidate.validation.score
            + 0.25 * candidate.validation.stability_score
            + 0.2 * overfit_component
            + 0.1 * trade_component
        )
        return round(float(max(0.0, min(1.0, confidence))), 8)

    def performance_delta(self, baseline: PerformanceRecord, selected: PerformanceRecord) -> dict[str, float]:
        return {
            "score": round(selected.score - baseline.score, 8),
            "total_return": round(selected.total_return - baseline.total_return, 8),
            "sharpe_ratio": round((selected.sharpe_ratio or 0.0) - (baseline.sharpe_ratio or 0.0), 8),
            "max_drawdown": round(selected.max_drawdown - baseline.max_drawdown, 8),
            "win_rate": round((selected.win_rate or 0.0) - (baseline.win_rate or 0.0), 8),
            "profit_factor": round((selected.profit_factor or 0.0) - (baseline.profit_factor or 0.0), 8),
            "stability_score": round(selected.stability_score - baseline.stability_score, 8),
        }

    def _metric_gap(self, train_value: float | None, validation_value: float | None, *, scale: float) -> float:
        if train_value is None or validation_value is None:
            return 0.0
        return max(0.0, train_value - validation_value) / scale
