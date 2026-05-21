from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.binance import BinanceAPIError, BinanceClient

router = APIRouter()
binance_client = BinanceClient()


async def _send_json(websocket: WebSocket, payload: dict[str, Any]) -> bool:
    try:
        await websocket.send_json(payload)
        return True
    except WebSocketDisconnect:
        return False
    except RuntimeError:
        return False


@router.websocket("/ws/market/{symbol}")
async def market_websocket(websocket: WebSocket, symbol: str) -> None:
    await websocket.accept()
    interval = websocket.query_params.get("interval", "1s")
    backoff_seconds = 1.0

    while True:
        try:
            await _send_json(
                websocket,
                {
                    "type": "status",
                    "status": "connecting",
                    "symbol": symbol.upper(),
                    "source": "binance_ws",
                },
            )

            async for candle in binance_client.stream_candles(symbol=symbol, interval=interval):
                backoff_seconds = 1.0
                sent = await _send_json(
                    websocket,
                    {
                        "type": "candle",
                        "symbol": symbol.upper(),
                        "source": "binance_ws",
                        "data": candle.model_dump(),
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
                    candles = await binance_client.get_candles(symbol=symbol, interval=interval, limit=1)
                    if candles:
                        sent = await _send_json(
                            websocket,
                            {
                                "type": "candle",
                                "symbol": symbol.upper(),
                                "source": "binance_rest_fallback",
                                "data": candles[-1].model_dump(),
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
