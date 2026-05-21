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

from execution.binance_connector import ExchangeAPIError


class BybitExecutionConnector:
    def __init__(self) -> None:
        self.base_url = os.getenv("BYBIT_TRADE_BASE_URL", "https://api.bybit.com")
        self.api_key = os.getenv("BYBIT_API_KEY")
        self.api_secret = os.getenv("BYBIT_API_SECRET")
        self.recv_window = os.getenv("BYBIT_RECV_WINDOW_MS", "5000")
        self.timeout = float(os.getenv("EXECUTION_HTTP_TIMEOUT_SECONDS", "10"))
        self.max_attempts = int(os.getenv("EXECUTION_RETRY_ATTEMPTS", "3"))
        self.backoff_base = float(os.getenv("EXECUTION_BACKOFF_BASE_SECONDS", "0.25"))
        self.min_interval_seconds = float(os.getenv("BYBIT_EXECUTION_MIN_INTERVAL_SECONDS", "0.12"))
        self._rate_lock = asyncio.Lock()
        self._last_request_at = 0.0

    def has_credentials(self) -> bool:
        return bool(self.api_key and self.api_secret)

    async def get_market_price(self, symbol: str, category: str | None = None) -> float:
        normalized_symbol = normalize_symbol(symbol)
        selected_category = category or "spot"
        payload = await self._request(
            "GET",
            "/v5/market/tickers",
            params={"category": selected_category, "symbol": normalized_symbol},
            signed=False,
        )
        rows = payload.get("result", {}).get("list", [])
        if not rows:
            raise ExchangeAPIError("Bybit ticker response did not include symbol")
        return float(rows[0]["lastPrice"])

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
        selected_category = category or "spot"
        params: dict[str, Any] = {
            "category": selected_category,
            "symbol": normalize_symbol(symbol),
            "side": "Buy" if side.lower() == "buy" else "Sell",
            "orderType": "Market" if order_type.upper() == "MARKET" else "Limit",
            "qty": self._format_number(quantity),
        }
        if client_order_id:
            params["orderLinkId"] = client_order_id[:36]
        if reduce_only and selected_category != "spot":
            params["reduceOnly"] = True
        if order_type.upper() == "LIMIT":
            if price is None or price <= 0:
                raise ExchangeAPIError("price is required for Bybit LIMIT orders")
            params["price"] = self._format_number(price)
            params["timeInForce"] = "GTC"
        if selected_category == "spot" and order_type.upper() == "MARKET":
            params["marketUnit"] = "baseCoin"
        return await self._request("POST", "/v5/order/create", params=params, signed=True)

    async def cancel_order(
        self,
        *,
        symbol: str,
        order_id: str | None = None,
        client_order_id: str | None = None,
        category: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "category": category or "spot",
            "symbol": normalize_symbol(symbol),
        }
        if order_id:
            params["orderId"] = order_id
        if client_order_id:
            params["orderLinkId"] = client_order_id[:36]
        if not order_id and not client_order_id:
            raise ExchangeAPIError("order_id or client_order_id is required")
        return await self._request("POST", "/v5/order/cancel", params=params, signed=True)

    async def get_open_positions(self, *, symbol: str | None = None, category: str | None = None) -> list[dict[str, Any]]:
        selected_category = category or "spot"
        if selected_category == "spot":
            payload = await self._request("GET", "/v5/account/wallet-balance", params={"accountType": "UNIFIED"}, signed=True)
            accounts = payload.get("result", {}).get("list", [])
            positions: list[dict[str, Any]] = []
            for account in accounts:
                for coin in account.get("coin", []):
                    quantity = float(coin.get("walletBalance", 0.0))
                    if quantity <= 0:
                        continue
                    positions.append(
                        {
                            "exchange": "bybit",
                            "mode": "live",
                            "symbol": coin.get("coin"),
                            "quantity": quantity,
                            "market_price": None,
                            "notional": float(coin.get("usdValue", 0.0)) if coin.get("usdValue") is not None else None,
                            "source": "bybit_wallet_balance",
                            "raw": coin,
                        }
                    )
            return positions

        params = {"category": selected_category}
        if symbol:
            params["symbol"] = normalize_symbol(symbol)
        payload = await self._request("GET", "/v5/position/list", params=params, signed=True)
        positions = []
        for row in payload.get("result", {}).get("list", []):
            size = float(row.get("size", 0.0))
            if size <= 0:
                continue
            positions.append(
                {
                    "exchange": "bybit",
                    "mode": "live",
                    "symbol": row.get("symbol"),
                    "quantity": size,
                    "market_price": float(row["markPrice"]) if row.get("markPrice") else None,
                    "notional": float(row["positionValue"]) if row.get("positionValue") else None,
                    "source": "bybit_position_list",
                    "raw": row,
                }
            )
        return positions

    async def get_account_permissions(self) -> dict[str, Any]:
        payload = await self._request("GET", "/v5/user/query-api", params={}, signed=True)
        result = payload.get("result", {})
        permissions = result.get("permissions", {})
        return {
            "exchange": "bybit",
            "can_trade": not bool(result.get("readOnly")),
            "can_withdraw": self._permission_mentions(permissions, "withdraw"),
            "read_only": bool(result.get("readOnly")),
            "permissions": permissions,
            "ips": result.get("ips", []),
            "source": "bybit:/v5/user/query-api",
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
            raise ExchangeAPIError("Bybit API credentials are required for live trading")

        last_error: Exception | None = None
        for attempt in range(self.max_attempts):
            try:
                await self._rate_limit()
                headers = {"Content-Type": "application/json"}
                request_params = dict(params)
                body = ""
                query = ""

                if method.upper() == "GET":
                    query = urlencode(sorted(request_params.items()))
                else:
                    body = json.dumps(request_params, separators=(",", ":"), ensure_ascii=False)

                if signed:
                    timestamp = str(int(time.time() * 1000))
                    payload = timestamp + (self.api_key or "") + self.recv_window + (query if method.upper() == "GET" else body)
                    signature = hmac.new((self.api_secret or "").encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
                    headers.update(
                        {
                            "X-BAPI-API-KEY": self.api_key or "",
                            "X-BAPI-TIMESTAMP": timestamp,
                            "X-BAPI-RECV-WINDOW": self.recv_window,
                            "X-BAPI-SIGN": signature,
                        }
                    )

                async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout) as client:
                    if method.upper() == "GET":
                        response = await client.get(path, params=request_params, headers=headers)
                    else:
                        response = await client.request(method, path, content=body.encode("utf-8"), headers=headers)
                    if response.status_code == 429:
                        raise ExchangeAPIError(f"Bybit rate limit response: {response.status_code} {response.text}")
                    response.raise_for_status()
                    payload = response.json() if response.content else {}
                    if payload.get("retCode", 0) != 0:
                        raise ExchangeAPIError(f"Bybit error {payload.get('retCode')}: {payload.get('retMsg')}")
                    return payload
            except (httpx.HTTPError, json.JSONDecodeError, ExchangeAPIError) as error:
                last_error = error
                if attempt == self.max_attempts - 1:
                    break
                await asyncio.sleep(self.backoff_base * (2**attempt) + random.uniform(0, 0.15))
        raise ExchangeAPIError(f"Bybit execution request failed: {last_error}") from last_error

    async def _rate_limit(self) -> None:
        async with self._rate_lock:
            elapsed = time.perf_counter() - self._last_request_at
            if elapsed < self.min_interval_seconds:
                await asyncio.sleep(self.min_interval_seconds - elapsed)
            self._last_request_at = time.perf_counter()

    def _format_number(self, value: float) -> str:
        return format(value, ".12f").rstrip("0").rstrip(".")

    def _permission_mentions(self, value: Any, needle: str) -> bool:
        needle = needle.lower()
        if isinstance(value, dict):
            return any(
                needle in str(key).lower() or self._permission_mentions(item, needle)
                for key, item in value.items()
            )
        if isinstance(value, list):
            return any(self._permission_mentions(item, needle) for item in value)
        return needle in str(value).lower()
