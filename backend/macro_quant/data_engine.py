from __future__ import annotations

import asyncio
import io
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pandas as pd

from data_quality.engine import DataQualityEngine
from data_quality.schemas import DataQualityRequest
from macro_quant.schemas import CrossAssetMacroRequest, MacroSeriesSnapshot
from rl.data_loader import RLMarketDataLoader


class CrossAssetDataError(RuntimeError):
    pass


class CrossAssetDataEngine:
    FRED_SERIES = {
        "DXY_PROXY": ("DTWEXBGS", "Trade Weighted U.S. Dollar Index"),
        "US10Y": ("DGS10", "10-Year Treasury Constant Maturity Rate"),
        "US2Y": ("DGS2", "2-Year Treasury Constant Maturity Rate"),
        "FEDFUNDS": ("FEDFUNDS", "Effective Federal Funds Rate"),
        "CPI": ("CPIAUCSL", "Consumer Price Index for All Urban Consumers"),
    }

    def __init__(
        self,
        *,
        market_loader: RLMarketDataLoader | None = None,
        quality_engine: DataQualityEngine | None = None,
        fred_graph_base_url: str = "https://fred.stlouisfed.org",
    ) -> None:
        self.market_loader = market_loader or RLMarketDataLoader()
        self.quality_engine = quality_engine or DataQualityEngine()
        self.fred_graph_base_url = fred_graph_base_url

    async def load(self, request: CrossAssetMacroRequest) -> tuple[pd.DataFrame, pd.DataFrame, list[MacroSeriesSnapshot]]:
        crypto_frames = await self._load_crypto(request)
        macro_frame = await self._load_macro(request)
        aligned = self._normalize_series(crypto_frames=crypto_frames, macro_frame=macro_frame)
        snapshots = self._macro_snapshots(macro_frame)
        return aligned, macro_frame, snapshots

    async def _load_crypto(self, request: CrossAssetMacroRequest) -> dict[str, pd.DataFrame]:
        async def load_symbol(symbol: str) -> tuple[str, pd.DataFrame]:
            frame = await self.market_loader.download_ohlcv(
                exchange=request.crypto_exchange,
                symbol=symbol,
                interval=request.interval,
                limit=request.crypto_lookback,
            )
            if frame.empty:
                raise CrossAssetDataError(f"{request.crypto_exchange} returned no OHLCV rows for {symbol}")
            quality = self.quality_engine.evaluate_frame(
                request=DataQualityRequest(
                    exchange=request.crypto_exchange,
                    symbol=symbol,
                    interval=request.interval,
                    limit=request.crypto_lookback,
                    compare_cross_exchange=False,
                ),
                frame=frame,
            )
            if not quality.usable_for_backtest:
                issue_codes = ", ".join(issue.code for issue in quality.issues) or "quality_score_below_threshold"
                raise CrossAssetDataError(f"macro quant blocked by data quality for {symbol}: {issue_codes}")
            return symbol, frame

        loaded = await asyncio.gather(*(load_symbol(symbol) for symbol in request.symbols))
        return dict(loaded)

    async def _load_macro(self, request: CrossAssetMacroRequest) -> pd.DataFrame:
        start_date = (datetime.now(UTC) - timedelta(days=request.macro_lookback_days)).date().isoformat()

        async def load_series(alias: str, series_id: str) -> tuple[str, pd.Series]:
            frame = await self._fetch_fred_csv(series_id)
            frame = frame[frame.index >= pd.Timestamp(start_date, tz="UTC")]
            if frame.empty:
                raise CrossAssetDataError(f"FRED returned no recent observations for {series_id}")
            return alias, frame[series_id].rename(alias)

        loaded = await asyncio.gather(*(load_series(alias, series_id) for alias, (series_id, _) in self.FRED_SERIES.items()))
        macro_frame = pd.concat([series for _, series in loaded], axis=1).sort_index()
        macro_frame = macro_frame.replace(".", pd.NA).apply(pd.to_numeric, errors="coerce").dropna(how="all").ffill()
        if macro_frame.dropna(how="all").empty:
            raise CrossAssetDataError("FRED macro frame is empty after normalization")
        return macro_frame

    async def _fetch_fred_csv(self, series_id: str) -> pd.DataFrame:
        async with httpx.AsyncClient(base_url=self.fred_graph_base_url, timeout=20) as client:
            response = await client.get("/graph/fredgraph.csv", params={"id": series_id})
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as error:
                raise CrossAssetDataError(f"FRED CSV request failed for {series_id}: {response.text[:300]}") from error
        frame = pd.read_csv(io.StringIO(response.text))
        if "observation_date" not in frame.columns or series_id not in frame.columns:
            raise CrossAssetDataError(f"FRED CSV malformed for {series_id}")
        frame["timestamp"] = pd.to_datetime(frame["observation_date"], utc=True)
        frame[series_id] = pd.to_numeric(frame[series_id], errors="coerce")
        frame = frame.dropna(subset=[series_id]).set_index("timestamp")[[series_id]]
        return frame[~frame.index.duplicated(keep="last")].sort_index()

    def _normalize_series(self, *, crypto_frames: dict[str, pd.DataFrame], macro_frame: pd.DataFrame) -> pd.DataFrame:
        close_prices = pd.concat(
            [frame["close"].astype(float).rename(symbol) for symbol, frame in crypto_frames.items()],
            axis=1,
            join="inner",
        ).dropna(how="any")
        if close_prices.shape[1] < 2 or len(close_prices) < 120:
            raise CrossAssetDataError("not enough aligned crypto close history")
        macro_hourly = macro_frame.reindex(close_prices.index, method="ffill")
        aligned = pd.concat([close_prices, macro_hourly], axis=1, join="inner").dropna(how="any")
        if len(aligned) < 120:
            raise CrossAssetDataError("not enough aligned cross-asset observations")
        return aligned

    def _macro_snapshots(self, macro_frame: pd.DataFrame) -> list[MacroSeriesSnapshot]:
        snapshots: list[MacroSeriesSnapshot] = []
        for alias, (series_id, name) in self.FRED_SERIES.items():
            series = macro_frame[alias].dropna()
            if series.empty:
                continue
            latest_date = series.index[-1].to_pydatetime().astimezone(UTC)
            latest_value = float(series.iloc[-1])
            snapshots.append(
                MacroSeriesSnapshot(
                    series_id=series_id,
                    name=name,
                    latest_value=round(latest_value, 8),
                    latest_date=latest_date,
                    change_1m=self._period_change(series, periods=21),
                    change_3m=self._period_change(series, periods=63),
                    source=f"{self.fred_graph_base_url}/graph/fredgraph.csv?id={series_id}",
                )
            )
        return snapshots

    def _period_change(self, series: pd.Series, *, periods: int) -> float | None:
        clean = series.dropna()
        if len(clean) <= periods:
            return None
        return round(float(clean.iloc[-1] - clean.iloc[-periods - 1]), 8)
