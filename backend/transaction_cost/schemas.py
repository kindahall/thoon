from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from services.binance import normalize_symbol

ExchangeName = Literal["binance", "bybit"]
OrderSide = Literal["buy", "sell"]
FeeSource = Literal["account_api", "request_override", "configured_default"]


class TransactionCostRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName = "binance"
    symbol: str = "BTCUSDT"
    side: OrderSide = "buy"
    order_notional: float = Field(default=250.0, gt=10.0, le=1_000_000.0)
    depth: int = Field(default=100, ge=1, le=1000)
    fee_bps: float | None = Field(default=None, ge=0.0, le=200.0)
    require_account_fee: bool = False
    gross_edge_bps: float | None = Field(default=None, ge=-10_000.0, le=10_000.0)
    reject_if_edge_below_costs: bool = False
    latency_penalty_bps_per_second: float = Field(default=1.0, ge=0.0, le=100.0)
    max_estimated_cost_bps: float | None = Field(default=None, gt=0.0, le=1000.0)

    @field_validator("symbol")
    @classmethod
    def normalize_request_symbol(cls, value: str) -> str:
        return normalize_symbol(value)

    @field_validator("side", mode="before")
    @classmethod
    def normalize_side(cls, value: str) -> str:
        return value.lower().strip()


class FeeEstimate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fee_bps: float
    source: FeeSource
    account_fee_available: bool


class TransactionCostEstimate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName
    symbol: str
    side: OrderSide
    order_notional: float
    quantity: float
    best_bid: float
    best_ask: float
    mid_price: float
    vwap_price: float | None
    spread_bps: float
    half_spread_bps: float
    fee: FeeEstimate
    fee_amount: float
    slippage_bps: float
    market_impact_bps: float
    latency_ms: float
    latency_penalty_bps: float
    estimated_cost_bps: float
    estimated_cost_amount: float
    gross_edge_bps: float | None
    net_edge_after_costs: float
    available_liquidity_usdt: float
    filled_quantity: float
    levels_used: int
    execution_feasibility: bool
    issues: list[str]
    orderbook_source: str
    received_at: datetime
