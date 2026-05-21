from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from advanced_risk.schemas import AdvancedRiskResult
from services.binance import normalize_interval, normalize_symbol

PortfolioRegime = Literal["risk_on", "risk_off", "neutral", "high_volatility", "low_liquidity"]
OptimizationMethod = Literal["mean_variance", "risk_parity", "max_sharpe"]
CovarianceMethod = Literal["rolling", "exponential"]
ExchangeName = Literal["binance", "bybit"]
AdvancedPortfolioMethod = Literal["hrp", "risk_budgeting", "blend"]


class PortfolioAllocationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    top_n: int = Field(default=5, ge=2, le=20)
    interval: str = "1h"
    lookback: int = Field(default=240, ge=60, le=1000)
    covariance_method: CovarianceMethod = "exponential"
    optimization_method: OptimizationMethod = "max_sharpe"
    max_exposure_per_asset: float = Field(default=0.35, gt=0.0, le=1.0)
    leverage_cap: float = Field(default=1.0, gt=0.0, le=2.0)
    max_drawdown: float = Field(default=0.15, gt=0.0, lt=1.0)
    risk_free_rate: float = Field(default=0.0, ge=0.0, le=0.25)
    include_fred: bool = True
    use_macro_agent_llm: bool = True
    llm_model: str | None = None


class PortfolioAllocationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    portfolio_weights: dict[str, float]
    expected_return: float
    expected_risk: float
    sharpe_estimate: float
    regime: PortfolioRegime
    reasoning: str


class AssetUniverseEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    quote_volume: float
    last_price: float


class PortfolioRiskConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_exposure_per_asset: float = Field(gt=0.0, le=1.0)
    leverage_cap: float = Field(gt=0.0, le=2.0)
    max_drawdown: float = Field(gt=0.0, lt=1.0)
    target_exposure: float = Field(gt=0.0, le=2.0)
    long_only: bool = True


class MathValidationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    valid: bool
    violations: list[str]


class AdvancedPortfolioRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName = "binance"
    symbols: list[str] = Field(default_factory=lambda: ["BTCUSDT", "ETHUSDT"], min_length=2, max_length=12)
    interval: str = "1h"
    lookback: int = Field(default=500, ge=240, le=1000)
    method: AdvancedPortfolioMethod = "blend"
    covariance_method: CovarianceMethod = "exponential"
    target_volatility: float = Field(default=0.35, gt=0.01, le=2.0)
    max_gross_exposure: float = Field(default=1.0, gt=0.0, le=2.0)
    max_weight_per_asset: float = Field(default=0.50, gt=0.0, le=1.0)
    min_cash_weight: float = Field(default=0.05, ge=0.0, le=0.95)
    max_cash_weight: float = Field(default=0.80, ge=0.0, le=0.99)
    drawdown_sensitivity: float = Field(default=0.65, ge=0.0, le=2.0)
    max_asset_drawdown: float = Field(default=0.35, gt=0.0, le=1.0)
    risk_budget_targets: dict[str, float] | None = None
    hrp_blend_weight: float = Field(default=0.50, ge=0.0, le=1.0)
    include_macro_regime: bool = True
    require_macro_regime: bool = False
    macro_lookback_days: int = Field(default=540, ge=120, le=2500)
    include_advanced_risk: bool = True
    include_liquidity_risk: bool = True
    portfolio_value: float = Field(default=10_000.0, gt=0.0, le=100_000_000.0)
    risk_confidence_level: float = Field(default=0.95, gt=0.80, lt=0.999)
    risk_horizon_bars: int = Field(default=1, ge=1, le=72)
    use_websocket_liquidity: bool = True
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
    def validate_cash_and_budget(self) -> "AdvancedPortfolioRequest":
        if self.min_cash_weight > self.max_cash_weight:
            raise ValueError("min_cash_weight cannot exceed max_cash_weight")
        if self.max_weight_per_asset * len(self.symbols) < 1.0:
            raise ValueError("max_weight_per_asset is too low for the requested symbol count")
        if self.risk_budget_targets is not None:
            normalized: dict[str, float] = {}
            for symbol, value in self.risk_budget_targets.items():
                normalized_symbol = normalize_symbol(symbol)
                if normalized_symbol not in self.symbols:
                    raise ValueError(f"risk budget symbol {normalized_symbol} is not present in symbols")
                normalized[normalized_symbol] = float(value)
            missing = set(self.symbols) - set(normalized)
            if missing:
                raise ValueError(f"risk budget targets missing symbols: {', '.join(sorted(missing))}")
            total = sum(max(0.0, value) for value in normalized.values())
            if total <= 0:
                raise ValueError("risk_budget_targets must contain positive values")
            self.risk_budget_targets = {symbol: value / total for symbol, value in normalized.items()}
        return self


class RiskBudgetEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: float
    contribution: float
    weight: float


class AdvancedPortfolioResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName
    symbols: list[str]
    interval: str
    lookback: int
    method: AdvancedPortfolioMethod
    weights: dict[str, float]
    target_volatility: float
    realized_volatility: float
    expected_return: float
    expected_risk: float
    risk_budget: dict[str, RiskBudgetEntry]
    hrp_weights: dict[str, float]
    risk_budget_weights: dict[str, float]
    drawdown_adjusted_weights: dict[str, float]
    cash_weight: float
    macro_regime: str
    macro_confidence: float | None
    macro_risk_score: float | None
    risk_level: str | None
    risk_score: float | None
    advanced_risk: AdvancedRiskResult | None
    data_start: datetime
    data_end: datetime
    rows: int
    data_sources: list[str]
    reasoning: str
    generated_at: datetime
