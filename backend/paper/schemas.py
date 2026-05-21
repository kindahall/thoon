from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

OrderSide = Literal["buy", "sell"]
OrderStatus = Literal["filled"]


class RiskLimits(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_order_notional: float = Field(default=10_000.0, gt=0)
    max_position_notional: float = Field(default=50_000.0, gt=0)
    max_abs_quantity: float = Field(default=10.0, gt=0)
    max_daily_trades: int = Field(default=200, gt=0)
    max_realized_loss: float = Field(default=5_000.0, ge=0)
    allow_short: bool = False
    fee_rate: float = Field(default=0.001, ge=0, le=0.1)


class PaperOrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str = "BTCUSDT"
    side: OrderSide
    quantity: float = Field(..., gt=0)
    client_order_id: str | None = Field(default=None, min_length=1, max_length=64)

    @field_validator("side", mode="before")
    @classmethod
    def normalize_side(cls, value: str) -> str:
        return value.lower().strip()


class PositionSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    quantity: float
    average_entry_price: float
    market_price: float
    market_value: float
    realized_pnl: float
    unrealized_pnl: float
    total_pnl: float
    updated_at: datetime


class TradeExecution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    symbol: str
    side: OrderSide
    status: OrderStatus
    quantity: float
    price: float
    notional: float
    fee: float
    realized_pnl_delta: float
    position_quantity_after: float
    average_entry_price_after: float
    source: str
    timestamp: datetime
    client_order_id: str | None = None


class PaperTradingState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    position: PositionSnapshot
    risk_limits: RiskLimits
    trades_count: int
    last_trade: TradeExecution | None
    source: str
    timestamp: datetime
