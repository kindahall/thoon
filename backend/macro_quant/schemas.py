from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from services.binance import normalize_interval, normalize_symbol

ExchangeName = Literal["binance", "bybit"]
MacroRegime = Literal[
    "risk_on",
    "risk_off",
    "tightening_liquidity",
    "easing_liquidity",
    "high_inflation",
    "low_inflation",
]


class CrossAssetMacroRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    crypto_exchange: ExchangeName = "binance"
    symbols: list[str] = Field(default_factory=lambda: ["BTCUSDT", "ETHUSDT"], min_length=2, max_length=6)
    interval: str = "1h"
    crypto_lookback: int = Field(default=720, ge=240, le=1000)
    macro_lookback_days: int = Field(default=540, ge=120, le=2500)
    correlation_window: int = Field(default=60, ge=20, le=240)
    breakdown_threshold: float = Field(default=0.35, ge=0.05, le=1.0)
    max_crypto_weight: float = Field(default=0.85, gt=0.0, le=1.0)
    min_cash_weight: float = Field(default=0.05, ge=0.0, le=0.9)

    @field_validator("symbols")
    @classmethod
    def normalize_symbols(cls, value: list[str]) -> list[str]:
        normalized = [normalize_symbol(symbol) for symbol in value]
        if len(set(normalized)) != len(normalized):
            raise ValueError("symbols must be unique")
        if "BTCUSDT" not in normalized or "ETHUSDT" not in normalized:
            raise ValueError("symbols must include BTCUSDT and ETHUSDT")
        return normalized

    @field_validator("interval")
    @classmethod
    def normalize_request_interval(cls, value: str) -> str:
        return normalize_interval(value)


class MacroSeriesSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    series_id: str
    name: str
    latest_value: float
    latest_date: datetime
    change_1m: float | None
    change_3m: float | None
    source: str


class CorrelationSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    latest: float | None
    previous: float | None
    breakdown: bool


class CrossAssetMacroOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    macro_regime: MacroRegime
    correlations: dict[str, CorrelationSnapshot]
    allocation: dict[str, float]
    risk_score: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
