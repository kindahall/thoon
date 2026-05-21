from fastapi import APIRouter, HTTPException, Query

from services.binance import BinanceAPIError, BinanceClient
from services.schemas import Candle, HealthStatus, Price, Ticker24h

router = APIRouter()
binance_client = BinanceClient()


@router.get("/health", response_model=HealthStatus)
async def health() -> HealthStatus:
    rest_ok = await binance_client.ping()
    return HealthStatus(status="ok" if rest_ok else "degraded", binance_rest="ok" if rest_ok else "error")


@router.get("/candles/{symbol}", response_model=list[Candle])
async def candles(
    symbol: str,
    interval: str = Query(default="1s"),
    limit: int = Query(default=300, ge=1, le=1000),
) -> list[Candle]:
    try:
        return await binance_client.get_candles(symbol=symbol, interval=interval, limit=limit)
    except BinanceAPIError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.get("/price/{symbol}", response_model=Price)
async def price(symbol: str) -> Price:
    try:
        return await binance_client.get_price(symbol)
    except BinanceAPIError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.get("/ticker/{symbol}", response_model=Ticker24h)
async def ticker(symbol: str) -> Ticker24h:
    try:
        return await binance_client.get_24h_ticker(symbol)
    except BinanceAPIError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
