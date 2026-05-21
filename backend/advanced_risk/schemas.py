from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from services.binance import normalize_interval, normalize_symbol

ExchangeName = Literal["binance", "bybit"]
RiskLevel = Literal["low", "medium", "high"]


class AdvancedRiskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName = "binance"
    symbols: list[str] = Field(default_factory=lambda: ["BTCUSDT", "ETHUSDT"], min_length=1, max_length=12)
    interval: str = "1h"
    lookback: int = Field(default=500, ge=120, le=1000)
    weights: dict[str, float] | None = None
    portfolio_value: float = Field(default=10_000.0, gt=0.0, le=100_000_000.0)
    confidence_level: float = Field(default=0.95, gt=0.80, lt=0.999)
    horizon_bars: int = Field(default=1, ge=1, le=72)
    stress_window_bars: int = Field(default=24, ge=1, le=168)
    max_weight_per_asset: float = Field(default=0.50, gt=0.0, le=1.0)
    max_portfolio_var_fraction: float = Field(default=0.03, gt=0.0, le=1.0)
    max_portfolio_cvar_fraction: float = Field(default=0.05, gt=0.0, le=1.0)
    max_stress_loss_fraction: float = Field(default=0.12, gt=0.0, le=1.0)
    max_pair_correlation: float = Field(default=0.85, ge=0.0, le=1.0)
    include_liquidity: bool = True
    liquidity_target_notional: float | None = Field(default=None, gt=10.0, le=1_000_000.0)
    microstructure_sample_seconds: float = Field(default=1.0, ge=0.5, le=5.0)
    min_liquidity_score: float = Field(default=0.55, ge=0.0, le=1.0)
    use_websocket: bool = True
    allow_rest_fallback: bool = True

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

    @model_validator(mode="after")
    def normalize_weight_symbols(self) -> "AdvancedRiskRequest":
        if self.weights is None:
            return self
        normalized_weights: dict[str, float] = {}
        for symbol, weight in self.weights.items():
            normalized_symbol = normalize_symbol(symbol)
            if normalized_symbol not in self.symbols:
                raise ValueError(f"weight symbol {normalized_symbol} is not present in symbols")
            normalized_weights[normalized_symbol] = float(weight)
        if not normalized_weights:
            raise ValueError("weights cannot be empty")
        missing = set(self.symbols) - set(normalized_weights)
        if missing:
            raise ValueError(f"weights missing symbols: {', '.join(sorted(missing))}")
        if sum(abs(value) for value in normalized_weights.values()) <= 0:
            raise ValueError("weights must contain non-zero exposure")
        self.weights = normalized_weights
        return self


class RiskMetric(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fraction: float
    amount: float
    confidence_level: float | None = None
    horizon_bars: int | None = None


class StressScenarioResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    loss_fraction: float
    loss_amount: float
    source: str
    details: dict[str, Any]


class CorrelationShockResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    available: bool
    average_correlation: float | None
    max_pair_correlation: float | None
    rolling_max_pair_correlation: float | None
    shock_loss_fraction: float | None
    shock_loss_amount: float | None
    source: str


class LiquiditySymbolRisk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    target_notional: float
    liquidity_score: float
    spread_bps: float
    order_book_imbalance: float
    buy_slippage_bps: float | None
    sell_slippage_bps: float | None
    execution_feasibility: bool
    anomaly_flags: list[str]
    source: str


class LiquidityRiskResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    available: bool
    weighted_liquidity_score: float | None
    worst_liquidity_score: float | None
    liquidity_risk_score: float | None
    by_symbol: dict[str, LiquiditySymbolRisk]


class ConcentrationRiskResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_weight: float
    gross_exposure: float
    net_exposure: float
    herfindahl_index: float
    concentration_score: float = Field(ge=0.0, le=1.0)
    violations: list[str]


class AdvancedRiskResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName
    symbols: list[str]
    interval: str
    lookback: int
    weights: dict[str, float]
    portfolio_value: float
    data_start: datetime
    data_end: datetime
    rows: int
    var: float
    cvar: float
    stress_loss: float
    risk_level: RiskLevel
    var_metric: RiskMetric
    cvar_metric: RiskMetric
    stress_tests: list[StressScenarioResult]
    scenario_analysis: dict[str, Any]
    correlation_shock: CorrelationShockResult
    liquidity_risk: LiquidityRiskResult
    concentration_risk: ConcentrationRiskResult
    risk_score: float = Field(ge=0.0, le=1.0)
    violations: list[str]
    data_sources: list[str]
    generated_at: datetime
