from __future__ import annotations

from research_platform.schemas import StrategyEvaluationRecord


class SelectionEngine:
    def select(
        self,
        *,
        evaluations: list[StrategyEvaluationRecord],
        top_n: int,
    ) -> tuple[list[StrategyEvaluationRecord], list[StrategyEvaluationRecord]]:
        robust = [item for item in evaluations if not item.rejection_reasons]
        robust.sort(key=lambda item: item.ranking_score, reverse=True)
        selected_ids = {item.evaluation_id for item in robust[:top_n]}

        best: list[StrategyEvaluationRecord] = []
        rejected: list[StrategyEvaluationRecord] = []
        for item in evaluations:
            if item.evaluation_id in selected_ids:
                best.append(item.model_copy(update={"selection_status": "selected"}))
                continue
            reasons = list(item.rejection_reasons)
            if not reasons:
                reasons.append("outside_top_n")
            rejected.append(item.model_copy(update={"selection_status": "rejected", "rejection_reasons": reasons}))

        best.sort(key=lambda item: item.ranking_score, reverse=True)
        rejected.sort(key=lambda item: item.ranking_score, reverse=True)
        return best, rejected
