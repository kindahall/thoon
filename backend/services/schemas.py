from pydantic import BaseModel, Field


class Candle(BaseModel):
    timestamp: int = Field(..., description="Binance candle open time in milliseconds")
    open: float
    high: float
    low: float
    close: float
    volume: float


class Price(BaseModel):
    symbol: str
    price: float


class LivePrice(BaseModel):
    symbol: str
    price: float
    timestamp: int


class Ticker24h(BaseModel):
    symbol: str
    price_change_percent: float
    last_price: float
    quote_volume: float
    volume: float


class HealthStatus(BaseModel):
    status: str
    binance_rest: str
