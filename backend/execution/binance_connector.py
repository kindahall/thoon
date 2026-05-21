from __future__ import annotations

import asyncio
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


class ExchangeAPIError(RuntimeError):
    pass


class BinanceExecutionConnector:
    def __init__(self) -> None:
        self.base_url = os.getenv("BINANCE_TRADE_BASE_URL", os.getenv("BINANCE_REST_BASE_URL", "https://api.binance.com"))
        self.api_key = os.getenv("BINANCE_API_KEY")
        self.api_secret = os.getenv("BINANCE_API_SECRET")
        self.recv_window = int(os.getenv("BINANCE_RECV_WINDOW_MS", "5000"))
        self.timeout = float(os.getenv("EXECUTION_HTTP_TIMEOUT_SECONDS", "10"))
        self.max_attempts = int(os.getenv("EXECUTION_RETRY_ATTEMPTS", "3"))
        self.backoff_base = float(os.getenv("EXECUTION_BACKOFF_BASE_SECONDS", "0.25"))
        self.min_interval_seconds = float(os.getenv("BINANCE_EXECUTION_MIN_INTERVAL_SECONDS", "0.12"))
        self._rate_lock = asyncio.Lock()
        self._last_request_at = 0.0

    def has_credentials(self) -> bool:
        return bool(self.api_key and self.api_secret)

    async def get_market_price(self, symbol: str, category: str | None = None) -> float:
        normalized_symbol = normalize_symbol(symbol)
        payload = await self._request("GET", "/api/v3/ticker/price", params={"symbol": normalized_symbol}, signed=False)
        return float(payload["price"])

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
        params: dict[str, Any] = {
            "symbol": normalize_symbol(symbol),
            "side": side.upper(),
            "type": order_type.upper(),
            "quantity": self._format_number(quantity),
            "newOrderRespType": "FULL",
        }
        if client_order_id:
            params["newClientOrderId"] = client_order_id
        if order_type.upper() == "LIMIT":
            if price is None or price <= 0:
                raise ExchangeAPIError("price is required for Binance LIMIT orders")
            params["price"] = self._format_number(price)
            params["timeInForce"] = "GTC"
        return await self._request("POST", "/api/v3/order", params=params, signed=True)

    async def cancel_order(
        self,
        *,
        symbol: str,
        order_id: str | None = None,
        client_order_id: str | None = None,
        category: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"symbol": normalize_symbol(symbol)}
        if order_id:
            params["orderId"] = order_id
        if client_order_id:
            params["origClientOrderId"] = client_order_id
        if not order_id and not client_order_id:
            raise ExchangeAPIError("order_id or client_order_id is required")
        return await self._request("DELETE", "/api/v3/order", params=params, signed=True)

    async def get_open_positions(self, *, symbol: str | None = None, category: str | None = None) -> list[dict[str, Any]]:
        account = await self._request("GET", "/api/v3/account", params={}, signed=True)
        balances = account.get("balances", [])
        positions: list[dict[str, Any]] = []
        for balance in balances:
            free = float(balance.get("free", 0.0))
            locked = float(balance.get("locked", 0.0))
            quantity = free + locked
            if quantity <= 0:
                continue
            asset = str(balance["asset"])
            positions.append(
                {
                    "exchange": "binance",
                    "mode": "live",
                    "symbol": asset,
                    "quantity": quantity,
                    "market_price": None,
                    "notional": None,
                    "source": "binance_account_balance",
                    "raw": balance,
                }
            )
        return positions

    async def get_account_permissions(self) -> dict[str, Any]:
        account = await self._request("GET", "/api/v3/account", params={}, signed=True)
        return {
            "exchange": "binance",
            "can_trade": bool(account.get("canTrade")),
            "can_withdraw": bool(account.get("canWithdraw")),
            "can_deposit": bool(account.get("canDeposit")),
            "permissions": account.get("permissions", []),
            "source": "binance:/api/v3/account",
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
            raise ExchangeAPIError("Binance API credentials are required for live trading")

        last_error: Exception | None = None
        for attempt in range(self.max_attempts):
            try:
                await self._rate_limit()
                request_params = dict(params)
                headers: dict[str, str] = {}
                if signed:
                    request_params["timestamp"] = int(time.time() * 1000)
                    request_params["recvWindow"] = self.recv_window
                    query = urlencode(request_params, doseq=True)
                    signature = hmac.new(self.api_secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256).hexdigest()
                    request_params["signature"] = signature
                    headers["X-MBX-APIKEY"] = self.api_key or ""

                async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout) as client:
                    response = await client.request(method, path, params=request_params, headers=headers)
                    if response.status_code in (418, 429):
                        raise ExchangeAPIError(f"Binance rate limit response: {response.status_code} {response.text}")
                    response.raise_for_status()
                    return response.json() if response.content else {}
            except (httpx.HTTPError, json.JSONDecodeError, ExchangeAPIError) as error:
                last_error = error
                if attempt == self.max_attempts - 1:
                    break
                await asyncio.sleep(self.backoff_base * (2**attempt) + random.uniform(0, 0.15))
        raise ExchangeAPIError(f"Binance execution request failed: {last_error}") from last_error

    async def _rate_limit(self) -> None:
        async with self._rate_lock:
            elapsed = time.perf_counter() - self._last_request_at
            if elapsed < self.min_interval_seconds:
                await asyncio.sleep(self.min_interval_seconds - elapsed)
            self._last_request_at = time.perf_counter()

    def _format_number(self, value: float) -> str:
        return format(value, ".12f").rstrip("0").rstrip(".")
