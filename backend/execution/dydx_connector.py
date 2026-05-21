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


class DydxExecutionConnector:
    def __init__(self) -> None:
        self.indexer_base_url = os.getenv("DYDX_INDEXER_BASE_URL", "https://indexer.dydx.trade")
        self.owner_address = os.getenv("DYDX_OWNER_ADDRESS")
        self.permissioned_private_key = os.getenv("DYDX_PERMISSIONED_PRIVATE_KEY")
        self.authenticator_id = os.getenv("DYDX_AUTHENTICATOR_ID")
        self.subaccount_number = os.getenv("DYDX_SUBACCOUNT_NUMBER", "0")
        self.timeout = float(os.getenv("EXECUTION_HTTP_TIMEOUT_SECONDS", "10"))
        self.max_attempts = int(os.getenv("EXECUTION_RETRY_ATTEMPTS", "3"))
        self.backoff_base = float(os.getenv("EXECUTION_BACKOFF_BASE_SECONDS", "0.25"))
        self.min_interval_seconds = float(os.getenv("DYDX_EXECUTION_MIN_INTERVAL_SECONDS", "0.12"))
        self._rate_lock = asyncio.Lock()
        self._last_request_at = 0.0

    def has_credentials(self) -> bool:
        return bool(self.owner_address and self.permissioned_private_key and self.authenticator_id)

    def live_execution_supported(self) -> bool:
        return False

    def wallet_signer_required(self) -> bool:
        return True

    async def get_market_price(self, symbol: str, category: str | None = None) -> float:
        market = self._market_from_symbol(symbol)
        payload = await self._request("GET", "/v4/perpetualMarkets", params={"market": market})
        markets = payload.get("markets", {})
        item = markets.get(market)
        if item is None:
            raise ExchangeAPIError(f"dYdX market unavailable for {market}")
        price = item.get("oraclePrice") or item.get("indexPrice")
        if price in (None, ""):
            raise ExchangeAPIError(f"dYdX market price unavailable for {market}")
        return float(price)

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
        raise ExchangeAPIError("dYdX live execution requires an isolated official client signer with permissioned keys; it is not enabled")

    async def cancel_order(
        self,
        *,
        symbol: str,
        order_id: str | None = None,
        client_order_id: str | None = None,
        category: str | None = None,
    ) -> dict[str, Any]:
        raise ExchangeAPIError("dYdX live cancel requires an isolated official client signer with permissioned keys; it is not enabled")

    async def get_open_positions(self, *, symbol: str | None = None, category: str | None = None) -> list[dict[str, Any]]:
        if not self.owner_address:
            raise ExchangeAPIError("DYDX_OWNER_ADDRESS is required for dYdX position reads")
        path = f"/v4/addresses/{self.owner_address}/subaccountNumber/{self.subaccount_number}"
        payload = await self._request("GET", path, params={})
        subaccount = payload.get("subaccount", payload)
        requested_market = self._market_from_symbol(symbol) if symbol else None
        positions: list[dict[str, Any]] = []
        for row in subaccount.get("openPerpetualPositions", []) or subaccount.get("perpetualPositions", []) or []:
            market = str(row.get("market", row.get("ticker", ""))).upper()
            if requested_market and market != requested_market:
                continue
            quantity = self._float_or_none(row.get("size") or row.get("netSize"))
            if quantity is None or abs(quantity) <= 0:
                continue
            positions.append(
                {
                    "exchange": "dydx",
                    "mode": "live",
                    "symbol": market.replace("-", ""),
                    "quantity": quantity,
                    "average_entry_price": self._float_or_none(row.get("entryPrice")),
                    "market_price": self._float_or_none(row.get("oraclePrice")),
                    "notional": self._float_or_none(row.get("sumOpen") or row.get("notional")),
                    "unrealized_pnl": self._float_or_none(row.get("unrealizedPnl")),
                    "source": "dydx:indexer:subaccount",
                    "raw": row,
                }
            )
        return positions

    async def get_account_permissions(self) -> dict[str, Any]:
        return {
            "exchange": "dydx",
            "can_trade": False,
            "can_withdraw": None,
            "permissions": {
                "owner_address_configured": bool(self.owner_address),
                "permissioned_private_key_configured": bool(self.permissioned_private_key),
                "authenticator_id_configured": bool(self.authenticator_id),
                "subaccount_number": self.subaccount_number,
            },
            "wallet_signer_required": True,
            "live_execution_supported": False,
            "source": "dydx:permissioned_keys:configured_env",
        }

    async def _request(self, method: str, path: str, *, params: dict[str, Any]) -> Any:
        last_error: Exception | None = None
        for attempt in range(self.max_attempts):
            try:
                await self._rate_limit()
                async with httpx.AsyncClient(base_url=self.indexer_base_url, timeout=self.timeout) as client:
                    response = await client.request(method, path, params=params)
                    if response.status_code == 429:
                        raise ExchangeAPIError(f"dYdX rate limit response: {response.status_code} {response.text}")
                    response.raise_for_status()
                    return response.json() if response.content else {}
            except (httpx.HTTPError, json.JSONDecodeError, ExchangeAPIError) as error:
                last_error = error
                if attempt == self.max_attempts - 1:
                    break
                await asyncio.sleep(self.backoff_base * (2**attempt) + random.uniform(0, 0.15))
        raise ExchangeAPIError(f"dYdX indexer request failed: {last_error}") from last_error

    async def _rate_limit(self) -> None:
        async with self._rate_lock:
            elapsed = time.perf_counter() - self._last_request_at
            if elapsed < self.min_interval_seconds:
                await asyncio.sleep(self.min_interval_seconds - elapsed)
            self._last_request_at = time.perf_counter()

    def _market_from_symbol(self, symbol: str | None) -> str:
        if not symbol:
            raise ExchangeAPIError("symbol is required")
        cleaned = symbol.upper().strip().replace("/", "-")
        if "-" in cleaned:
            base, _quote = cleaned.split("-", 1)
            return f"{base}-USD"
        normalized = normalize_symbol(cleaned)
        for quote in ("USDT", "USDC", "USD"):
            if normalized.endswith(quote):
                return f"{normalized[: -len(quote)]}-USD"
        return f"{normalized}-USD"

    def _float_or_none(self, value: Any) -> float | None:
        if value in (None, ""):
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
