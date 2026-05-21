from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from services.binance import normalize_interval, normalize_symbol

ExchangeName = Literal["binance", "bybit"]
StrategyType = Literal[
    "sma_cross",
    "ema_trend",
    "donchian_breakout",
    "rsi_mean_reversion",
    "bollinger_reversion",
    "momentum_volatility",
    "volume_breakout",
]
StrategyStatus = Literal["candidate", "active", "retired"]
SelectionStatus = Literal["selected", "rejected"]
RegimeName = Literal["bull_market", "bear_market", "high_volatility", "low_liquidity"]


class QuantResearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName = "binance"
    symbol: str = "BTCUSDT"
    interval: str = "1h"
    limit: int = Field(default=500, ge=220, le=1000)
    top_n: int = Field(default=5, ge=1, le=20)
    max_candidates: int = Field(default=10, ge=3, le=40)
    train_ratio: float = Field(default=0.6, gt=0.45, lt=0.8)
    validation_ratio: float = Field(default=0.25, gt=0.1, lt=0.4)
    initial_cash: float = Field(default=10_000.0, gt=0)
    fees: float = Field(default=0.001, ge=0.0, le=0.1)
    min_trades: int = Field(default=1, ge=0, le=200)
    max_drawdown: float = Field(default=0.35, gt=0.0, le=0.95)
    max_overfit_score: float = Field(default=0.32, ge=0.0, le=1.0)
    min_stability_score: float = Field(default=0.15, ge=0.0, le=1.0)
    exploration_rate: float = Field(default=0.35, ge=0.0, le=1.0)
    force_new_generation: bool = False

    @field_validator("symbol")
    @classmethod
    def normalize_request_symbol(cls, value: str) -> str:
        return normalize_symbol(value)

    @field_validator("interval")
    @classmethod
    def normalize_request_interval(cls, value: str) -> str:
        return normalize_interval(value)


class StrategyRegistryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(default="sma_cross", min_length=1, max_length=96)
    strategy_type: StrategyType = "sma_cross"
    params: dict[str, int | float | str | bool] = Field(default_factory=dict)
    conditions: dict[str, Any] = Field(default_factory=dict)
    regime_tags: list[RegimeName] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    parent_strategy_id: str | None = Field(default=None, max_length=128)
    status: StrategyStatus = "candidate"


class StrategyRegistryRecord(StrategyRegistryInput):
    strategy_id: str
    version_id: str
    content_hash: str
    version: int
    created_at: datetime


class StrategyPerformanceMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_return: float
    sharpe_ratio: float | None
    sortino_ratio: float | None
    max_drawdown: float
    win_rate: float | None
    profit_factor: float | None
    stability_over_time: float = Field(ge=0.0, le=1.0)
    total_trades: int
    final_value: float


class EvaluationSplitMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    split: Literal["train", "validation", "test", "full"]
    rows: int
    start: datetime
    end: datetime
    metrics: StrategyPerformanceMetrics


class RegimePerformance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    regime: RegimeName
    rows: int
    bar_ratio: float = Field(ge=0.0, le=1.0)
    strategy_return: float
    market_return: float
    realized_volatility: float
    average_volume: float
    liquidity_score: float = Field(ge=0.0)


class StrategyEvaluationRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evaluation_id: str
    strategy_id: str
    version_id: str
    exchange: ExchangeName
    symbol: str
    interval: str
    rows: int
    data_start: datetime
    data_end: datetime
    train: EvaluationSplitMetrics
    validation: EvaluationSplitMetrics
    test: EvaluationSplitMetrics
    full: EvaluationSplitMetrics
    regime_breakdown: dict[RegimeName, RegimePerformance]
    overfit_score: float = Field(ge=0.0, le=1.0)
    ranking_score: float
    selection_status: SelectionStatus
    rejection_reasons: list[str]
    created_at: datetime


class PerformanceMatrixEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    strategy_id: str
    version_id: str
    ranking_score: float
    selection_status: SelectionStatus
    train_return: float
    validation_return: float
    test_return: float
    full_return: float
    test_sharpe: float | None
    test_sortino: float | None
    test_drawdown: float
    test_win_rate: float | None
    test_profit_factor: float | None
    test_stability: float
    overfit_score: float


class QuantResearchOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    best_strategies: list[StrategyEvaluationRecord]
    rejected_strategies: list[StrategyEvaluationRecord]
    performance_matrix: dict[str, PerformanceMatrixEntry]
    regime_breakdown: dict[RegimeName, list[RegimePerformance]]
    system_health_score: float = Field(ge=0.0, le=1.0)


class ResearchRunRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    request: QuantResearchRequest
    best_strategy_ids: list[str]
    rejected_strategy_ids: list[str]
    performance_matrix: dict[str, PerformanceMatrixEntry]
    regime_breakdown: dict[RegimeName, list[RegimePerformance]]
    system_health_score: float = Field(ge=0.0, le=1.0)
    created_at: datetime


class PaperResultRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    paper_result_id: str
    strategy_id: str
    symbol: str
    trade_count: int
    realized_pnl: float
    total_notional: float
    win_rate: float | None
    source: str
    created_at: datetime
