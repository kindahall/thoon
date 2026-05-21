from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backtest.engine import StrategyConfig
from backtest.metrics import PerformanceMetrics
from data_quality.schemas import DataQualityIssue
from services.binance import normalize_interval, normalize_symbol

ExchangeName = Literal["binance", "bybit"]


class StrategyAttributionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName = "binance"
    symbol: str = "BTCUSDT"
    interval: str = "1h"
    lookback: int = Field(default=500, ge=120, le=1000)
    strategy: StrategyConfig = Field(default_factory=StrategyConfig)
    forward_bars: int = Field(default=24, ge=1, le=200)
    min_bucket_rows: int = Field(default=12, ge=3, le=200)
    min_data_quality_score: float = Field(default=0.75, ge=0.0, le=1.0)
    compare_cross_exchange: bool = True

    @field_validator("symbol")
    @classmethod
    def normalize_request_symbol(cls, value: str) -> str:
        return normalize_symbol(value)

    @field_validator("interval")
    @classmethod
    def normalize_request_interval(cls, value: str) -> str:
        return normalize_interval(value)


class AttributionBucket(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    rows: int = Field(ge=0)
    bar_ratio: float = Field(ge=0.0, le=1.0)
    strategy_return: float
    benchmark_return: float
    excess_return: float
    hit_rate: float | None = Field(default=None, ge=0.0, le=1.0)
    average_strategy_return: float
    volatility: float | None = None
    contribution_to_total_return: float


class SignalContribution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signal: str
    count: int = Field(ge=0)
    forward_bars: int = Field(ge=1)
    average_forward_return: float | None = None
    median_forward_return: float | None = None
    hit_rate: float | None = Field(default=None, ge=0.0, le=1.0)
    total_contribution: float
    best_timestamp: datetime | None = None
    worst_timestamp: datetime | None = None


class StrategyAttributionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName
    symbol: str
    interval: str
    rows: int = Field(ge=0)
    data_start: datetime
    data_end: datetime
    strategy: StrategyConfig
    performance: PerformanceMetrics
    benchmark_return: float
    data_quality_score: float = Field(ge=0.0, le=1.0)
    data_quality_issues: list[DataQualityIssue]
    attribution: dict[str, dict[str, AttributionBucket]]
    signal_contribution: dict[str, SignalContribution]
    strengths: list[str]
    weaknesses: list[str]
    data_sources: list[str]
    generated_at: datetime
