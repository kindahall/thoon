from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import random
import time
from typing import Any
from urllib.parse import urlencode

import httpx

from services.binance import normalize_symbol

from execution.binance_connector import ExchangeAPIError


class BitgetExecutionConnector:
    def __init__(self) -> None:
        self.base_url = os.getenv("BITGET_TRADE_BASE_URL", "https://api.bitget.com")
        self.api_key = os.getenv("BITGET_API_KEY")
        self.api_secret = os.getenv("BITGET_API_SECRET")
        self.api_passphrase = os.getenv("BITGET_API_PASSPHRASE")
        self.recv_window = os.getenv("BITGET_RECV_WINDOW_MS", "5000")
        self.timeout = float(os.getenv("EXECUTION_HTTP_TIMEOUT_SECONDS", "10"))
        self.max_attempts = int(os.getenv("EXECUTION_RETRY_ATTEMPTS", "3"))
        self.backoff_base = float(os.getenv("EXECUTION_BACKOFF_BASE_SECONDS", "0.25"))
        self.min_interval_seconds = float(os.getenv("BITGET_EXECUTION_MIN_INTERVAL_SECONDS", "0.12"))
        self._rate_lock = asyncio.Lock()
        self._last_request_at = 0.0

    def has_credentials(self) -> bool:
        return bool(self.api_key and self.api_secret and self.api_passphrase)

    async def get_market_price(self, symbol: str, category: str | None = None) -> float:
        self._ensure_spot(category)
        payload = await self._request(
            "GET",
            "/api/v2/spot/market/tickers",
            params={"symbol": normalize_symbol(symbol)},
            signed=False,
        )
        rows = payload.get("data", [])
        if not rows:
            raise ExchangeAPIError("Bitget ticker response did not include symbol")
        return float(rows[0]["lastPr"])

    async def place_order(
        self,
        *,
        symbol: str,
        side: str,
        order_type: str,
        quantity: float,
        price: float | None,
        client_order_id: str | None,
        reduce_only: bool = False,
        category: str | None = None,
    ) -> dict[str, Any]:
        self._ensure_spot(category)
        normalized_symbol = normalize_symbol(symbol)
        normalized_order_type = "market" if order_type.upper() == "MARKET" else "limit"
        normalized_side = side.lower().strip()
        size = quantity
        if normalized_order_type == "market" and normalized_side == "buy":
            market_price = await self.get_market_price(normalized_symbol, category)
            size = quantity * market_price

        params: dict[str, Any] = {
            "symbol": normalized_symbol,
            "side": normalized_side,
            "orderType": normalized_order_type,
            "size": self._format_number(size),
            "requestTime": str(int(time.time() * 1000)),
            "receiveWindow": self.recv_window,
        }
        if client_order_id:
            params["clientOid"] = client_order_id[:64]
        if normalized_order_type == "limit":
            if price is None or price <= 0:
                raise ExchangeAPIError("price is required for Bitget LIMIT orders")
            params["price"] = self._format_number(price)
            params["force"] = "gtc"
        return await self._request("POST", "/api/v2/spot/trade/place-order", params=params, signed=True)

    async def cancel_order(
        self,
        *,
        symbol: str,
        order_id: str | None = None,
        client_order_id: str | None = None,
        category: str | None = None,
    ) -> dict[str, Any]:
        self._ensure_spot(category)
        params: dict[str, Any] = {"symbol": normalize_symbol(symbol)}
        if order_id:
            params["orderId"] = order_id
        if client_order_id:
            params["clientOid"] = client_order_id[:64]
        if not order_id and not client_order_id:
            raise ExchangeAPIError("order_id or client_order_id is required")
        return await self._request("POST", "/api/v2/spot/trade/cancel-order", params=params, signed=True)

    async def get_open_positions(self, *, symbol: str | None = None, category: str | None = None) -> list[dict[str, Any]]:
        self._ensure_spot(category)
        coin = self._asset_from_spot_symbol(symbol) if symbol else None
        params = {"assetType": "hold_only"}
        if coin:
            params["coin"] = coin
        payload = await self._request("GET", "/api/v2/spot/account/assets", params=params, signed=True)
        positions: list[dict[str, Any]] = []
        for row in payload.get("data", []):
            available = float(row.get("available", 0.0))
            frozen = float(row.get("frozen", 0.0))
            locked = float(row.get("locked", 0.0))
            quantity = available + frozen + locked
            if quantity <= 0:
                continue
            positions.append(
                {
                    "exchange": "bitget",
                    "mode": "live",
                    "symbol": str(row.get("coin", "")).upper(),
                    "quantity": quantity,
                    "market_price": None,
                    "notional": None,
                    "source": "bitget_spot_account_assets",
                    "raw": row,
                }
            )
        return positions

    async def get_account_permissions(self) -> dict[str, Any]:
        payload = await self._request("GET", "/api/v2/spot/account/info", params={}, signed=True)
        data = payload.get("data", {})
        authorities = data.get("authorities", []) or []
        return {
            "exchange": "bitget",
            "can_trade": any(str(item).lower() in {"stow", "spot_trade", "uta_trade"} for item in authorities),
            "can_withdraw": any(str(item).lower() in {"wwow", "withdraw"} for item in authorities),
            "permissions": authorities,
            "ips": data.get("ips"),
            "source": "bitget:/api/v2/spot/account/info",
        }

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any],
        signed: bool,
    ) -> Any:
        if signed and not self.has_credentials():
            raise ExchangeAPIError("Bitget API credentials are required for live trading")

        last_error: Exception | None = None
        for attempt in range(self.max_attempts):
            try:
                await self._rate_limit()
                headers = {"Content-Type": "application/json", "locale": "en-US"}
                request_params = dict(params)
                query = ""
                body = ""
                request_path = path
                if method.upper() == "GET" and request_params:
                    query = urlencode(sorted(request_params.items()))
                    request_path = f"{path}?{query}"
                if method.upper() != "GET":
                    body = json.dumps(request_params, separators=(",", ":"), ensure_ascii=False)

                if signed:
                    timestamp = str(int(time.time() * 1000))
                    prehash = f"{timestamp}{method.upper()}{request_path}{body}"
                    digest = hmac.new((self.api_secret or "").encode(), prehash.encode(), hashlib.sha256).digest()
                    headers.update(
                        {
                            "ACCESS-KEY": self.api_key or "",
                            "ACCESS-SIGN": base64.b64encode(digest).decode(),
                            "ACCESS-TIMESTAMP": timestamp,
                            "ACCESS-PASSPHRASE": self.api_passphrase or "",
                        }
                    )

                async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout) as client:
                    if method.upper() == "GET":
                        response = await client.get(path, params=request_params, headers=headers)
                    else:
                        response = await client.request(method, path, content=body.encode("utf-8"), headers=headers)
                    if response.status_code == 429:
                        raise ExchangeAPIError(f"Bitget rate limit response: {response.status_code} {response.text}")
                    response.raise_for_status()
                    payload = response.json() if response.content else {}
                    if payload.get("code", "00000") != "00000":
                        raise ExchangeAPIError(f"Bitget error {payload.get('code')}: {payload.get('msg')}")
                    return payload
            except (httpx.HTTPError, json.JSONDecodeError, ExchangeAPIError) as error:
                last_error = error
                if attempt == self.max_attempts - 1:
                    break
                await asyncio.sleep(self.backoff_base * (2**attempt) + random.uniform(0, 0.15))
        raise ExchangeAPIError(f"Bitget execution request failed: {last_error}") from last_error

    async def _rate_limit(self) -> None:
        async with self._rate_lock:
            elapsed = time.perf_counter() - self._last_request_at
            if elapsed < self.min_interval_seconds:
                await asyncio.sleep(self.min_interval_seconds - elapsed)
            self._last_request_at = time.perf_counter()

    def _ensure_spot(self, category: str | None) -> None:
        if category and category != "spot":
            raise ExchangeAPIError("Bitget connector currently supports spot execution only")

    def _asset_from_spot_symbol(self, symbol: str | None) -> str | None:
        if not symbol:
            return None
        normalized = normalize_symbol(symbol)
        if normalized.endswith("USDT"):
            return normalized[:-4]
        if normalized.endswith("USDC"):
            return normalized[:-4]
        return normalized

    def _format_number(self, value: float) -> str:
        return format(value, ".12f").rstrip("0").rstrip(".")
