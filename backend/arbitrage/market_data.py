from __future__ import annotations

import asyncio
import json
import math
import os
import statistics
import time
from datetime import UTC, datetime
from typing import Any

import httpx
import websockets

from arbitrage.schemas import ExchangeName, OrderBookLevel, OrderBookSnapshot
from services.binance import normalize_symbol


class ArbitrageDataError(RuntimeError):
    pass


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _epoch_ms() -> int:
    return int(time.time() * 1000)


def _levels(rows: list[list[str]], *, reverse: bool, limit: int) -> list[OrderBookLevel]:
    levels = [OrderBookLevel(price=float(price), quantity=float(quantity)) for price, quantity in rows if float(quantity) > 0]
    return sorted(levels, key=lambda level: level.price, reverse=reverse)[:limit]


def _volatility_bps(mid_prices: list[float]) -> float | None:
    clean = [price for price in mid_prices if price > 0]
    if len(clean) < 3:
        return None
    returns = [math.log(clean[index] / clean[index - 1]) for index in range(1, len(clean)) if clean[index - 1] > 0]
    if len(returns) < 2:
        return None
    return statistics.pstdev(returns) * 10_000.0


class _MutableOrderBook:
    def __init__(self) -> None:
        self.bids: dict[float, float] = {}
        self.asks: dict[float, float] = {}

    def reset(self, bids: list[list[str]], asks: list[list[str]]) -> None:
        self.bids = self._side_to_map(bids)
        self.asks = self._side_to_map(asks)

    def apply_delta(self, bids: list[list[str]], asks: list[list[str]]) -> None:
        self._apply_side(self.bids, bids)
        self._apply_side(self.asks, asks)

    def bid_levels(self, limit: int) -> list[OrderBookLevel]:
        return [OrderBookLevel(price=price, quantity=quantity) for price, quantity in sorted(self.bids.items(), reverse=True)[:limit]]

    def ask_levels(self, limit: int) -> list[OrderBookLevel]:
        return [OrderBookLevel(price=price, quantity=quantity) for price, quantity in sorted(self.asks.items())[:limit]]

    def _side_to_map(self, rows: list[list[str]]) -> dict[float, float]:
        result: dict[float, float] = {}
        for price, quantity in rows:
            numeric_price = float(price)
            numeric_quantity = float(quantity)
            if numeric_quantity > 0:
                result[numeric_price] = numeric_quantity
        return result

    def _apply_side(self, side: dict[float, float], rows: list[list[str]]) -> None:
        for price, quantity in rows:
            numeric_price = float(price)
            numeric_quantity = float(quantity)
            if numeric_quantity <= 0:
                side.pop(numeric_price, None)
            else:
                side[numeric_price] = numeric_quantity


