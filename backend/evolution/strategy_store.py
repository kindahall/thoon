from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

EntryCondition = Literal[
    "ma_cross",
    "ma_cross_positive_momentum",
    "ma_cross_price_above_slow",
    "trend_following_pullback",
]
ExitCondition = Literal[
    "ma_cross",
    "price_below_fast",
    "negative_momentum",
    "ma_cross_or_negative_momentum",
]
PerformanceSource = Literal[
    "backtest_train",
    "backtest_validation",
    "backtest_full",
    "paper_trading",
    "live_trading",
]


class EvolvableStrategy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Literal["adaptive_sma_cross"] = "adaptive_sma_cross"
    fast_window: int = Field(default=20, ge=2, le=250)
    slow_window: int = Field(default=50, ge=3, le=500)
    momentum_window: int = Field(default=12, ge=2, le=120)
    entry_condition: EntryCondition = "ma_cross"
    exit_condition: ExitCondition = "ma_cross"
    stop_loss_pct: float = Field(default=0.08, ge=0.0, le=0.5)
    take_profit_pct: float = Field(default=0.2, ge=0.0, le=1.0)
    initial_cash: float = Field(default=10_000.0, gt=0)
    fees: float = Field(default=0.001, ge=0.0, le=0.1)

    @field_validator("slow_window")
    @classmethod
    def validate_window_order(cls, value: int, info) -> int:
        fast_window = info.data.get("fast_window")
        if fast_window is not None and fast_window >= value:
            raise ValueError("fast_window must be lower than slow_window")
        return value

    @property
    def strategy_id(self) -> str:
        payload = self.model_dump(mode="json", exclude={"initial_cash"})
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return f"strat_{sha256(encoded).hexdigest()[:16]}"


class StrategyRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    strategy_id: str
    strategy: EvolvableStrategy
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    status: Literal["candidate", "selected", "rejected"] = "candidate"
    parent_strategy_id: str | None = None
    generation: int = Field(default=0, ge=0)


class PerformanceRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    performance_id: str = Field(default_factory=lambda: str(uuid4()))
    strategy_id: str
    source: PerformanceSource
    symbol: str
    interval: str | None = None
    rows: int | None = Field(default=None, ge=0)
    started_at: datetime | None = None
    ended_at: datetime | None = None
    total_return: float
    sharpe_ratio: float | None
    max_drawdown: float
    win_rate: float | None
    profit_factor: float | None
    stability_score: float
    total_trades: int
    score: float
    metadata: dict[str, float | int | str | bool | None] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class EvolutionRunRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(default_factory=lambda: str(uuid4()))
    symbol: str
    interval: str
    baseline_strategy_id: str
    best_strategy_id: str
    trials: int
    performance_delta: dict[str, float]
    confidence_score: float
    overfit_score: float
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class StrategyRepository:
    def __init__(self, store_path: str | None = None) -> None:
        default_path = Path(".agent-trader-runtime") / "strategy-evolution.json"
        self.store_path = Path(store_path or os.getenv("EVOLUTION_STORE_PATH", str(default_path))).resolve()
        self.store_path.parent.mkdir(parents=True, exist_ok=True)

    def upsert_strategy(
        self,
        strategy: EvolvableStrategy,
        *,
        status: Literal["candidate", "selected", "rejected"] = "candidate",
        parent_strategy_id: str | None = None,
        generation: int = 0,
    ) -> StrategyRecord:
        state = self._read_state()
        strategy_id = strategy.strategy_id
        existing = state["strategies"].get(strategy_id)
        if existing:
            record = StrategyRecord.model_validate(existing)
            record.updated_at = datetime.now(UTC)
            record.status = status
            record.parent_strategy_id = parent_strategy_id or record.parent_strategy_id
            record.generation = max(record.generation, generation)
        else:
            record = StrategyRecord(
                strategy_id=strategy_id,
                strategy=strategy,
                status=status,
                parent_strategy_id=parent_strategy_id,
                generation=generation,
            )
        state["strategies"][strategy_id] = record.model_dump(mode="json")
        self._write_state(state)
        return record

    def update_strategy_status(self, strategy_id: str, status: Literal["candidate", "selected", "rejected"]) -> None:
        state = self._read_state()
        if strategy_id not in state["strategies"]:
            return
        record = StrategyRecord.model_validate(state["strategies"][strategy_id])
        record.status = status
        record.updated_at = datetime.now(UTC)
        state["strategies"][strategy_id] = record.model_dump(mode="json")
        self._write_state(state)

    def append_performance(self, record: PerformanceRecord) -> PerformanceRecord:
        state = self._read_state()
        state["performance"].append(record.model_dump(mode="json"))
        self._write_state(state)
        return record

    def append_run(self, record: EvolutionRunRecord) -> EvolutionRunRecord:
        state = self._read_state()
        state["runs"].append(record.model_dump(mode="json"))
        self._write_state(state)
        return record

    def list_strategies(self) -> list[StrategyRecord]:
        state = self._read_state()
        return [StrategyRecord.model_validate(item) for item in state["strategies"].values()]

    def list_performance(self, strategy_id: str | None = None) -> list[PerformanceRecord]:
        state = self._read_state()
        records = [PerformanceRecord.model_validate(item) for item in state["performance"]]
        if strategy_id:
            return [record for record in records if record.strategy_id == strategy_id]
        return records

    def _read_state(self) -> dict:
        if not self.store_path.exists():
            return {"strategies": {}, "performance": [], "runs": []}
        with self.store_path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        return {
            "strategies": payload.get("strategies", {}),
            "performance": payload.get("performance", []),
            "runs": payload.get("runs", []),
        }

    def _write_state(self, state: dict) -> None:
        temporary_path = self.store_path.with_suffix(".tmp")
        with temporary_path.open("w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False, indent=2)
        temporary_path.replace(self.store_path)
