from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import json
import os
import random
import re
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
        self.official_signer_enabled = os.getenv("HYPERLIQUID_OFFICIAL_SIGNER_ENABLED", "false").lower() == "true"
        self.market_order_slippage = float(os.getenv("HYPERLIQUID_MARKET_ORDER_SLIPPAGE", "0.005"))
        self.timeout = float(os.getenv("EXECUTION_HTTP_TIMEOUT_SECONDS", "10"))
        self.max_attempts = int(os.getenv("EXECUTION_RETRY_ATTEMPTS", "3"))
        self.backoff_base = float(os.getenv("EXECUTION_BACKOFF_BASE_SECONDS", "0.25"))
        self.min_interval_seconds = float(os.getenv("HYPERLIQUID_EXECUTION_MIN_INTERVAL_SECONDS", "0.12"))
        self._rate_lock = asyncio.Lock()
        self._last_request_at = 0.0

    def has_credentials(self) -> bool:
        return bool(self.main_wallet_address and self.api_wallet_private_key)

    def live_execution_supported(self) -> bool:
        return self.official_signer_enabled

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
        self._ensure_live_signer_ready()
        return await asyncio.to_thread(
            self._place_order_sync,
            symbol=symbol,
            side=side,
            order_type=order_type,
            quantity=quantity,
            price=price,
            client_order_id=client_order_id,
            reduce_only=reduce_only,
        )

    async def cancel_order(
        self,
        *,
        symbol: str,
        order_id: str | None = None,
        client_order_id: str | None = None,
        category: str | None = None,
    ) -> dict[str, Any]:
        self._ensure_live_signer_ready()
        return await asyncio.to_thread(
            self._cancel_order_sync,
            symbol=symbol,
            order_id=order_id,
            client_order_id=client_order_id,
        )

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
        sdk_installed = self._sdk_installed()
        return {
            "exchange": "hyperliquid",
            "can_trade": self.official_signer_enabled and self.has_credentials() and sdk_installed,
            "can_withdraw": None,
            "permissions": {
                "user_role": role,
                "api_wallet_private_key_configured": bool(self.api_wallet_private_key),
                "official_signer_enabled": self.official_signer_enabled,
                "official_sdk_installed": sdk_installed,
                "vault_address_configured": bool(self.vault_address),
            },
            "wallet_signer_required": True,
            "live_execution_supported": self.live_execution_supported(),
            "source": "hyperliquid:info:userRole",
        }

    def _ensure_live_signer_ready(self) -> None:
        if not self.official_signer_enabled:
            raise ExchangeAPIError("Hyperliquid official signer is disabled; set HYPERLIQUID_OFFICIAL_SIGNER_ENABLED=true")
        if not self.has_credentials():
            raise ExchangeAPIError("HYPERLIQUID_MAIN_WALLET_ADDRESS and HYPERLIQUID_API_WALLET_PRIVATE_KEY are required for Hyperliquid live signing")
        if not self._sdk_installed():
            raise ExchangeAPIError("Install hyperliquid-python-sdk to enable Hyperliquid official live signing")

    def _place_order_sync(
        self,
        *,
        symbol: str,
        side: str,
        order_type: str,
        quantity: float,
        price: float | None,
        client_order_id: str | None,
        reduce_only: bool,
    ) -> dict[str, Any]:
        exchange = self._official_exchange()
        coin = self._coin_from_symbol(symbol)
        is_buy = side.lower() == "buy"
        cloid = self._cloid_from_client_order_id(client_order_id)

        if order_type.upper() == "MARKET":
            limit_px = exchange._slippage_price(coin, is_buy, self.market_order_slippage)
            raw = exchange.order(
                coin,
                is_buy,
                quantity,
                limit_px,
                {"limit": {"tif": "Ioc"}},
                reduce_only=reduce_only,
                cloid=cloid,
            )
        elif order_type.upper() == "LIMIT":
            if price is None:
                raise ExchangeAPIError("price is required for Hyperliquid LIMIT orders")
            raw = exchange.order(
                coin,
                is_buy,
                quantity,
                price,
                {"limit": {"tif": "Gtc"}},
                reduce_only=reduce_only,
                cloid=cloid,
            )
        else:
            raise ExchangeAPIError(f"unsupported Hyperliquid order type: {order_type}")

        return self._with_order_metadata(raw, client_order_id=client_order_id)

    def _cancel_order_sync(
        self,
        *,
        symbol: str,
        order_id: str | None,
        client_order_id: str | None,
    ) -> dict[str, Any]:
        exchange = self._official_exchange()
        coin = self._coin_from_symbol(symbol)

        if order_id:
            raw = exchange.cancel(coin, int(order_id))
        elif client_order_id:
            cloid = self._cloid_from_client_order_id(client_order_id)
            if cloid is None:
                raise ExchangeAPIError("client_order_id could not be converted into a Hyperliquid CLOID")
            raw = exchange.cancel_by_cloid(coin, cloid)
        else:
            raise ExchangeAPIError("order_id or client_order_id is required to cancel a Hyperliquid order")

        return self._with_order_metadata(raw, client_order_id=client_order_id, order_id=order_id)

    def _official_exchange(self) -> Any:
        try:
            from eth_account import Account
            from hyperliquid.exchange import Exchange
        except ImportError as error:
            raise ExchangeAPIError("Install hyperliquid-python-sdk to enable Hyperliquid official live signing") from error

        private_key = str(self.api_wallet_private_key or "").strip()
        wallet = Account.from_key(private_key)
        return Exchange(
            wallet,
            self.base_url,
            vault_address=self.vault_address or None,
            account_address=self.main_wallet_address,
            timeout=self.timeout,
        )

    def _cloid_from_client_order_id(self, client_order_id: str | None) -> Any | None:
        if not client_order_id:
            return None
        try:
            from hyperliquid.utils.types import Cloid
        except ImportError as error:
            raise ExchangeAPIError("Install hyperliquid-python-sdk to enable Hyperliquid CLOID support") from error

        raw = client_order_id.strip()
        if re.fullmatch(r"0x[0-9a-fA-F]{32}", raw):
            return Cloid.from_str(raw.lower())
        digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
        return Cloid.from_str(f"0x{digest}")

    def _with_order_metadata(
        self,
        raw: Any,
        *,
        client_order_id: str | None,
        order_id: str | None = None,
    ) -> dict[str, Any]:
        payload = raw if isinstance(raw, dict) else {"raw": raw}
        exchange_order_id = order_id or self._extract_order_id(payload)
        return {
            **payload,
            "clientOrderId": client_order_id,
            "orderId": None if exchange_order_id is None else str(exchange_order_id),
            "source": "hyperliquid:official_sdk",
        }

    def _extract_order_id(self, payload: dict[str, Any]) -> str | None:
        response = payload.get("response")
        if not isinstance(response, dict):
            return None
        data = response.get("data")
        if not isinstance(data, dict):
            return None
        statuses = data.get("statuses", [])
        for status in statuses if isinstance(statuses, list) else []:
            if not isinstance(status, dict):
                continue
            for key in ("resting", "filled"):
                oid = status.get(key, {}).get("oid")
                if oid is not None:
                    return str(oid)
        return None

    def _sdk_installed(self) -> bool:
        return importlib.util.find_spec("hyperliquid") is not None and importlib.util.find_spec("eth_account") is not None

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
