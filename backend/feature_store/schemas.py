from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from services.binance import normalize_interval, normalize_symbol

ExchangeName = Literal["binance", "bybit"]


class FeatureStoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName = "binance"
    symbols: list[str] = Field(default_factory=lambda: ["BTCUSDT", "ETHUSDT"], min_length=1, max_length=12)
    interval: str = "1h"
    lookback: int = Field(default=500, ge=120, le=1000)
    include_macro_factors: bool = True
    macro_lookback_days: int = Field(default=540, ge=120, le=2500)
    include_derivatives: bool = True
    persist: bool = True

    @field_validator("symbols")
    @classmethod
    def normalize_symbols(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            symbol = normalize_symbol(value)
            if symbol not in normalized:
                normalized.append(symbol)
        return normalized

    @field_validator("interval")
    @classmethod
    def normalize_request_interval(cls, value: str) -> str:
        return normalize_interval(value)


class FeatureSetRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    feature_set_id: str
    feature_set_key: str
    version: int
    feature_schema_version: str
    exchange: ExchangeName
    symbols: list[str]
    interval: str
    lookback: int
    rows_by_symbol: dict[str, int]
    data_start: datetime
    data_end: datetime
    data_sources: list[str]
    features: dict[str, Any]
    content_hash: str
    persisted: bool
    created_at: datetime
