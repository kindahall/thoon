from __future__ import annotations

import os
from typing import Any

import httpx
import pandas as pd

from backtest.data_loader import BinanceHistoricalDataLoader
from rl.schemas import ExchangeName
from services.binance import BinanceAPIError, normalize_symbol


class MarketDataError(RuntimeError):
    pass


class RLMarketDataLoader:
    BYBIT_INTERVALS = {
        "1m": "1",
        "3m": "3",
        "5m": "5",
        "15m": "15",
        "30m": "30",
        "1h": "60",
        "2h": "120",
        "4h": "240",
        "6h": "360",
        "12h": "720",
        "1d": "D",
        "1w": "W",
        "1M": "M",
    }

    def __init__(self) -> None:
        self.binance_loader = BinanceHistoricalDataLoader(
            base_url=os.getenv("BINANCE_REST_BASE_URL", "https://api.binance.com")
        )
        self.bybit_base_url = os.getenv("BYBIT_MARKET_BASE_URL", "https://api.bybit.com")

    async def download_ohlcv(
        self,
        *,
        exchange: ExchangeName,
        symbol: str,
        interval: str,
        limit: int,
    ) -> pd.DataFrame:
        if exchange == "binance":
            return await self.binance_loader.download_ohlcv(symbol=symbol, interval=interval, limit=limit)
        return await self._download_bybit_ohlcv(symbol=symbol, interval=interval, limit=limit)

    async def _download_bybit_ohlcv(self, *, symbol: str, interval: str, limit: int) -> pd.DataFrame:
        normalized_symbol = normalize_symbol(symbol)
        bybit_interval = self.BYBIT_INTERVALS.get(interval)
        if bybit_interval is None:
            raise MarketDataError(f"unsupported Bybit interval: {interval}")

        params = {
            "category": "spot",
            "symbol": normalized_symbol,
            "interval": bybit_interval,
            "limit": max(1, min(limit, 1000)),
        }
        async with httpx.AsyncClient(base_url=self.bybit_base_url, timeout=15) as client:
            try:
                response = await client.get("/v5/market/kline", params=params)
                response.raise_for_status()
            except httpx.HTTPStatusError as error:
                raise MarketDataError(f"Bybit historical kline failed: {response.text}") from error
            except httpx.HTTPError as error:
                raise MarketDataError(f"Bybit historical kline unavailable: {error}") from error
            payload: dict[str, Any] = response.json()

        if str(payload.get("retCode")) != "0":
            raise MarketDataError(f"Bybit historical kline rejected: {payload}")
        rows = payload.get("result", {}).get("list", [])
        if not rows:
            raise MarketDataError("Bybit returned no historical OHLCV rows")

        frame = pd.DataFrame(
            rows,
            columns=[
                "open_time",
                "open",
                "high",
                "low",
                "close",
                "volume",
                "quote_asset_volume",
            ],
        )
        frame["timestamp"] = pd.to_datetime(pd.to_numeric(frame["open_time"]), unit="ms", utc=True)
        for column in ["open", "high", "low", "close", "volume", "quote_asset_volume"]:
            frame[column] = pd.to_numeric(frame[column], errors="raise")
        result = frame.set_index("timestamp")[["open", "high", "low", "close", "volume", "quote_asset_volume"]]
        return result[~result.index.duplicated(keep="last")].sort_index().tail(limit)

    async def get_bybit_latest_price(self, symbol: str) -> tuple[str, float]:
        normalized_symbol = normalize_symbol(symbol)
        params = {"category": "spot", "symbol": normalized_symbol}
        async with httpx.AsyncClient(base_url=self.bybit_base_url, timeout=15) as client:
            try:
                response = await client.get("/v5/market/tickers", params=params)
                response.raise_for_status()
            except httpx.HTTPStatusError as error:
                raise MarketDataError(f"Bybit ticker failed: {response.text}") from error
            except httpx.HTTPError as error:
                raise MarketDataError(f"Bybit ticker unavailable: {error}") from error
            payload: dict[str, Any] = response.json()

        if str(payload.get("retCode")) != "0":
            raise MarketDataError(f"Bybit ticker rejected: {payload}")
        rows = payload.get("result", {}).get("list", [])
        if not rows:
            raise MarketDataError("Bybit returned no ticker rows")
        ticker = next((row for row in rows if row.get("symbol") == normalized_symbol), rows[0])
        price = float(ticker["lastPrice"])
        if price <= 0:
            raise MarketDataError("Bybit returned invalid ticker price")
        return str(ticker.get("symbol", normalized_symbol)), price


def normalize_market_error(error: Exception) -> Exception:
    if isinstance(error, BinanceAPIError):
        return MarketDataError(str(error))
    return error
