from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ExchangeName = Literal["binance", "bybit"]
RLAlgorithm = Literal["ppo"]
RLActionName = Literal["hold", "buy", "sell"]
ACTION_NAMES: dict[int, RLActionName] = {0: "hold", 1: "buy", 2: "sell"}


class RLTrainRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName = "binance"
    symbol: str = "BTCUSDT"
    interval: str = "1h"
    limit: int = Field(default=600, ge=180, le=1000)
    train_ratio: float = Field(default=0.7, gt=0.5, lt=0.9)
    walk_forward_splits: int = Field(default=3, ge=1, le=5)
    total_timesteps: int = Field(default=2_000, ge=256, le=100_000)
    initial_cash: float = Field(default=10_000.0, gt=0)
    fee_rate: float = Field(default=0.001, ge=0.0, le=0.1)
    drawdown_penalty: float = Field(default=0.2, ge=0.0, le=5.0)
    volatility_penalty: float = Field(default=0.05, ge=0.0, le=5.0)
    seed: int = 42


class RLPerformanceMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_return: float
    final_equity: float
    total_trades: int
    win_rate: float | None
    profit_factor: float | None
    sharpe_ratio: float | None
    max_drawdown: float
    stability_score: float
    walk_forward_splits: int
    test_rows: int


class RLTrainResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    trained_model: str
    algorithm: RLAlgorithm
    performance_metrics: RLPerformanceMetrics
    sharpe_ratio: float | None
    max_drawdown: float
    stability_score: float


class RLPaperValidationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    trained_model: str
    exchange: ExchangeName = "binance"
    symbol: str = "BTCUSDT"
    interval: str = "1h"
    lookback: int = Field(default=120, ge=60, le=1000)
    quantity: float = Field(default=0.00001, gt=0)
    execute_trade: bool = True


class RLPaperValidationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str
    symbol: str
    action: RLActionName
    confidence: float | None
    paper_order_id: str | None
    paper_state: dict
    source: str
