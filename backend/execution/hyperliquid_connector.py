from __future__ import annotations

import asyncio
import json
import os
import random
import time
from typing import Any

import httpx

from execution.binance_connector import ExchangeAPIError
from services.binance import normalize_symbol


class HyperliquidExecutionConnector:
    def __init__(self) -> None:
        self.base_url = os.getenv("HYPERLIQUID_BASE_URL", "https://api.hyperliquid.xyz")
        self.main_wallet_address = os.getenv("HYPERLIQUID_MAIN_WALLET_ADDRESS")
        self.api_wallet_private_key = os.getenv("HYPERLIQUID_API_WALLET_PRIVATE_KEY")
        self.vault_address = os.getenv("HYPERLIQUID_VAULT_ADDRESS")
        self.timeout = float(os.getenv("EXECUTION_HTTP_TIMEOUT_SECONDS", "10"))
        self.max_attempts = int(os.getenv("EXECUTION_RETRY_ATTEMPTS", "3"))
        self.backoff_base = float(os.getenv("EXECUTION_BACKOFF_BASE_SECONDS", "0.25"))
        self.min_interval_seconds = float(os.getenv("HYPERLIQUID_EXECUTION_MIN_INTERVAL_SECONDS", "0.12"))
        self._rate_lock = asyncio.Lock()
        self._last_request_at = 0.0

    def has_credentials(self) -> bool:
        return bool(self.main_wallet_address and self.api_wallet_private_key)

    def live_execution_supported(self) -> bool:
        return False

    def wallet_signer_required(self) -> bool:
        return True

    async def get_market_price(self, symbol: str, category: str | None = None) -> float:
        coin = self._coin_from_symbol(symbol)
        payload = await self._info({"type": "allMids"})
        value = payload.get(coin)
        if value is None:
            raise ExchangeAPIError(f"Hyperliquid mid price unavailable for {coin}")
        return float(value)

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
        raise ExchangeAPIError("Hyperliquid live execution requires an isolated official SDK signer/vault module; it is not enabled")

    async def cancel_order(
        self,
        *,
        symbol: str,
        order_id: str | None = None,
        client_order_id: str | None = None,
        category: str | None = None,
    ) -> dict[str, Any]:
        raise ExchangeAPIError("Hyperliquid live cancel requires an isolated official SDK signer/vault module; it is not enabled")

    async def get_open_positions(self, *, symbol: str | None = None, category: str | None = None) -> list[dict[str, Any]]:
        if not self.main_wallet_address:
            raise ExchangeAPIError("HYPERLIQUID_MAIN_WALLET_ADDRESS is required for Hyperliquid position reads")
        payload = await self._info({"type": "clearinghouseState", "user": self.main_wallet_address.lower()})
        positions: list[dict[str, Any]] = []
        requested_coin = self._coin_from_symbol(symbol) if symbol else None
        for row in payload.get("assetPositions", []) or []:
            item = row.get("position", row)
            coin = str(item.get("coin", "")).upper()
            if requested_coin and coin != requested_coin:
                continue
            quantity = self._float_or_none(item.get("szi"))
            if quantity is None or abs(quantity) <= 0:
                continue
            market_price = self._float_or_none(item.get("markPx"))
            notional = self._float_or_none(item.get("positionValue"))
            positions.append(
                {
                    "exchange": "hyperliquid",
                    "mode": "live",
                    "symbol": f"{coin}USD",
                    "quantity": quantity,
                    "average_entry_price": self._float_or_none(item.get("entryPx")),
                    "market_price": market_price,
                    "notional": notional,
                    "unrealized_pnl": self._float_or_none(item.get("unrealizedPnl")),
                    "source": "hyperliquid:info:clearinghouseState",
                    "raw": item,
                }
            )
        return positions

    async def get_account_permissions(self) -> dict[str, Any]:
        if not self.main_wallet_address:
            raise ExchangeAPIError("HYPERLIQUID_MAIN_WALLET_ADDRESS is required for Hyperliquid account checks")
        role = await self._info({"type": "userRole", "user": self.main_wallet_address.lower()})
        return {
            "exchange": "hyperliquid",
            "can_trade": False,
            "can_withdraw": None,
            "permissions": {"user_role": role, "api_wallet_private_key_configured": bool(self.api_wallet_private_key)},
            "wallet_signer_required": True,
            "live_execution_supported": False,
            "source": "hyperliquid:info:userRole",
        }

    async def _info(self, body: dict[str, Any]) -> Any:
        return await self._request("POST", "/info", body=body)

    async def _request(self, method: str, path: str, *, body: dict[str, Any]) -> Any:
        last_error: Exception | None = None
        for attempt in range(self.max_attempts):
            try:
                await self._rate_limit()
                async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout) as client:
                    response = await client.request(method, path, json=body, headers={"Content-Type": "application/json"})
                    if response.status_code == 429:
                        raise ExchangeAPIError(f"Hyperliquid rate limit response: {response.status_code} {response.text}")
                    response.raise_for_status()
                    return response.json() if response.content else {}
            except (httpx.HTTPError, json.JSONDecodeError, ExchangeAPIError) as error:
                last_error = error
                if attempt == self.max_attempts - 1:
                    break
                await asyncio.sleep(self.backoff_base * (2**attempt) + random.uniform(0, 0.15))
        raise ExchangeAPIError(f"Hyperliquid request failed: {last_error}") from last_error

    async def _rate_limit(self) -> None:
        async with self._rate_lock:
            elapsed = time.perf_counter() - self._last_request_at
            if elapsed < self.min_interval_seconds:
                await asyncio.sleep(self.min_interval_seconds - elapsed)
            self._last_request_at = time.perf_counter()

    def _coin_from_symbol(self, symbol: str | None) -> str:
        if not symbol:
            raise ExchangeAPIError("symbol is required")
        normalized = normalize_symbol(symbol.replace("-", "").replace("/", ""))
        for quote in ("USDT", "USDC", "USD"):
            if normalized.endswith(quote):
                return normalized[: -len(quote)]
        return normalized

    def _float_or_none(self, value: Any) -> float | None:
        if value in (None, ""):
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
