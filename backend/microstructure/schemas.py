from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from services.binance import normalize_symbol

ExchangeName = Literal["binance", "bybit"]
ExecutionPressure = Literal["buy_pressure", "sell_pressure", "neutral"]


class MicrostructureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName = "binance"
    symbol: str = "BTCUSDT"
    depth: Literal[1, 5, 10, 20, 50, 200] | None = None
    target_notional: float = Field(default=1_000.0, gt=10.0, le=1_000_000.0)
    imbalance_levels: int = Field(default=10, ge=1, le=200)
    sample_seconds: float = Field(default=2.0, ge=0.5, le=10.0)
    ws_timeout_seconds: float = Field(default=8.0, ge=1.0, le=30.0)
    use_websocket: bool = True
    allow_rest_fallback: bool = True
    max_spread_bps: float = Field(default=10.0, gt=0.0, le=1000.0)
    min_liquidity_score: float = Field(default=0.55, ge=0.0, le=1.0)
    max_latency_ms: float = Field(default=1500.0, gt=0.0, le=60_000.0)
    max_volatility_bps: float = Field(default=35.0, gt=0.0, le=5000.0)
    max_abs_imbalance: float = Field(default=0.65, gt=0.0, le=1.0)

    @field_validator("symbol")
    @classmethod
    def normalize_request_symbol(cls, value: str) -> str:
        return normalize_symbol(value)


class MicrostructureDepth(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bid_levels: int
    ask_levels: int
    bid_depth_usdt: float
    ask_depth_usdt: float
    total_depth_usdt: float
    top_bid_depth_usdt: float
    top_ask_depth_usdt: float


class MicrostructureExecution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_notional: float
    buy_quantity: float
    sell_quantity: float
    buy_vwap: float | None
    sell_vwap: float | None
    buy_slippage_bps: float | None
    sell_slippage_bps: float | None
    buy_market_impact_bps: float | None
    sell_market_impact_bps: float | None
    buy_levels_used: int
    sell_levels_used: int


class MicrostructureAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName
    symbol: str
    source: str
    received_at: datetime
    latency_ms: float
    sample_count: int
    best_bid: float
    best_ask: float
    mid_price: float
    spread_bps: float
    order_book_depth: MicrostructureDepth
    order_book_imbalance: float = Field(ge=-1.0, le=1.0)
    liquidity_score: float = Field(ge=0.0, le=1.0)
    execution_pressure: ExecutionPressure
    short_term_volatility_bps: float | None
    execution: MicrostructureExecution
    abnormal_book: bool
    anomaly_flags: list[str]
    execution_feasibility: bool
