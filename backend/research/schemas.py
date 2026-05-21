from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backtest.metrics import PerformanceMetrics
from services.binance import normalize_interval, normalize_symbol

ExchangeName = Literal["binance", "bybit"]
ResearchStrategyStatus = Literal["candidate", "selected", "rejected"]
ResearchSplitName = Literal["train", "validation", "test", "full"]


class ResearchLabRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName = "binance"
    symbol: str = "BTCUSDT"
    interval: str = "1h"
    limit: int = Field(default=500, ge=180, le=1000)
    train_ratio: float = Field(default=0.6, gt=0.45, lt=0.8)
    validation_ratio: float = Field(default=0.25, gt=0.1, lt=0.4)
    max_candidates: int = Field(default=8, ge=3, le=20)
    use_llm_generator: bool = False
    llm_model: str | None = None
    max_llm_retries: int = Field(default=1, ge=0, le=3)
    initial_cash: float = Field(default=10_000.0, gt=0)
    fees: float = Field(default=0.001, ge=0.0, le=0.1)
    min_validation_trades: int = Field(default=1, ge=0, le=100)
    min_test_trades: int = Field(default=1, ge=0, le=100)
    max_overfit_score: float = Field(default=0.28, ge=0.0, le=1.0)
    max_drawdown: float = Field(default=0.35, gt=0.0, le=0.95)
    min_stability_score: float = Field(default=0.15, ge=0.0, le=1.0)

    @field_validator("symbol")
    @classmethod
    def normalize_request_symbol(cls, value: str) -> str:
        return normalize_symbol(value)

    @field_validator("interval")
    @classmethod
    def normalize_request_interval(cls, value: str) -> str:
        return normalize_interval(value)


class ResearchStrategyProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=96)
    fast_window: int = Field(..., ge=2, le=500)
    slow_window: int = Field(..., ge=3, le=1000)
    rationale: str = Field(default="", max_length=800)
    source: Literal["deterministic_real_data_agent", "llm_gateway_agent", "memory_mutation"]

    @field_validator("slow_window")
    @classmethod
    def validate_window_order(cls, value: int, info) -> int:
        fast_window = info.data.get("fast_window")
        if fast_window is not None and fast_window >= value:
            raise ValueError("fast_window must be lower than slow_window")
        return value


class StrategyGenerationPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    proposals: list[ResearchStrategyProposal] = Field(default_factory=list, max_length=20)
    research_insight: str = Field(default="", max_length=1200)


class BacktestSplitResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    split: ResearchSplitName
    rows: int
    start: datetime
    end: datetime
    metrics: PerformanceMetrics
    entries_count: int
    exits_count: int
    stability_score: float = Field(ge=0.0, le=1.0)


class ResearchCritique(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepted: bool
    overfit_score: float = Field(ge=0.0, le=1.0)
    statistical_issues: list[str]
    rationale: str


class ResearchRiskValidation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepted: bool
    risk_score: float = Field(ge=0.0, le=1.0)
    violations: list[str]


class ResearchStrategyResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    strategy_id: str
    status: ResearchStrategyStatus
    proposal: ResearchStrategyProposal
    exchange: ExchangeName
    symbol: str
    interval: str
    train: BacktestSplitResult
    validation: BacktestSplitResult
    test: BacktestSplitResult
    full: BacktestSplitResult
    critique: ResearchCritique
    risk_validation: ResearchRiskValidation
    selection_score: float
    rejection_reasons: list[str]
    created_at: datetime


class PerformanceEvolutionPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    created_at: datetime
    exchange: ExchangeName
    symbol: str
    interval: str
    selected_count: int
    rejected_count: int
    best_strategy_id: str | None
    best_score: float | None
    best_test_return: float | None
    best_test_sharpe: float | None
    best_test_drawdown: float | None


class ResearchLabOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    best_strategies: list[ResearchStrategyResult]
    rejected_strategies: list[ResearchStrategyResult]
    performance_evolution: list[PerformanceEvolutionPoint]
    research_insights: str


class ResearchRunRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run: PerformanceEvolutionPoint
    strategies: list[ResearchStrategyResult]
    research_insights: str
