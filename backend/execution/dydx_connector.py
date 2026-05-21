from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import json
import os
import random
import time
from dataclasses import dataclass
from typing import Any

import httpx

from execution.binance_connector import ExchangeAPIError
from services.binance import normalize_symbol


@dataclass(frozen=True)
class DydxOrderIdentity:
    client_id: int
    market: str
    order_flags: int


class DydxExecutionConnector:
    def __init__(self) -> None:
        self.network_name = os.getenv("DYDX_NETWORK", "mainnet").lower()
        default_indexer = "https://indexer.v4testnet.dydx.exchange" if self.network_name == "testnet" else "https://indexer.dydx.trade"
        default_websocket = "wss://indexer.v4testnet.dydx.exchange/v4/ws" if self.network_name == "testnet" else "wss://indexer.dydx.trade/v4/ws"
        default_node = "test-dydx-grpc.kingnodes.com" if self.network_name == "testnet" else "oegs.dydx.trade:443"
        self.indexer_base_url = os.getenv("DYDX_INDEXER_BASE_URL", default_indexer)
        self.websocket_indexer_url = os.getenv("DYDX_WEBSOCKET_INDEXER_URL", default_websocket)
        self.node_url = os.getenv("DYDX_NODE_URL", default_node)
        self.owner_address = os.getenv("DYDX_OWNER_ADDRESS")
        self.permissioned_private_key = os.getenv("DYDX_PERMISSIONED_PRIVATE_KEY")
        self.authenticator_id = os.getenv("DYDX_AUTHENTICATOR_ID")
        self.subaccount_number = os.getenv("DYDX_SUBACCOUNT_NUMBER", "0")
        self.official_signer_enabled = os.getenv("DYDX_OFFICIAL_SIGNER_ENABLED", "false").lower() == "true"
        self.market_order_slippage = float(os.getenv("DYDX_MARKET_ORDER_SLIPPAGE", "0.005"))
        self.short_term_good_til_blocks = int(os.getenv("DYDX_SHORT_TERM_GOOD_TIL_BLOCKS", "20"))
        self.long_term_good_til_seconds = int(os.getenv("DYDX_LONG_TERM_GOOD_TIL_SECONDS", "86400"))
        self.limit_order_flags = os.getenv("DYDX_LIMIT_ORDER_FLAGS", "SHORT_TERM").upper()
        self.timeout = float(os.getenv("EXECUTION_HTTP_TIMEOUT_SECONDS", "10"))
        self.max_attempts = int(os.getenv("EXECUTION_RETRY_ATTEMPTS", "3"))
        self.backoff_base = float(os.getenv("EXECUTION_BACKOFF_BASE_SECONDS", "0.25"))
        self.min_interval_seconds = float(os.getenv("DYDX_EXECUTION_MIN_INTERVAL_SECONDS", "0.12"))
        self._rate_lock = asyncio.Lock()
        self._signer_lock = asyncio.Lock()
        self._last_request_at = 0.0

    def has_credentials(self) -> bool:
        return bool(self.owner_address and self.permissioned_private_key and self.authenticator_id)

    def live_execution_supported(self) -> bool:
        return self.official_signer_enabled

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
        self._ensure_live_signer_ready()
        async with self._signer_lock:
            return await self._place_order_with_official_sdk(
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
        async with self._signer_lock:
            return await self._cancel_order_with_official_sdk(
                symbol=symbol,
                order_id=order_id,
                client_order_id=client_order_id,
            )

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
        sdk_installed = self._sdk_installed()
        authenticator_verified = False
        authenticator_found = False
        verification_error: str | None = None

        if self.official_signer_enabled and self.has_credentials() and sdk_installed:
            try:
                authenticator_found = await self._verify_authenticator()
                authenticator_verified = True
            except Exception as error:
                verification_error = str(error)

        return {
            "exchange": "dydx",
            "can_trade": self.official_signer_enabled and self.has_credentials() and sdk_installed and authenticator_verified and authenticator_found,
            "can_withdraw": None,
            "permissions": {
                "owner_address_configured": bool(self.owner_address),
                "permissioned_private_key_configured": bool(self.permissioned_private_key),
                "authenticator_id_configured": bool(self.authenticator_id),
                "subaccount_number": self.subaccount_number,
                "network": self.network_name,
                "node_url_configured": bool(self.node_url),
                "official_signer_enabled": self.official_signer_enabled,
                "official_sdk_installed": sdk_installed,
                "authenticator_verified": authenticator_verified,
                "authenticator_found": authenticator_found,
                "verification_error": verification_error,
            },
            "wallet_signer_required": True,
            "live_execution_supported": self.live_execution_supported(),
            "source": "dydx:permissioned_keys:configured_env",
        }

    def _ensure_live_signer_ready(self) -> None:
        if not self.official_signer_enabled:
            raise ExchangeAPIError("dYdX official signer is disabled; set DYDX_OFFICIAL_SIGNER_ENABLED=true")
        if not self.has_credentials():
            raise ExchangeAPIError("DYDX_OWNER_ADDRESS, DYDX_PERMISSIONED_PRIVATE_KEY and DYDX_AUTHENTICATOR_ID are required for dYdX live signing")
        if not self.node_url:
            raise ExchangeAPIError("DYDX_NODE_URL is required for dYdX live signing")
        if not self._sdk_installed():
            raise ExchangeAPIError("Install dydx-v4-client to enable dYdX official live signing")

    async def _place_order_with_official_sdk(
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
        sdk = self._load_sdk()
        network = self._network(sdk)
        node = await sdk.NodeClient.connect(network.node)
        indexer = sdk.IndexerClient(network.rest_indexer)
        market_name = self._market_from_symbol(symbol)
        market = sdk.Market((await indexer.markets.get_perpetual_markets(market_name))["markets"][market_name])
        signer_wallet, tx_options = await self._permissioned_wallet_and_options(sdk, node)
        order_flags = self._order_flags(sdk, order_type)
        identity = DydxOrderIdentity(
            client_id=self._client_id(client_order_id),
            market=market_name,
            order_flags=int(order_flags),
        )
        order_id = market.order_id(
            str(self.owner_address),
            int(self.subaccount_number),
            identity.client_id,
            order_flags,
        )

        order_price = await self._order_price(order_type=order_type, side=side, price=price, symbol=symbol)
        order_kwargs = {
            "order_id": order_id,
            "order_type": sdk.OrderType.MARKET if order_type.upper() == "MARKET" else sdk.OrderType.LIMIT,
            "side": sdk.Order.Side.SIDE_BUY if side.lower() == "buy" else sdk.Order.Side.SIDE_SELL,
            "size": quantity,
            "price": order_price,
            "time_in_force": sdk.Order.TimeInForce.TIME_IN_FORCE_UNSPECIFIED,
            "reduce_only": reduce_only,
        }
        order_kwargs.update(await self._good_til_params(sdk, node, order_flags))

        response = await node.place_order(
            wallet=signer_wallet,
            order=market.order(**order_kwargs),
            tx_options=tx_options,
        )
        return self._normalize_sdk_response(response, identity=identity, client_order_id=client_order_id, action="place_order")

    async def _cancel_order_with_official_sdk(
        self,
        *,
        symbol: str,
        order_id: str | None,
        client_order_id: str | None,
    ) -> dict[str, Any]:
        sdk = self._load_sdk()
        network = self._network(sdk)
        node = await sdk.NodeClient.connect(network.node)
        indexer = sdk.IndexerClient(network.rest_indexer)
        identity = self._order_identity_from_cancel(symbol=symbol, order_id=order_id, client_order_id=client_order_id, sdk=sdk)
        market = sdk.Market((await indexer.markets.get_perpetual_markets(identity.market))["markets"][identity.market])
        signer_wallet, tx_options = await self._permissioned_wallet_and_options(sdk, node)
        dydx_order_id = market.order_id(
            str(self.owner_address),
            int(self.subaccount_number),
            identity.client_id,
            identity.order_flags,
        )
        good_til = await self._good_til_params(sdk, node, identity.order_flags, cancel=True)
        response = await node.cancel_order(
            wallet=signer_wallet,
            order_id=dydx_order_id,
            tx_options=tx_options,
            **good_til,
        )
        return self._normalize_sdk_response(response, identity=identity, client_order_id=client_order_id, action="cancel_order")

    async def _permissioned_wallet_and_options(self, sdk: Any, node: Any) -> tuple[Any, Any]:
        account = await node.get_account(str(self.owner_address))
        private_key = str(self.permissioned_private_key or "").strip()
        if private_key.startswith("0x"):
            private_key = private_key[2:]
        signer_wallet = sdk.Wallet(
            key=sdk.KeyPair.from_hex(private_key),
            account_number=account.account_number,
            sequence=account.sequence,
        )
        tx_options = sdk.TxOptions(
            authenticators=[int(str(self.authenticator_id))],
            sequence=account.sequence,
            account_number=account.account_number,
        )
        return signer_wallet, tx_options

    async def _verify_authenticator(self) -> bool:
        sdk = self._load_sdk()
        network = self._network(sdk)
        node = await sdk.NodeClient.connect(network.node)
        authenticators = await node.get_authenticators(str(self.owner_address))
        rows = getattr(authenticators, "account_authenticators", []) or []
        return any(str(getattr(row, "id", "")) == str(self.authenticator_id) for row in rows)

    async def _order_price(self, *, order_type: str, side: str, price: float | None, symbol: str) -> float:
        if order_type.upper() == "LIMIT":
            if price is None:
                raise ExchangeAPIError("price is required for dYdX LIMIT orders")
            return float(price)
        if price is not None:
            return float(price)
        market_price = await self.get_market_price(symbol)
        multiplier = 1 + self.market_order_slippage if side.lower() == "buy" else 1 - self.market_order_slippage
        return float(market_price * multiplier)

    async def _good_til_params(self, sdk: Any, node: Any, order_flags: int, *, cancel: bool = False) -> dict[str, int]:
        if int(order_flags) == int(sdk.OrderFlags.LONG_TERM):
            seconds = max(60, self.long_term_good_til_seconds)
            if cancel:
                seconds = max(120, min(seconds, 600))
            return {"good_til_block_time": sdk.since_now(seconds=seconds)}
        current_block = await node.latest_block_height()
        return {"good_til_block": current_block + self.short_term_good_til_blocks}

    def _order_flags(self, sdk: Any, order_type: str) -> int:
        if order_type.upper() == "MARKET":
            return sdk.OrderFlags.SHORT_TERM
        if self.limit_order_flags == "LONG_TERM":
            return sdk.OrderFlags.LONG_TERM
        return sdk.OrderFlags.SHORT_TERM

    def _order_identity_from_cancel(self, *, symbol: str, order_id: str | None, client_order_id: str | None, sdk: Any) -> DydxOrderIdentity:
        market = self._market_from_symbol(symbol)
        if order_id:
            try:
                payload = json.loads(order_id)
                return DydxOrderIdentity(
                    client_id=int(payload["client_id"]),
                    market=str(payload.get("market") or market),
                    order_flags=int(payload.get("order_flags", int(sdk.OrderFlags.SHORT_TERM))),
                )
            except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                if order_id.isdigit():
                    return DydxOrderIdentity(
                        client_id=int(order_id),
                        market=market,
                        order_flags=int(sdk.OrderFlags.SHORT_TERM),
                    )
                raise ExchangeAPIError("dYdX order_id must be the JSON order identity returned by place_order, or a numeric client id")
        if not client_order_id:
            raise ExchangeAPIError("order_id or client_order_id is required to cancel a dYdX order")
        return DydxOrderIdentity(
            client_id=self._client_id(client_order_id),
            market=market,
            order_flags=int(sdk.OrderFlags.SHORT_TERM),
        )

    def _client_id(self, client_order_id: str | None) -> int:
        if client_order_id and client_order_id.isdigit():
            numeric = int(client_order_id)
            if 0 <= numeric <= 2**32 - 1:
                return numeric
        raw = client_order_id or f"thoon-dydx-{time.time_ns()}"
        return int.from_bytes(hashlib.sha256(raw.encode("utf-8")).digest()[:4], "big")

    def _normalize_sdk_response(
        self,
        response: Any,
        *,
        identity: DydxOrderIdentity,
        client_order_id: str | None,
        action: str,
    ) -> dict[str, Any]:
        raw = self._protobuf_to_dict(response)
        tx_response = getattr(response, "tx_response", None)
        code = getattr(tx_response, "code", None)
        tx_hash = getattr(tx_response, "txhash", None)
        return {
            "status": "ok" if code in (0, None) else "error",
            "orderId": json.dumps(
                {
                    "client_id": identity.client_id,
                    "market": identity.market,
                    "order_flags": identity.order_flags,
                },
                sort_keys=True,
                separators=(",", ":"),
            ),
            "clientOrderId": client_order_id,
            "data": {
                "client_id": identity.client_id,
                "market": identity.market,
                "order_flags": identity.order_flags,
                "tx_hash": tx_hash,
                "tx_code": code,
            },
            "raw": raw,
            "source": f"dydx:official_sdk:{action}",
        }

    def _protobuf_to_dict(self, value: Any) -> dict[str, Any]:
        try:
            from google.protobuf.json_format import MessageToDict

            return MessageToDict(value, preserving_proto_field_name=True)
        except Exception:
            if hasattr(value, "__dict__"):
                return {key: str(item) for key, item in value.__dict__.items() if not key.startswith("_")}
            return {"value": str(value)}

    def _network(self, sdk: Any) -> Any:
        if self.network_name == "testnet" and not os.getenv("DYDX_NODE_URL") and not os.getenv("DYDX_INDEXER_BASE_URL"):
            return sdk.TESTNET
        if self.network_name == "testnet":
            return sdk.make_testnet(
                node_url=self.node_url,
                rest_indexer=self.indexer_base_url,
                websocket_indexer=self.websocket_indexer_url,
            )
        return sdk.make_mainnet(
            node_url=self.node_url,
            rest_indexer=self.indexer_base_url,
            websocket_indexer=self.websocket_indexer_url,
        )

    def _load_sdk(self) -> Any:
        try:
            from dydx_v4_client import OrderFlags
            from dydx_v4_client.indexer.rest.constants import OrderType
            from dydx_v4_client.indexer.rest.indexer_client import IndexerClient
            from dydx_v4_client.key_pair import KeyPair
            from dydx_v4_client.network import TESTNET, make_mainnet, make_testnet
            from dydx_v4_client.node.builder import TxOptions
            from dydx_v4_client.node.client import NodeClient
            from dydx_v4_client.node.market import Market, since_now
            from dydx_v4_client.wallet import Wallet
            from v4_proto.dydxprotocol.clob.order_pb2 import Order
        except ImportError as error:
            raise ExchangeAPIError("Install dydx-v4-client to enable dYdX official live signing") from error

        class DydxSdk:
            pass

        sdk = DydxSdk()
        sdk.IndexerClient = IndexerClient
        sdk.KeyPair = KeyPair
        sdk.Market = Market
        sdk.NodeClient = NodeClient
        sdk.Order = Order
        sdk.OrderFlags = OrderFlags
        sdk.OrderType = OrderType
        sdk.TESTNET = TESTNET
        sdk.TxOptions = TxOptions
        sdk.Wallet = Wallet
        sdk.make_mainnet = make_mainnet
        sdk.make_testnet = make_testnet
        sdk.since_now = since_now
        return sdk

    def _sdk_installed(self) -> bool:
        return importlib.util.find_spec("dydx_v4_client") is not None and importlib.util.find_spec("v4_proto") is not None

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
