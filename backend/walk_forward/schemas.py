from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backtest.engine import StrategyConfig, StrategySignals
from backtest.metrics import PerformanceMetrics
from services.binance import normalize_interval, normalize_symbol

ExchangeName = Literal["binance", "bybit"]


class WalkForwardRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName = "binance"
    symbol: str = "BTCUSDT"
    interval: str = "1h"
    limit: int = Field(default=600, ge=240, le=1000)
    strategy: StrategyConfig = Field(default_factory=StrategyConfig)
    splits: int = Field(default=4, ge=2, le=10)
    train_ratio: float = Field(default=0.7, gt=0.5, lt=0.9)
    min_train_rows: int = Field(default=120, ge=60, le=1000)
    min_test_rows: int = Field(default=30, ge=20, le=500)
    min_walk_forward_score: float = Field(default=0.45, ge=0.0, le=1.0)
    max_overfit_risk: float = Field(default=0.55, ge=0.0, le=1.0)
    min_positive_test_ratio: float = Field(default=0.4, ge=0.0, le=1.0)

    @field_validator("symbol")
    @classmethod
    def normalize_request_symbol(cls, value: str) -> str:
        return normalize_symbol(value)

    @field_validator("interval")
    @classmethod
    def normalize_request_interval(cls, value: str) -> str:
        return normalize_interval(value)


class WalkForwardFoldResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fold_index: int = Field(ge=1)
    train_start: datetime
    train_end: datetime
    test_start: datetime
    test_end: datetime
    train_rows: int
    test_rows: int
    train_metrics: PerformanceMetrics
    test_metrics: PerformanceMetrics
    train_signals: StrategySignals
    test_signals: StrategySignals
    train_quality_score: float = Field(ge=0.0, le=1.0)
    test_quality_score: float = Field(ge=0.0, le=1.0)
    generalization_gap: float = Field(ge=0.0, le=1.0)
    stability_score: float = Field(ge=0.0, le=1.0)
    accepted: bool
    rejection_reasons: list[str]


class WalkForwardValidationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName
    symbol: str
    interval: str
    rows: int
    strategy: StrategyConfig
    splits: int
    train_ratio: float
    fold_results: list[WalkForwardFoldResult]
    walk_forward_score: float = Field(ge=0.0, le=1.0)
    overfit_risk: float = Field(ge=0.0, le=1.0)
    positive_test_ratio: float = Field(ge=0.0, le=1.0)
    stability_score: float = Field(ge=0.0, le=1.0)
    in_sample_score: float = Field(ge=0.0, le=1.0)
    out_of_sample_score: float = Field(ge=0.0, le=1.0)
    accepted: bool
    rejection_reasons: list[str]
