from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from services.binance import normalize_symbol

ExchangeName = Literal["binance", "bybit"]
OrderSide = Literal["buy", "sell"]


class OrderBookLevel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    price: float = Field(..., gt=0)
    quantity: float = Field(..., ge=0)

    @property
    def notional(self) -> float:
        return self.price * self.quantity


class OrderBookSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName
    symbol: str
    bids: list[OrderBookLevel]
    asks: list[OrderBookLevel]
    source: str
    update_id: int | None = None
    exchange_timestamp_ms: int | None = None
    received_at: datetime
    latency_ms: float
    sample_count: int = 1
    volatility_bps: float | None = None
    mid_price_series: list[float] = Field(default_factory=list, exclude=True)

    @property
    def best_bid(self) -> float:
        return self.bids[0].price if self.bids else 0.0

    @property
    def best_ask(self) -> float:
        return self.asks[0].price if self.asks else 0.0

    @property
    def mid_price(self) -> float:
        if self.best_bid <= 0 or self.best_ask <= 0:
            return 0.0
        return (self.best_bid + self.best_ask) / 2.0

    @property
    def top_liquidity_usdt(self) -> float:
        bid_liquidity = self.bids[0].notional if self.bids else 0.0
        ask_liquidity = self.asks[0].notional if self.asks else 0.0
        return bid_liquidity + ask_liquidity


class ArbitrageScanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbols: list[str] = Field(default_factory=lambda: ["BTCUSDT", "ETHUSDT"], min_length=1, max_length=8)
    target_notional: float = Field(default=250.0, gt=10.0, le=100_000.0)
    min_net_spread_bps: float = Field(default=2.0, ge=0.0, le=500.0)
    min_liquidity_usdt: float = Field(default=500.0, ge=0.0)
    max_latency_ms: float = Field(default=1500.0, gt=0.0)
    max_volatility_bps: float = Field(default=35.0, gt=0.0)
    binance_taker_fee_bps: float = Field(default=10.0, ge=0.0, le=100.0)
    bybit_taker_fee_bps: float = Field(default=10.0, ge=0.0, le=100.0)
    latency_penalty_bps_per_second: float = Field(default=1.0, ge=0.0, le=100.0)
    binance_depth: Literal[5, 10, 20] = 20
    bybit_depth: Literal[1, 50, 200] = 50
    sample_seconds: float = Field(default=2.0, ge=0.5, le=10.0)
    ws_timeout_seconds: float = Field(default=8.0, ge=1.0, le=30.0)
    allow_rest_fallback: bool = True
    max_opportunities: int = Field(default=10, ge=1, le=50)

    @field_validator("symbols")
    @classmethod
    def normalize_symbols(cls, value: list[str]) -> list[str]:
        normalized = [normalize_symbol(symbol) for symbol in value]
        return list(dict.fromkeys(normalized))


class ArbitrageOpportunity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    buy_exchange: ExchangeName
    sell_exchange: ExchangeName
    buy_price: float
    sell_price: float
    buy_vwap: float | None
    sell_vwap: float | None
    quantity: float
    target_notional: float
    gross_spread_bps: float
    buy_fee_bps: float
    sell_fee_bps: float
    buy_slippage_bps: float | None
    sell_slippage_bps: float | None
    latency_ms: float
    latency_penalty_bps: float
    volatility_bps: float | None
    liquidity_usdt: float
    fee_adjusted_profitability_bps: float
    expected_profit: float
    risk_score: float
    execution_feasibility: bool
    risk_violations: list[str]
    buy_orderbook_source: str
    sell_orderbook_source: str


class ArbitrageScanResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    arbitrage_opportunities: list[ArbitrageOpportunity]
    expected_profit: float
    risk_score: float
    execution_feasibility: bool


class ArbitragePaperExecutionRequest(ArbitrageScanRequest):
    execute_best_only: bool = True


class ArbitragePaperFill(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName
    symbol: str
    side: OrderSide
    quantity: float
    vwap_price: float
    notional: float
    fee: float
    source: str


class ArbitragePaperExecutionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    executed: bool
    status: str
    opportunity: ArbitrageOpportunity | None
    fills: list[ArbitragePaperFill]
    gross_profit: float
    fees_paid: float
    net_profit: float
    latency_ms: float | None
    timestamp: datetime
