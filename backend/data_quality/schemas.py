from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from services.binance import normalize_interval, normalize_symbol

ExchangeName = Literal["binance", "bybit"]
IssueSeverity = Literal["info", "warning", "error"]
ComparisonStatus = Literal["not_requested", "available", "insufficient_overlap", "unavailable"]


class DataQualityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName = "binance"
    symbol: str = "BTCUSDT"
    interval: str = "1h"
    limit: int = Field(default=500, ge=60, le=1000)
    compare_cross_exchange: bool = True
    min_quality_score: float = Field(default=0.75, ge=0.0, le=1.0)
    max_missing_ratio: float = Field(default=0.02, ge=0.0, le=0.5)
    max_zero_volume_ratio: float = Field(default=0.01, ge=0.0, le=1.0)
    max_cross_exchange_close_deviation_bps: float = Field(default=75.0, gt=0.0, le=1000.0)
    max_single_bar_return_bps: float = Field(default=1500.0, gt=0.0, le=10000.0)

    @field_validator("symbol")
    @classmethod
    def normalize_request_symbol(cls, value: str) -> str:
        return normalize_symbol(value)

    @field_validator("interval")
    @classmethod
    def normalize_request_interval(cls, value: str) -> str:
        return normalize_interval(value)


class DataQualityIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    severity: IssueSeverity
    message: str
    count: int = Field(default=0, ge=0)
    metric: float | None = None
    threshold: float | None = None


class CrossExchangeComparison(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: ComparisonStatus
    primary_exchange: ExchangeName
    secondary_exchange: ExchangeName | None
    aligned_rows: int
    latest_close_deviation_bps: float | None
    median_close_deviation_bps: float | None
    max_close_deviation_bps: float | None
    close_return_correlation: float | None
    issues: list[DataQualityIssue]


class DataQualityResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName
    symbol: str
    interval: str
    rows: int
    start: datetime | None
    end: datetime | None
    expected_interval_seconds: int
    quality_score: float = Field(ge=0.0, le=1.0)
    usable_for_backtest: bool
    issues: list[DataQualityIssue]
    comparison: CrossExchangeComparison | None
