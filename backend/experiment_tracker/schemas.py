from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backtest.engine import StrategyConfig, StrategySignals
from backtest.metrics import PerformanceMetrics
from data_quality.schemas import DataQualityIssue
from services.binance import normalize_interval, normalize_symbol
from walk_forward.schemas import WalkForwardValidationResult

ExchangeName = Literal["binance", "bybit"]
ExperimentStatus = Literal["accepted", "rejected"]


class ExperimentTrackerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName = "binance"
    symbol: str = "BTCUSDT"
    interval: str = "1h"
    lookback: int = Field(default=500, ge=240, le=1000)
    strategy: StrategyConfig = Field(default_factory=StrategyConfig)
    min_quality_score: float = Field(default=0.75, ge=0.0, le=1.0)
    compare_cross_exchange: bool = True
    run_walk_forward: bool = True
    walk_forward_splits: int = Field(default=4, ge=2, le=10)
    walk_forward_train_ratio: float = Field(default=0.7, gt=0.5, lt=0.9)
    min_walk_forward_score: float = Field(default=0.45, ge=0.0, le=1.0)
    max_walk_forward_overfit_risk: float = Field(default=0.55, ge=0.0, le=1.0)
    min_total_trades: int = Field(default=1, ge=0, le=500)
    min_total_return: float = Field(default=0.0, ge=-1.0, le=10.0)
    max_drawdown: float = Field(default=0.35, gt=0.0, le=0.95)
    tags: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("symbol")
    @classmethod
    def normalize_request_symbol(cls, value: str) -> str:
        return normalize_symbol(value)

    @field_validator("interval")
    @classmethod
    def normalize_request_interval(cls, value: str) -> str:
        return normalize_interval(value)


class ExperimentDataset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName
    symbol: str
    interval: str
    rows: int = Field(ge=0)
    data_start: datetime
    data_end: datetime
    data_sources: list[str]
    quality_score: float = Field(ge=0.0, le=1.0)
    quality_issues: list[DataQualityIssue]


class ExperimentResults(BaseModel):
    model_config = ConfigDict(extra="forbid")

    backtest_metrics: PerformanceMetrics | None
    signals: StrategySignals | None
    walk_forward: WalkForwardValidationResult | None
    errors: list[str]


class ExperimentDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: ExperimentStatus
    accepted: bool
    rejection_reasons: list[str]
    acceptance_criteria: dict[str, float | int | bool]


class ExperimentRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    experiment_id: str
    status: ExperimentStatus
    reproducible: bool
    strategy_version: str
    strategy_content_hash: str
    config_hash: str
    request: ExperimentTrackerRequest
    dataset: ExperimentDataset
    results: ExperimentResults
    decision: ExperimentDecision
    persisted: bool
    created_at: datetime
