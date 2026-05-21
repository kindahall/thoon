from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import UTC, datetime
from typing import Any

import numpy as np
import pandas as pd

from research_platform.schemas import RegimeName, StrategyRegistryInput, StrategyRegistryRecord
from research_platform.storage import PostgresResearchStore


class StrategyRegistryError(ValueError):
    pass


class StrategyRegistry:
    def __init__(self, store: PostgresResearchStore) -> None:
        self.store = store

    def register(self, strategy: StrategyRegistryInput) -> StrategyRegistryRecord:
        normalized = self._normalize(strategy)
        strategy_id = self._strategy_id(normalized)
        content_hash = self._content_hash(normalized)
        version = self.store.next_strategy_version(strategy_id)
        version_id = f"{strategy_id}_v{content_hash[:12]}"
        record = StrategyRegistryRecord(
            **normalized.model_dump(mode="python"),
            strategy_id=strategy_id,
            version_id=version_id,
            content_hash=content_hash,
            version=version,
            created_at=datetime.now(UTC),
        )
        return self.store.upsert_strategy(record)

    def generated_candidates(
        self,
        *,
        ohlcv: pd.DataFrame,
        max_candidates: int,
        exploration_rate: float,
        force_new_generation: bool,
        train_ratio: float,
        validation_ratio: float,
    ) -> list[StrategyRegistryRecord]:
        top_memory = self.store.top_evaluations(limit=max(3, max_candidates))
        stagnated = force_new_generation or not top_memory or self._memory_stagnated(top_memory)
        max_signal_window = self._max_slow_window(ohlcv, train_ratio=train_ratio, validation_ratio=validation_ratio)
        deterministic = self._deterministic_candidates(ohlcv=ohlcv, max_candidates=max_candidates, max_signal_window=max_signal_window)
        mutations = self._memory_mutations(top_memory=top_memory, max_signal_window=max_signal_window)

        exploration_count = max(1, math.ceil(max_candidates * exploration_rate)) if stagnated else max(1, math.floor(max_candidates * 0.2))
        ordered = [*deterministic[:exploration_count], *mutations, *deterministic[exploration_count:]]
        deduped: dict[str, StrategyRegistryInput] = {}
        for candidate in ordered:
            if self._max_candidate_window(candidate) <= max_signal_window:
                deduped.setdefault(self._candidate_key(candidate), candidate)
            if len(deduped) >= max_candidates:
                break

        return [self.register(candidate) for candidate in deduped.values()]

    def _normalize(self, strategy: StrategyRegistryInput) -> StrategyRegistryInput:
        params = dict(strategy.params)
        conditions = dict(strategy.conditions)
        normalized_params, default_conditions = self._normalize_params(strategy.strategy_type, params)
        for key, value in default_conditions.items():
            conditions.setdefault(key, value)
        metadata = dict(strategy.metadata)
        metadata.setdefault("data_policy", "real_ohlcv_only")
        metadata.setdefault("performance_policy", "backtest_or_real_paper_only")
        metadata.setdefault("research_family", strategy.strategy_type)
        return strategy.model_copy(
            update={
                "name": self._safe_name(strategy.name),
                "params": normalized_params,
                "conditions": conditions,
                "metadata": metadata,
            }
        )

    def _normalize_params(self, strategy_type: str, params: dict[str, Any]) -> tuple[dict[str, int | float | str | bool], dict[str, str]]:
        if strategy_type == "sma_cross":
            fast, slow = self._fast_slow(params, default_fast=20, default_slow=50)
            return {"fast_window": fast, "slow_window": slow}, {
                "entry": "fast_sma_crosses_above_slow_sma",
                "exit": "fast_sma_crosses_below_slow_sma",
            }
        if strategy_type == "ema_trend":
            fast, slow = self._fast_slow(params, default_fast=12, default_slow=48)
            return {"fast_window": fast, "slow_window": slow}, {
                "entry": "fast_ema_crosses_above_slow_ema_with_price_confirmation",
                "exit": "fast_ema_crosses_below_slow_ema_or_price_loses_slow_ema",
            }
        if strategy_type == "donchian_breakout":
            window = self._int_param(params, "donchian_window", 55, 3, 500)
            exit_window = self._int_param(params, "donchian_exit_window", 20, 2, 500)
            return {"donchian_window": window, "donchian_exit_window": exit_window}, {
                "entry": "close_breaks_above_prior_donchian_high",
                "exit": "close_breaks_below_prior_donchian_exit_low",
            }
        if strategy_type == "rsi_mean_reversion":
            window = self._int_param(params, "rsi_window", 14, 2, 200)
            lower = self._float_param(params, "rsi_lower", 30.0, 1.0, 60.0)
            upper = self._float_param(params, "rsi_upper", 55.0, 40.0, 99.0)
            if lower >= upper:
                raise StrategyRegistryError("rsi_lower must be lower than rsi_upper")
            return {"rsi_window": window, "rsi_lower": lower, "rsi_upper": upper}, {
                "entry": "rsi_below_lower_threshold",
                "exit": "rsi_recovers_above_upper_threshold",
            }
        if strategy_type == "bollinger_reversion":
            window = self._int_param(params, "bollinger_window", 20, 3, 500)
            width = self._float_param(params, "bollinger_std", 2.0, 0.5, 5.0)
            return {"bollinger_window": window, "bollinger_std": width}, {
                "entry": "close_below_lower_bollinger_band",
                "exit": "close_recovers_to_bollinger_midline",
            }
        if strategy_type == "momentum_volatility":
            momentum_window = self._int_param(params, "momentum_window", 24, 2, 500)
            volatility_window = self._int_param(params, "volatility_window", 48, 3, 500)
            min_momentum = self._float_param(params, "min_momentum", 0.01, -1.0, 1.0)
            max_volatility = self._float_param(params, "max_volatility", 0.025, 0.0001, 1.0)
            return {
                "momentum_window": momentum_window,
                "volatility_window": volatility_window,
                "min_momentum": min_momentum,
                "max_volatility": max_volatility,
            }, {
                "entry": "positive_momentum_with_volatility_cap",
                "exit": "momentum_turns_negative_or_volatility_expands",
            }
        if strategy_type == "volume_breakout":
            fast, slow = self._fast_slow(params, default_fast=20, default_slow=80)
            volume_window = self._int_param(params, "volume_window", 20, 2, 500)
            volume_multiplier = self._float_param(params, "volume_multiplier", 1.35, 0.1, 10.0)
            return {
                "fast_window": fast,
                "slow_window": slow,
                "volume_window": volume_window,
                "volume_multiplier": volume_multiplier,
            }, {
                "entry": "price_breakout_with_volume_confirmation",
                "exit": "close_loses_slow_moving_average",
            }
        raise StrategyRegistryError(f"unsupported strategy_type: {strategy_type}")

    def _deterministic_candidates(
        self,
        *,
        ohlcv: pd.DataFrame,
        max_candidates: int,
        max_signal_window: int,
    ) -> list[StrategyRegistryInput]:
        close = ohlcv["close"].astype(float)
        returns = close.pct_change().dropna()
        trend_return = float((close.iloc[-1] / close.iloc[0]) - 1.0)
        realized_volatility = float(returns.std(ddof=1) * math.sqrt(min(365 * 24, max(1, len(returns)))))
        regime_tags = self._regime_tags(trend_return=trend_return, realized_volatility=realized_volatility)
        candidates: list[StrategyRegistryInput] = []

        templates = [
            ("sma_cross", "sma_cross", {"fast_window": 6, "slow_window": 18}),
            ("ema_trend", "ema_trend", {"fast_window": 5, "slow_window": 20}),
            ("donchian_breakout", "donchian_breakout", {"donchian_window": 20, "donchian_exit_window": 10}),
            ("rsi_mean_reversion", "rsi_mean_reversion", {"rsi_window": 10, "rsi_lower": 28.0, "rsi_upper": 55.0}),
            ("bollinger_reversion", "bollinger_reversion", {"bollinger_window": 20, "bollinger_std": 2.0}),
            ("momentum_volatility", "momentum_volatility", {"momentum_window": 6, "volatility_window": 24, "min_momentum": 0.006, "max_volatility": 0.03}),
            ("volume_breakout", "volume_breakout", {"fast_window": 8, "slow_window": 24, "volume_window": 12, "volume_multiplier": 1.15}),
            ("momentum_volatility", "momentum_volatility", {"momentum_window": 12, "volatility_window": 36, "min_momentum": 0.008, "max_volatility": 0.025}),
            ("volume_breakout", "volume_breakout", {"fast_window": 12, "slow_window": 48, "volume_window": 20, "volume_multiplier": 1.25}),
            ("sma_cross", "sma_cross", {"fast_window": 8, "slow_window": 21}),
            ("ema_trend", "ema_trend", {"fast_window": 8, "slow_window": 34}),
            ("donchian_breakout", "donchian_breakout", {"donchian_window": 40, "donchian_exit_window": 20}),
            ("rsi_mean_reversion", "rsi_mean_reversion", {"rsi_window": 14, "rsi_lower": 30.0, "rsi_upper": 60.0}),
            ("bollinger_reversion", "bollinger_reversion", {"bollinger_window": 30, "bollinger_std": 2.2}),
            ("momentum_volatility", "momentum_volatility", {"momentum_window": 24, "volatility_window": 48, "min_momentum": 0.012, "max_volatility": 0.03}),
            ("volume_breakout", "volume_breakout", {"fast_window": 20, "slow_window": 80, "volume_window": 30, "volume_multiplier": 1.5}),
            ("sma_cross", "sma_cross", {"fast_window": 12, "slow_window": 36}),
            ("ema_trend", "ema_trend", {"fast_window": 12, "slow_window": 48}),
        ]

        for name, strategy_type, params in templates:
            candidate = StrategyRegistryInput(
                name=name,
                strategy_type=strategy_type,  # type: ignore[arg-type]
                params=params,
                regime_tags=regime_tags,
                metadata={
                    "generator": "multi_factor_real_market_generator",
                    "trend_return": round(trend_return, 8),
                    "realized_volatility": round(realized_volatility, 8),
                    "candidate_rank": len(candidates) + 1,
                },
            )
            if self._max_candidate_window(candidate) <= max_signal_window:
                candidates.append(candidate)
            if len(candidates) >= max_candidates:
                break
        return candidates

    def _memory_mutations(self, *, top_memory: list[Any], max_signal_window: int) -> list[StrategyRegistryInput]:
        mutations: list[StrategyRegistryInput] = []
        for evaluation in top_memory[:5]:
            strategy = self._strategy_for_version(evaluation.version_id)
            if strategy is None:
                continue
            for params in self._mutated_param_sets(strategy):
                candidate = StrategyRegistryInput(
                    name=strategy.name,
                    strategy_type=strategy.strategy_type,
                    params=params,
                    conditions=strategy.conditions,
                    regime_tags=strategy.regime_tags,
                    metadata={
                        **strategy.metadata,
                        "generator": "memory_mutation",
                        "parent_version_id": strategy.version_id,
                    },
                    parent_strategy_id=strategy.strategy_id,
                )
                if self._max_candidate_window(candidate) <= max_signal_window:
                    mutations.append(candidate)
        return mutations

    def _mutated_param_sets(self, strategy: StrategyRegistryRecord) -> list[dict[str, int | float | str | bool]]:
        params = dict(strategy.params)
        if strategy.strategy_type in {"sma_cross", "ema_trend", "volume_breakout"}:
            fast = int(params["fast_window"])
            slow = int(params["slow_window"])
            output = []
            for fast_multiplier, slow_multiplier in [(0.8, 0.9), (1.15, 1.1), (1.0, 1.25)]:
                mutated_fast = max(2, int(round(fast * fast_multiplier)))
                mutated_slow = max(mutated_fast + 1, int(round(slow * slow_multiplier)))
                item = {**params, "fast_window": mutated_fast, "slow_window": mutated_slow}
                output.append(item)
            return output
        if strategy.strategy_type == "donchian_breakout":
            window = int(params["donchian_window"])
            exit_window = int(params["donchian_exit_window"])
            return [
                {"donchian_window": max(3, int(round(window * 0.8))), "donchian_exit_window": max(2, int(round(exit_window * 0.8)))},
                {"donchian_window": max(3, int(round(window * 1.2))), "donchian_exit_window": max(2, int(round(exit_window * 1.1)))},
            ]
        if strategy.strategy_type == "rsi_mean_reversion":
            window = int(params["rsi_window"])
            lower = float(params["rsi_lower"])
            upper = float(params["rsi_upper"])
            return [
                {"rsi_window": max(2, int(round(window * 0.85))), "rsi_lower": max(10.0, lower - 3.0), "rsi_upper": min(90.0, upper + 2.0)},
                {"rsi_window": max(2, int(round(window * 1.2))), "rsi_lower": min(55.0, lower + 2.0), "rsi_upper": min(90.0, upper + 5.0)},
            ]
        if strategy.strategy_type == "bollinger_reversion":
            window = int(params["bollinger_window"])
            width = float(params["bollinger_std"])
            return [
                {"bollinger_window": max(3, int(round(window * 0.85))), "bollinger_std": max(0.8, round(width - 0.2, 3))},
                {"bollinger_window": max(3, int(round(window * 1.2))), "bollinger_std": min(4.0, round(width + 0.25, 3))},
            ]
        if strategy.strategy_type == "momentum_volatility":
            momentum_window = int(params["momentum_window"])
            volatility_window = int(params["volatility_window"])
            min_momentum = float(params["min_momentum"])
            max_volatility = float(params["max_volatility"])
            return [
                {
                    "momentum_window": max(2, int(round(momentum_window * 0.75))),
                    "volatility_window": max(3, int(round(volatility_window * 0.85))),
                    "min_momentum": round(min_momentum * 0.8, 6),
                    "max_volatility": round(max_volatility * 1.1, 6),
                },
                {
                    "momentum_window": max(2, int(round(momentum_window * 1.25))),
                    "volatility_window": max(3, int(round(volatility_window * 1.15))),
                    "min_momentum": round(min_momentum * 1.2, 6),
                    "max_volatility": round(max_volatility * 0.9, 6),
                },
            ]
        return []

    def _fast_slow(self, params: dict[str, Any], *, default_fast: int, default_slow: int) -> tuple[int, int]:
        fast_window = self._int_param(params, "fast_window", default_fast, 2, 500)
        slow_window = self._int_param(params, "slow_window", default_slow, 3, 1000)
        if fast_window >= slow_window:
            raise StrategyRegistryError("fast_window must be lower than slow_window")
        return fast_window, slow_window

    def _int_param(self, params: dict[str, Any], key: str, default: int, minimum: int, maximum: int) -> int:
        value = int(params.get(key, default))
        if value < minimum or value > maximum:
            raise StrategyRegistryError(f"{key} must be between {minimum} and {maximum}")
        return value

    def _float_param(self, params: dict[str, Any], key: str, default: float, minimum: float, maximum: float) -> float:
        value = float(params.get(key, default))
        if not math.isfinite(value) or value < minimum or value > maximum:
            raise StrategyRegistryError(f"{key} must be between {minimum} and {maximum}")
        return round(value, 8)

    def _candidate_key(self, candidate: StrategyRegistryInput) -> str:
        payload = {
            "strategy_type": candidate.strategy_type,
            "params": candidate.params,
            "conditions": candidate.conditions,
        }
        return json.dumps(payload, sort_keys=True, separators=(",", ":"))

    def _max_candidate_window(self, candidate: StrategyRegistryInput) -> int:
        params = candidate.params
        if candidate.strategy_type in {"sma_cross", "ema_trend"}:
            return max(int(params.get("fast_window", 0)), int(params.get("slow_window", 0)))
        if candidate.strategy_type == "donchian_breakout":
            return max(int(params.get("donchian_window", 0)), int(params.get("donchian_exit_window", 0)))
        if candidate.strategy_type == "rsi_mean_reversion":
            return int(params.get("rsi_window", 0))
        if candidate.strategy_type == "bollinger_reversion":
            return int(params.get("bollinger_window", 0))
        if candidate.strategy_type == "momentum_volatility":
            return max(int(params.get("momentum_window", 0)), int(params.get("volatility_window", 0)))
        if candidate.strategy_type == "volume_breakout":
            return max(
                int(params.get("fast_window", 0)),
                int(params.get("slow_window", 0)),
                int(params.get("volume_window", 0)),
            )
        return 10_000

    def _regime_tags(self, *, trend_return: float, realized_volatility: float) -> list[RegimeName]:
        tags: list[RegimeName] = ["bear_market" if trend_return < 0 else "bull_market"]
        if realized_volatility > 0.5:
            tags.append("high_volatility")
        if abs(trend_return) < 0.015:
            tags.append("low_liquidity")
        return tags

    def _strategy_for_version(self, version_id: str) -> StrategyRegistryRecord | None:
        strategies = self.store.list_strategies(limit=500)
        return next((strategy for strategy in strategies if strategy.version_id == version_id), None)

    def _memory_stagnated(self, top_memory: list[Any]) -> bool:
        scores = [float(item.ranking_score) for item in top_memory[:5]]
        if len(scores) < 3:
            return True
        return max(scores) - min(scores) < 0.02

    def _max_slow_window(self, ohlcv: pd.DataFrame, *, train_ratio: float, validation_ratio: float) -> int:
        test_ratio = max(0.05, 1.0 - train_ratio - validation_ratio)
        smallest_split = int(len(ohlcv) * min(train_ratio, validation_ratio, test_ratio))
        return max(8, min(240, smallest_split - 4))

    def _strategy_id(self, strategy: StrategyRegistryInput) -> str:
        safe_name = self._safe_name(strategy.name)
        return f"strategy_{safe_name}_{strategy.strategy_type}"

    def _content_hash(self, strategy: StrategyRegistryInput) -> str:
        payload = strategy.model_dump(mode="json")
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded).hexdigest()

    def _safe_name(self, name: str) -> str:
        safe = re.sub(r"[^a-zA-Z0-9_]+", "_", name.strip().lower()).strip("_")
        return safe or "strategy"
