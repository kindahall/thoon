from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from paper.runtime import binance_client, paper_engine
from services.binance import BinanceAPIError

router = APIRouter()


async def _send_json(websocket: WebSocket, payload: dict[str, Any]) -> bool:
    try:
        await websocket.send_json(payload)
        return True
    except WebSocketDisconnect:
        return False
    except RuntimeError:
        return False


@router.websocket("/ws/paper/{symbol}")
async def paper_pnl_websocket(websocket: WebSocket, symbol: str) -> None:
    await websocket.accept()
    backoff_seconds = 1.0

    while True:
        try:
            await _send_json(
                websocket,
                {
                    "type": "status",
                    "status": "connecting",
                    "symbol": symbol.upper(),
                    "source": "binance_ws_trade",
                },
            )

            async for live_price in binance_client.stream_prices(symbol):
                backoff_seconds = 1.0
                state = await paper_engine.mark_to_market(
                    live_price.symbol,
                    market_price=live_price.price,
                    source="binance_ws_trade",
                    timestamp=datetime.fromtimestamp(live_price.timestamp / 1000, tz=UTC),
                )
                sent = await _send_json(
                    websocket,
                    {
                        "type": "paper_pnl",
                        "symbol": live_price.symbol,
                        "source": "binance_ws_trade",
                        "data": state.model_dump(mode="json"),
                    },
                )
                if not sent:
                    return

        except WebSocketDisconnect:
            return
        except Exception as error:
            sent = await _send_json(
                websocket,
                {
                    "type": "status",
                    "status": "ws_failed_rest_fallback",
                    "symbol": symbol.upper(),
                    "source": "binance_rest",
                    "error": str(error),
                },
            )
            if not sent:
                return

            fallback_ticks = max(1, int(backoff_seconds))
            for _ in range(fallback_ticks):
                try:
                    price = await binance_client.get_price(symbol)
                    state = await paper_engine.mark_to_market(
                        price.symbol,
                        market_price=price.price,
                        source="binance_rest_fallback",
                    )
                    sent = await _send_json(
                        websocket,
                        {
                            "type": "paper_pnl",
                            "symbol": price.symbol,
                            "source": "binance_rest_fallback",
                            "data": state.model_dump(mode="json"),
                        },
                    )
                    if not sent:
                        return
                except BinanceAPIError as fallback_error:
                    sent = await _send_json(
                        websocket,
                        {
                            "type": "status",
                            "status": "rest_fallback_failed",
                            "symbol": symbol.upper(),
                            "source": "binance_rest",
                            "error": str(fallback_error),
                        },
                    )
                    if not sent:
                        return
                await asyncio.sleep(1)

            backoff_seconds = min(backoff_seconds * 2, 30)