class ArbitrageMarketDataClient:
    def __init__(self) -> None:
        self.binance_rest_base_url = os.getenv("BINANCE_REST_BASE_URL", "https://api.binance.com")
        self.binance_ws_base_url = os.getenv("BINANCE_WS_BASE_URL", "wss://stream.binance.com:9443/ws")
        self.bybit_rest_base_url = os.getenv("BYBIT_MARKET_BASE_URL", "https://api.bybit.com")
        self.bybit_ws_url = os.getenv("BYBIT_PUBLIC_WS_URL", "wss://stream.bybit.com/v5/public/spot")
        self.http_timeout = float(os.getenv("ARBITRAGE_HTTP_TIMEOUT_SECONDS", "10"))

    async def collect_orderbooks(
        self,
        *,
        symbols: list[str],
        binance_depth: int,
        bybit_depth: int,
        sample_seconds: float,
        timeout_seconds: float,
        allow_rest_fallback: bool,
    ) -> dict[tuple[ExchangeName, str], OrderBookSnapshot]:
        tasks = []
        for symbol in symbols:
            normalized_symbol = normalize_symbol(symbol)
            tasks.append(
                self.collect_binance_orderbook(
                    normalized_symbol,
                    depth=binance_depth,
                    sample_seconds=sample_seconds,
                    timeout_seconds=timeout_seconds,
                    allow_rest_fallback=allow_rest_fallback,
                )
            )
            tasks.append(
                self.collect_bybit_orderbook(
                    normalized_symbol,
                    depth=bybit_depth,
                    sample_seconds=sample_seconds,
                    timeout_seconds=timeout_seconds,
                    allow_rest_fallback=allow_rest_fallback,
                )
            )
        snapshots = await asyncio.gather(*tasks)
        return {(snapshot.exchange, snapshot.symbol): snapshot for snapshot in snapshots}

    async def collect_binance_orderbook(
        self,
        symbol: str,
        *,
        depth: int,
        sample_seconds: float,
        timeout_seconds: float,
        allow_rest_fallback: bool,
    ) -> OrderBookSnapshot:
        try:
            return await self._collect_binance_ws(
                symbol,
                depth=depth,
                sample_seconds=sample_seconds,
                first_message_timeout=timeout_seconds,
            )
        except Exception as error:
            if not allow_rest_fallback:
                raise ArbitrageDataError(f"Binance WebSocket orderbook failed for {symbol}: {error}") from error
            return await self.fetch_binance_orderbook(symbol, depth=depth, source_suffix="after_ws_error")

    async def collect_bybit_orderbook(
        self,
        symbol: str,
        *,
        depth: int,
        sample_seconds: float,
        timeout_seconds: float,
        allow_rest_fallback: bool,
    ) -> OrderBookSnapshot:
        try:
            return await self._collect_bybit_ws(
                symbol,
                depth=depth,
                sample_seconds=sample_seconds,
                first_message_timeout=timeout_seconds,
            )
        except Exception as error:
            if not allow_rest_fallback:
                raise ArbitrageDataError(f"Bybit WebSocket orderbook failed for {symbol}: {error}") from error
            return await self.fetch_bybit_orderbook(symbol, depth=depth, source_suffix="after_ws_error")

    async def _collect_binance_ws(
        self,
        symbol: str,
        *,
        depth: int,
        sample_seconds: float,
        first_message_timeout: float,
    ) -> OrderBookSnapshot:
        stream_name = f"{symbol.lower()}@depth{depth}@100ms"
        url = f"{self.binance_ws_base_url}/{stream_name}"
        deadline: float | None = None
        latest: OrderBookSnapshot | None = None
        mid_prices: list[float] = []

        async with websockets.connect(
            url,
            ping_interval=20,
            ping_timeout=20,
            close_timeout=1,
            open_timeout=first_message_timeout,
            max_queue=64,
        ) as upstream:
            while deadline is None or time.perf_counter() < deadline:
                started_at = time.perf_counter()
                remaining = first_message_timeout if deadline is None else max(0.1, deadline - time.perf_counter())
                message_timeout = remaining if deadline is None else min(1.0, remaining)
                try:
                    raw_message = await asyncio.wait_for(upstream.recv(), timeout=message_timeout)
                except TimeoutError:
                    if latest is not None:
                        break
                    raise
                received_at = _utc_now()
                payload = json.loads(raw_message)
                bids = _levels(payload.get("bids", []), reverse=True, limit=depth)
                asks = _levels(payload.get("asks", []), reverse=False, limit=depth)
                if not bids or not asks:
                    continue
                latest = OrderBookSnapshot(
                    exchange="binance",
                    symbol=symbol,
                    bids=bids,
                    asks=asks,
                    source=f"binance_ws_depth{depth}_100ms",
                    update_id=int(payload["lastUpdateId"]) if payload.get("lastUpdateId") is not None else None,
                    exchange_timestamp_ms=None,
                    received_at=received_at,
                    latency_ms=(time.perf_counter() - started_at) * 1000.0,
                )
                if deadline is None:
                    deadline = time.perf_counter() + sample_seconds
                mid_prices.append(latest.mid_price)

        if latest is None:
            raise ArbitrageDataError(f"Binance WebSocket returned no orderbook data for {symbol}")
        latest.mid_price_series = mid_prices
        latest.sample_count = len(mid_prices)
        latest.volatility_bps = _volatility_bps(mid_prices)
        return latest

    async def _collect_bybit_ws(
        self,
        symbol: str,
        *,
        depth: int,
        sample_seconds: float,
        first_message_timeout: float,
    ) -> OrderBookSnapshot:
        deadline: float | None = None
        topic = f"orderbook.{depth}.{symbol}"
        orderbook = _MutableOrderBook()
        latest: OrderBookSnapshot | None = None
        mid_prices: list[float] = []

        async with websockets.connect(
            self.bybit_ws_url,
            ping_interval=20,
            ping_timeout=20,
            close_timeout=1,
            open_timeout=first_message_timeout,
            max_queue=128,
        ) as upstream:
            await upstream.send(json.dumps({"op": "subscribe", "args": [topic]}))
            while deadline is None or time.perf_counter() < deadline:
                remaining = first_message_timeout if deadline is None else max(0.1, deadline - time.perf_counter())
                message_timeout = remaining if deadline is None else min(1.0, remaining)
                try:
                    raw_message = await asyncio.wait_for(upstream.recv(), timeout=message_timeout)
                except TimeoutError:
                    if latest is not None:
                        break
                    raise
                received_at = _utc_now()
                received_ms = _epoch_ms()
                payload = json.loads(raw_message)
                if payload.get("topic") != topic:
                    continue

                data: dict[str, Any] = payload.get("data", {})
                bids_raw = data.get("b", [])
                asks_raw = data.get("a", [])
                if payload.get("type") == "snapshot" or data.get("u") == 1:
                    orderbook.reset(bids_raw, asks_raw)
                else:
                    orderbook.apply_delta(bids_raw, asks_raw)

                bids = orderbook.bid_levels(depth)
                asks = orderbook.ask_levels(depth)
                if not bids or not asks:
                    continue
                exchange_timestamp_ms = int(payload.get("cts") or payload.get("ts") or data.get("cts") or data.get("ts") or received_ms)
                latest = OrderBookSnapshot(
                    exchange="bybit",
                    symbol=symbol,
                    bids=bids,
                    asks=asks,
                    source=f"bybit_ws_orderbook_{depth}",
                    update_id=int(data["u"]) if data.get("u") is not None else None,
                    exchange_timestamp_ms=exchange_timestamp_ms,
                    received_at=received_at,
                    latency_ms=max(0.0, received_ms - exchange_timestamp_ms),
                )
                if deadline is None:
                    deadline = time.perf_counter() + sample_seconds
                mid_prices.append(latest.mid_price)

        if latest is None:
            raise ArbitrageDataError(f"Bybit WebSocket returned no orderbook data for {symbol}")
        latest.mid_price_series = mid_prices
        latest.sample_count = len(mid_prices)
        latest.volatility_bps = _volatility_bps(mid_prices)
        return latest

    async def fetch_binance_orderbook(self, symbol: str, *, depth: int, source_suffix: str = "snapshot") -> OrderBookSnapshot:
        started_at = time.perf_counter()
        async with httpx.AsyncClient(base_url=self.binance_rest_base_url, timeout=self.http_timeout) as client:
            response = await client.get("/api/v3/depth", params={"symbol": normalize_symbol(symbol), "limit": min(depth, 5000)})
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as error:
                raise ArbitrageDataError(f"Binance depth request failed for {symbol}: {response.text}") from error
            payload: dict[str, Any] = response.json()
        bids = _levels(payload.get("bids", []), reverse=True, limit=depth)
        asks = _levels(payload.get("asks", []), reverse=False, limit=depth)
        if not bids or not asks:
            raise ArbitrageDataError(f"Binance depth response has empty book for {symbol}")
        snapshot = OrderBookSnapshot(
            exchange="binance",
            symbol=normalize_symbol(symbol),
            bids=bids,
            asks=asks,
            source=f"binance_rest_depth_{source_suffix}",
            update_id=int(payload["lastUpdateId"]) if payload.get("lastUpdateId") is not None else None,
            received_at=_utc_now(),
            latency_ms=(time.perf_counter() - started_at) * 1000.0,
            sample_count=1,
            volatility_bps=None,
        )
        snapshot.mid_price_series = [snapshot.mid_price]
        return snapshot

    async def fetch_bybit_orderbook(self, symbol: str, *, depth: int, source_suffix: str = "snapshot") -> OrderBookSnapshot:
        started_at = time.perf_counter()
        async with httpx.AsyncClient(base_url=self.bybit_rest_base_url, timeout=self.http_timeout) as client:
            response = await client.get(
                "/v5/market/orderbook",
                params={"category": "spot", "symbol": normalize_symbol(symbol), "limit": min(depth, 1000)},
            )
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as error:
                raise ArbitrageDataError(f"Bybit orderbook request failed for {symbol}: {response.text}") from error
            payload: dict[str, Any] = response.json()
        if int(payload.get("retCode", -1)) != 0:
            raise ArbitrageDataError(f"Bybit orderbook rejected for {symbol}: {payload.get('retMsg')}")
        result: dict[str, Any] = payload.get("result", {})
        bids = _levels(result.get("b", []), reverse=True, limit=depth)
        asks = _levels(result.get("a", []), reverse=False, limit=depth)
        if not bids or not asks:
            raise ArbitrageDataError(f"Bybit orderbook response has empty book for {symbol}")
        received_ms = _epoch_ms()
        exchange_timestamp_ms = int(result.get("cts") or result.get("ts") or payload.get("time") or received_ms)
        snapshot = OrderBookSnapshot(
            exchange="bybit",
            symbol=str(result.get("s") or normalize_symbol(symbol)),
            bids=bids,
            asks=asks,
            source=f"bybit_rest_orderbook_{source_suffix}",
            update_id=int(result["u"]) if result.get("u") is not None else None,
            exchange_timestamp_ms=exchange_timestamp_ms,
            received_at=_utc_now(),
            latency_ms=max((time.perf_counter() - started_at) * 1000.0, float(received_ms - exchange_timestamp_ms)),
            sample_count=1,
            volatility_bps=None,
        )
        snapshot.mid_price_series = [snapshot.mid_price]
        return snapshot
