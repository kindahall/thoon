from __future__ import annotations

from typing import Any

from evolution.strategy_store import EntryCondition, EvolvableStrategy, ExitCondition


class StrategyMutationEngine:
    ENTRY_CONDITIONS: tuple[EntryCondition, ...] = (
        "ma_cross",
        "ma_cross_positive_momentum",
        "ma_cross_price_above_slow",
        "trend_following_pullback",
    )
    EXIT_CONDITIONS: tuple[ExitCondition, ...] = (
        "ma_cross",
        "price_below_fast",
        "negative_momentum",
        "ma_cross_or_negative_momentum",
    )

    def suggest(self, trial: Any, *, baseline: EvolvableStrategy, max_slow_window: int) -> EvolvableStrategy:
        safe_max_slow = max(8, min(max_slow_window, 500))
        fast_window = trial.suggest_int("fast_window", 2, max(3, safe_max_slow - 5))
        slow_window = trial.suggest_int("slow_window", fast_window + 3, safe_max_slow)
        momentum_window = trial.suggest_int("momentum_window", 2, min(120, max(3, slow_window)))
        entry_condition = trial.suggest_categorical("entry_condition", list(self.ENTRY_CONDITIONS))
        exit_condition = trial.suggest_categorical("exit_condition", list(self.EXIT_CONDITIONS))
        stop_loss_pct = trial.suggest_float("stop_loss_pct", 0.0, 0.25, step=0.01)
        take_profit_pct = trial.suggest_float("take_profit_pct", 0.0, 0.6, step=0.02)

        return EvolvableStrategy(
            fast_window=fast_window,
            slow_window=slow_window,
            momentum_window=momentum_window,
            entry_condition=entry_condition,
            exit_condition=exit_condition,
            stop_loss_pct=stop_loss_pct,
            take_profit_pct=take_profit_pct,
            initial_cash=baseline.initial_cash,
            fees=baseline.fees,
        )

    def improvements(self, baseline: EvolvableStrategy, candidate: EvolvableStrategy) -> list[str]:
        changes: list[str] = []
        for field in (
            "fast_window",
            "slow_window",
            "momentum_window",
            "entry_condition",
            "exit_condition",
            "stop_loss_pct",
            "take_profit_pct",
            "fees",
        ):
            before = getattr(baseline, field)
            after = getattr(candidate, field)
            if before != after:
                changes.append(f"{field}: {before} -> {after}")
        return changes or ["no_parameter_change"]

    def risk_adjustment(self, baseline: EvolvableStrategy, candidate: EvolvableStrategy) -> str:
        adjustments: list[str] = []
        if candidate.stop_loss_pct != baseline.stop_loss_pct:
            adjustments.append(f"stop_loss_pct {baseline.stop_loss_pct} -> {candidate.stop_loss_pct}")
        if candidate.take_profit_pct != baseline.take_profit_pct:
            adjustments.append(f"take_profit_pct {baseline.take_profit_pct} -> {candidate.take_profit_pct}")
        if candidate.slow_window > baseline.slow_window:
            adjustments.append("slower_signal_filter")
        elif candidate.slow_window < baseline.slow_window:
            adjustments.append("faster_signal_filter")
        return "; ".join(adjustments) if adjustments else "unchanged"
