from __future__ import annotations

import asyncio
import json
import os
import random
import re
from collections.abc import AsyncIterator
from typing import Any

import httpx
import websockets

from services.schemas import Candle, LivePrice, Price, Ticker24h


class BinanceAPIError(RuntimeError):
    pass


VALID_INTERVALS = {
    "1s",
    "1m",
    "3m",
    "5m",
    "15m",
    "30m",
    "1h",
    "2h",
    "4h",
    "6h",
    "8h",
    "12h",
    "1d",
    "3d",
    "1w",
    "1M",
}


SYMBOL_PATTERN = re.compile(r"^[A-Z0-9]{5,20}$")


def normalize_symbol(symbol: str) -> str:
    normalized = symbol.upper().strip()
    if not SYMBOL_PATTERN.fullmatch(normalized):
        raise BinanceAPIError("invalid symbol")
    return normalized


def normalize_interval(interval: str) -> str:
    if interval not in VALID_INTERVALS:
        raise BinanceAPIError("invalid interval")
    return interval


class BinanceClient:
    def __init__(self) -> None:
        self.rest_base_url = os.getenv("BINANCE_REST_BASE_URL", "https://api.binance.com")
        self.ws_base_url = os.getenv("BINANCE_WS_BASE_URL", "wss://stream.binance.com:9443/ws")
        self.timeout = float(os.getenv("BINANCE_TIMEOUT_SECONDS", "10"))
        self.max_attempts = int(os.getenv("BINANCE_RETRY_ATTEMPTS", "4"))
        self.backoff_base = float(os.getenv("BINANCE_BACKOFF_BASE_SECONDS", "0.4"))

    async def _request_json(self, path: str, params: dict[str, Any] | None = None) -> Any:
        last_error: Exception | None = None

        for attempt in range(self.max_attempts):
            try:
                async with httpx.AsyncClient(base_url=self.rest_base_url, timeout=self.timeout) as client:
                    response = await client.get(path, params=params)
                    response.raise_for_status()
                    return response.json()
            except (httpx.HTTPError, json.JSONDecodeError) as error:
                last_error = error
                if attempt == self.max_attempts - 1:
                    break
                delay = self.backoff_base * (2**attempt) + random.uniform(0, 0.2)
                await asyncio.sleep(delay)

        raise BinanceAPIError(f"Binance REST request failed: {last_error}") from last_error

    async def ping(self) -> bool:
        try:
            await self._request_json("/api/v3/ping")
            return True
        except BinanceAPIError:
            return False

    async def get_price(self, symbol: str) -> Price:
        normalized_symbol = normalize_symbol(symbol)
        payload = await self._request_json("/api/v3/ticker/price", {"symbol": normalized_symbol})
        return Price(symbol=payload["symbol"], price=float(payload["price"]))

    async def get_24h_ticker(self, symbol: str) -> Ticker24h:
        normalized_symbol = normalize_symbol(symbol)
        payload = await self._request_json("/api/v3/ticker/24hr", {"symbol": normalized_symbol})
        return Ticker24h(
            symbol=payload["symbol"],
            price_change_percent=float(payload["priceChangePercent"]),
            last_price=float(payload["lastPrice"]),
            quote_volume=float(payload["quoteVolume"]),
            volume=float(payload["volume"]),
        )

    async def get_candles(self, symbol: str, interval: str = "1s", limit: int = 300) -> list[Candle]:
        normalized_symbol = normalize_symbol(symbol)
        normalized_interval = normalize_interval(interval)
        safe_limit = max(1, min(limit, 1000))
        payload = await self._request_json(
            "/api/v3/klines",
            {
                "symbol": normalized_symbol,
                "interval": normalized_interval,
                "limit": safe_limit,
            },
        )
        return [self._normalize_rest_kline(item) for item in payload]

    async def stream_candles(self, symbol: str, interval: str = "1s") -> AsyncIterator[Candle]:
        normalized_symbol = normalize_symbol(symbol)
        normalized_interval = normalize_interval(interval)
        stream_name = f"{normalized_symbol.lower()}@kline_{normalized_interval}"
        url = f"{self.ws_base_url}/{stream_name}"

        async with websockets.connect(
            url,
            ping_interval=20,
            ping_timeout=20,
            close_timeout=5,
            max_queue=32,
        ) as upstream:
            async for raw_message in upstream:
                payload = json.loads(raw_message)
                candle = self._normalize_ws_kline(payload)
                if candle is not None:
                    yield candle

    async def stream_prices(self, symbol: str) -> AsyncIterator[LivePrice]:
        normalized_symbol = normalize_symbol(symbol)
        stream_name = f"{normalized_symbol.lower()}@trade"
        url = f"{self.ws_base_url}/{stream_name}"

        async with websockets.connect(
            url,
            ping_interval=20,
            ping_timeout=20,
            close_timeout=5,
            max_queue=128,
        ) as upstream:
            async for raw_message in upstream:
                payload = json.loads(raw_message)
                price = self._normalize_ws_trade(payload)
                if price is not None:
                    yield price

    def _normalize_rest_kline(self, item: list[Any]) -> Candle:
        return Candle(
            timestamp=int(item[0]),
            open=float(item[1]),
            high=float(item[2]),
            low=float(item[3]),
            close=float(item[4]),
            volume=float(item[5]),
        )

    def _normalize_ws_kline(self, payload: dict[str, Any]) -> Candle | None:
        kline = payload.get("k")
        if not isinstance(kline, dict):
            return None
        return Candle(
            timestamp=int(kline["t"]),
            open=float(kline["o"]),
            high=float(kline["h"]),
            low=float(kline["l"]),
            close=float(kline["c"]),
            volume=float(kline["v"]),
        )

    def _normalize_ws_trade(self, payload: dict[str, Any]) -> LivePrice | None:
        symbol = payload.get("s")
        price = payload.get("p")
        timestamp = payload.get("T")
        if symbol is None or price is None or timestamp is None:
            return None
        return LivePrice(symbol=str(symbol), price=float(price), timestamp=int(timestamp))
