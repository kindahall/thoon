from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx
import pandas as pd

from services.binance import BinanceAPIError, normalize_interval, normalize_symbol


BINANCE_KLINES_PATH = "/api/v3/klines"


def parse_utc_datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


class BinanceHistoricalDataLoader:
    def __init__(self, *, base_url: str = "https://api.binance.com", timeout_seconds: float = 15) -> None:
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds

    async def download_ohlcv(
        self,
        *,
        symbol: str,
        interval: str,
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = 1000,
    ) -> pd.DataFrame:
        normalized_symbol = normalize_symbol(symbol)
        normalized_interval = normalize_interval(interval)
        safe_limit = max(1, min(limit, 1000))
        rows: list[list[Any]] = []
        next_start_ms = self._to_ms(start)
        end_ms = self._to_ms(end)

        async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout_seconds) as client:
            while True:
                params: dict[str, Any] = {
                    "symbol": normalized_symbol,
                    "interval": normalized_interval,
                    "limit": safe_limit,
                }
                if next_start_ms is not None:
                    params["startTime"] = next_start_ms
                if end_ms is not None:
                    params["endTime"] = end_ms

                response = await client.get(BINANCE_KLINES_PATH, params=params)
                try:
                    response.raise_for_status()
                except httpx.HTTPStatusError as error:
                    raise BinanceAPIError(f"Binance historical klines failed: {response.text}") from error

                batch = response.json()
                if not batch:
                    break

                rows.extend(batch)

                if len(batch) < safe_limit or len(rows) >= limit:
                    break

                last_open_time = int(batch[-1][0])
                next_start_ms = last_open_time + 1
                if end_ms is not None and next_start_ms >= end_ms:
                    break

        if not rows:
            raise BinanceAPIError("Binance returned no historical OHLCV rows")

        frame = self._rows_to_frame(rows[:limit])
        return frame[~frame.index.duplicated(keep="last")].sort_index()

    def _rows_to_frame(self, rows: list[list[Any]]) -> pd.DataFrame:
        frame = pd.DataFrame(
            rows,
            columns=[
                "open_time",
                "open",
                "high",
                "low",
                "close",
                "volume",
                "close_time",
                "quote_asset_volume",
                "number_of_trades",
                "taker_buy_base_asset_volume",
                "taker_buy_quote_asset_volume",
                "ignore",
            ],
        )
        frame["timestamp"] = pd.to_datetime(frame["open_time"], unit="ms", utc=True)
        numeric_columns = ["open", "high", "low", "close", "volume", "quote_asset_volume"]
        for column in numeric_columns:
            frame[column] = pd.to_numeric(frame[column], errors="raise")
        return frame.set_index("timestamp")[["open", "high", "low", "close", "volume", "quote_asset_volume"]]

    def _to_ms(self, value: datetime | None) -> int | None:
        if value is None:
            return None
        normalized = value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)
        return int(normalized.timestamp() * 1000)
