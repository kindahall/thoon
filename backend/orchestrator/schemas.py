from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from agents.macro_market import MacroAnalysis, MacroMarketSnapshot
from paper.schemas import RiskLimits
from services.schemas import Ticker24h

Regime = Literal["risk_on", "risk_off", "neutral"]
SignalDirection = Literal["bullish", "bearish", "neutral"]
StrategySide = Literal["long", "short", "flat"]
StrategyStatus = Literal["approved", "rejected", "observe"]


class OrchestrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str = "BTCUSDT"
    interval: str = "1h"
    limit: int = Field(default=120, ge=60, le=500)
    include_fred: bool = True
    llm_model: str | None = None
    max_llm_retries: int = Field(default=2, ge=0, le=5)


class MarketCandle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timestamp: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class MarketSentiment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["binance_derived_market_sentiment"]
    score: float = Field(ge=-1.0, le=1.0)
    label: SignalDirection
    inputs: list[str]


class DataIngestionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    interval: str
    price: float
    ticker_24h: Ticker24h
    candles: list[MarketCandle]
    macro_snapshot: MacroMarketSnapshot
    sentiment: MarketSentiment
    source: Literal["binance_rest_fred_optional"]
    timestamp: datetime


class MarketFeature(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    value: float | str
    direction: SignalDirection
    weight: float = Field(ge=0.0, le=1.0)


class MarketAnalysisOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    close: float
    trend_percent: float
    momentum_24h_percent: float
    realized_volatility_percent: float
    lookback_drawdown_percent: float
    quote_volume_24h: float
    liquidity_score: float = Field(ge=0.0, le=1.0)
    features: list[MarketFeature]
    timestamp: datetime


class StrategyCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    symbol: str
    side: StrategySide
    time_horizon: Literal["intraday", "swing", "position"]
    entry_price: float = Field(ge=0)
    stop_loss_price: float = Field(ge=0)
    take_profit_price: float = Field(ge=0)
    position_size_fraction: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    signals: list[str]
    rationale: str


class StrategyCritique(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepted: bool
    score: float = Field(ge=0.0, le=1.0)
    violations: list[str]
    required_changes: list[str]
    rationale: str


class RiskProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    side: StrategySide
    current_price: float
    requested_notional: float
    projected_exposure: float
    estimated_drawdown: float
    realized_volatility_percent: float
    lookback_drawdown_percent: float
    current_position_quantity: float
    current_position_market_value: float
    risk_limits: RiskLimits
    within_limits: bool
    violations: list[str]


class FinalStrategy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: StrategyStatus
    name: str
    symbol: str
    side: StrategySide
    time_horizon: Literal["intraday", "swing", "position"]
    entry_price: float = Field(ge=0)
    stop_loss_price: float = Field(ge=0)
    take_profit_price: float = Field(ge=0)
    position_size_fraction: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    rejection_reasons: list[str]
    signals: list[str]
    rationale: str


class StrategyOrchestrationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    strategy: FinalStrategy
    risk_profile: RiskProfile
    confidence: float = Field(ge=0.0, le=1.0)
    regime: Regime
    reasoning_chain: list[str]


class StrategyOrchestrationState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request: OrchestrationRequest
    ingestion: DataIngestionOutput | None = None
    market_analysis: MarketAnalysisOutput | None = None
    macro_analysis: MacroAnalysis | None = None
    strategy_candidate: StrategyCandidate | None = None
    critique: StrategyCritique | None = None
    risk_profile: RiskProfile | None = None
    final_decision: StrategyOrchestrationResult | None = None
