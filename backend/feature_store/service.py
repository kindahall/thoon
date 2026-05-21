from __future__ import annotations

import asyncio
import hashlib
import io
import json
import math
import os
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import numpy as np
import pandas as pd

from data_quality.engine import DataQualityEngine
from data_quality.schemas import DataQualityRequest
from feature_store.schemas import FeatureSetRecord, FeatureStoreRequest
from feature_store.storage import PostgresFeatureStore
from macro_quant.data_engine import CrossAssetDataEngine
from rl.data_loader import RLMarketDataLoader, normalize_market_error


class FeatureStoreError(RuntimeError):
    pass


class FeatureStoreService:
    FEATURE_SCHEMA_VERSION = "feature_store.v1"

    def __init__(
        self,
        *,
        market_loader: RLMarketDataLoader | None = None,
        quality_engine: DataQualityEngine | None = None,
        storage: PostgresFeatureStore | None = None,
        fred_graph_base_url: str | None = None,
        binance_futures_base_url: str | None = None,
        bybit_market_base_url: str | None = None,
    ) -> None:
        self.market_loader = market_loader or RLMarketDataLoader()
        self.quality_engine = quality_engine or DataQualityEngine()
        self.storage = storage or PostgresFeatureStore()
        self.fred_graph_base_url = fred_graph_base_url or os.getenv("FRED_GRAPH_BASE_URL", "https://fred.stlouisfed.org")
        self.binance_futures_base_url = binance_futures_base_url or os.getenv(
            "BINANCE_FUTURES_BASE_URL",
            "https://fapi.binance.com",
        )
        self.bybit_market_base_url = bybit_market_base_url or os.getenv("BYBIT_MARKET_BASE_URL", "https://api.bybit.com")

    async def compute(self, request: FeatureStoreRequest) -> FeatureSetRecord:
        frames = await self._load_market_frames(request)
        market_features = {
            symbol: self._symbol_features(frame)
            for symbol, frame in frames.items()
        }
        correlations = self._correlations(frames)
        macro_factors = await self._macro_factors(request) if request.include_macro_factors else {"available": False}
        derivatives = (
            await self._derivatives(exchange=request.exchange, symbols=request.symbols)
            if request.include_derivatives
            else {"available": False}
        )
        rows_by_symbol = {symbol: len(frame) for symbol, frame in frames.items()}
        data_start = min(frame.index[0].to_pydatetime() for frame in frames.values()).astimezone(UTC)
        data_end = max(frame.index[-1].to_pydatetime() for frame in frames.values()).astimezone(UTC)
        data_sources = self._data_sources(request)
        features = self._sanitize(
            {
                "market": market_features,
                "correlations": correlations,
                "macro_factors": macro_factors,
                "derivatives": derivatives,
            }
        )
        feature_set_key = self._feature_set_key(request)
        content_hash = self._content_hash(
            {
                "request": request.model_dump(mode="json"),
                "rows_by_symbol": rows_by_symbol,
                "data_start": data_start.isoformat(),
                "data_end": data_end.isoformat(),
                "features": features,
                "schema": self.FEATURE_SCHEMA_VERSION,
            }
        )
        created_at = datetime.now(UTC)
        if request.persist:
            version = self.storage.next_version(feature_set_key)
            feature_set_id = f"fs_{self._short_hash(feature_set_key)}_v{version}_{content_hash[:10]}"
        else:
            version = 0
            feature_set_id = f"fs_preview_{content_hash[:20]}"
        record = FeatureSetRecord(
            feature_set_id=feature_set_id,
            feature_set_key=feature_set_key,
            version=version,
            feature_schema_version=self.FEATURE_SCHEMA_VERSION,
            exchange=request.exchange,
            symbols=request.symbols,
            interval=request.interval,
            lookback=request.lookback,
            rows_by_symbol=rows_by_symbol,
            data_start=data_start,
            data_end=data_end,
            data_sources=data_sources,
            features=features,
            content_hash=content_hash,
            persisted=request.persist,
            created_at=created_at,
        )
        if request.persist:
            return self.storage.insert_feature_set(record, request)
        return record

    def get_feature_set(self, feature_set_id: str) -> FeatureSetRecord:
        return self.storage.get_feature_set(feature_set_id)

    def latest(self, request: FeatureStoreRequest | None = None) -> FeatureSetRecord:
        feature_set_key = self._feature_set_key(request) if request is not None else None
        return self.storage.latest(
            feature_set_key=feature_set_key,
            exchange=request.exchange if request is not None else None,
            interval=request.interval if request is not None else None,
        )

    def list_feature_sets(self, *, limit: int = 50, exchange: str | None = None) -> list[FeatureSetRecord]:
        return self.storage.list_feature_sets(limit=limit, exchange=exchange)

    async def _load_market_frames(self, request: FeatureStoreRequest) -> dict[str, pd.DataFrame]:
        async def load_symbol(symbol: str) -> tuple[str, pd.DataFrame]:
            try:
                frame = await self.market_loader.download_ohlcv(
                    exchange=request.exchange,
                    symbol=symbol,
                    interval=request.interval,
                    limit=request.lookback,
                )
            except Exception as error:
                raise normalize_market_error(error) from error
            if frame.empty:
                raise FeatureStoreError(f"{request.exchange} returned no OHLCV rows for {symbol}")
            quality = self.quality_engine.evaluate_frame(
                request=DataQualityRequest(
                    exchange=request.exchange,
                    symbol=symbol,
                    interval=request.interval,
                    limit=request.lookback,
                    compare_cross_exchange=False,
                ),
                frame=frame,
            )
            if not quality.usable_for_backtest:
                issue_codes = ", ".join(issue.code for issue in quality.issues) or "quality_score_below_threshold"
                raise FeatureStoreError(f"feature store blocked by data quality for {symbol}: {issue_codes}")
            return symbol, frame

        loaded = await asyncio.gather(*(load_symbol(symbol) for symbol in request.symbols))
        return dict(loaded)

    def _symbol_features(self, frame: pd.DataFrame) -> dict[str, Any]:
        close = frame["close"].astype(float)
        open_ = frame["open"].astype(float)
        high = frame["high"].astype(float)
        low = frame["low"].astype(float)
        volume = frame["volume"].astype(float)
        quote_volume = frame.get("quote_asset_volume", close * volume).astype(float)
        log_returns = np.log(close / close.shift(1)).replace([np.inf, -np.inf], np.nan)
        periods_per_year = self._periods_per_year(close.index)
        latest_close = float(close.iloc[-1])
        rolling_high = close.cummax()
        drawdown = (close / rolling_high) - 1.0
        volume_mean_30 = volume.rolling(30, min_periods=10).mean()
        volume_std_30 = volume.rolling(30, min_periods=10).std(ddof=1).replace(0.0, np.nan)
        quote_volume_mean_20 = quote_volume.rolling(20, min_periods=10).mean()
        return {
            "latest": {
                "timestamp": close.index[-1].isoformat(),
                "open": self._round(open_.iloc[-1]),
                "high": self._round(high.iloc[-1]),
                "low": self._round(low.iloc[-1]),
                "close": self._round(latest_close),
                "volume": self._round(volume.iloc[-1]),
                "quote_volume": self._round(quote_volume.iloc[-1]),
            },
            "momentum": {
                "return_1": self._period_return(close, 1),
                "return_3": self._period_return(close, 3),
                "return_6": self._period_return(close, 6),
                "return_12": self._period_return(close, 12),
                "return_24": self._period_return(close, 24),
                "return_72": self._period_return(close, 72),
                "sma_20_ratio": self._sma_ratio(close, 20),
                "sma_50_ratio": self._sma_ratio(close, 50),
            },
            "volatility": {
                "realized_10": self._annualized_volatility(log_returns, 10, periods_per_year),
                "realized_30": self._annualized_volatility(log_returns, 30, periods_per_year),
                "realized_90": self._annualized_volatility(log_returns, 90, periods_per_year),
                "range_latest": self._round((high.iloc[-1] - low.iloc[-1]) / latest_close),
                "current_drawdown": self._round(drawdown.iloc[-1]),
                "max_drawdown": self._round(drawdown.min()),
            },
            "volume": {
                "volume_sma_20": self._rolling_latest(volume, 20),
                "volume_zscore_30": self._round((volume.iloc[-1] - volume_mean_30.iloc[-1]) / volume_std_30.iloc[-1]),
                "quote_volume_sma_20": self._round(quote_volume_mean_20.iloc[-1]),
                "quote_volume_change_20": self._period_return(quote_volume, 20),
                "liquidity_score": self._round(max(0.0, min(1.0, math.log10(max(float(quote_volume.iloc[-1]), 1.0)) / 10.0))),
            },
        }

    def _correlations(self, frames: dict[str, pd.DataFrame]) -> dict[str, Any]:
        if len(frames) < 2:
            return {}
        returns = pd.concat(
            [frame["close"].astype(float).pct_change().rename(symbol) for symbol, frame in frames.items()],
            axis=1,
            join="inner",
        ).dropna(how="any")
        output: dict[str, Any] = {}
        symbols = list(frames.keys())
        for left_index, left in enumerate(symbols):
            for right in symbols[left_index + 1 :]:
                key = f"{left}:{right}"
                pair: dict[str, float | None] = {}
                for window in (30, 90):
                    rolling = returns[left].rolling(window, min_periods=max(10, window // 3)).corr(returns[right]).dropna()
                    pair[f"rolling_{window}"] = self._round(rolling.iloc[-1]) if not rolling.empty else None
                pair["full_sample"] = self._round(returns[left].corr(returns[right])) if len(returns) >= 10 else None
                output[key] = pair
        return output

    async def _macro_factors(self, request: FeatureStoreRequest) -> dict[str, Any]:
        start_date = (datetime.now(UTC) - timedelta(days=request.macro_lookback_days)).date().isoformat()

        async def fetch(alias: str, series_id: str, name: str) -> tuple[str, dict[str, Any]]:
            try:
                series = await self._fetch_fred_series(series_id, start_date=start_date)
            except Exception as error:
                return alias, {
                    "available": False,
                    "series_id": series_id,
                    "name": name,
                    "source": f"{self.fred_graph_base_url}/graph/fredgraph.csv?id={series_id}",
                    "error": str(error),
                }
            return alias, {
                "available": True,
                "series_id": series_id,
                "name": name,
                "latest_value": self._round(series.iloc[-1]),
                "latest_date": series.index[-1].isoformat(),
                "change_1m": self._series_change(series, 21),
                "change_3m": self._series_change(series, 63),
                "change_12_obs": self._series_change(series, 12),
                "source": f"{self.fred_graph_base_url}/graph/fredgraph.csv?id={series_id}",
            }

        loaded = await asyncio.gather(
            *(
                fetch(alias, series_id, name)
                for alias, (series_id, name) in CrossAssetDataEngine.FRED_SERIES.items()
            )
        )
        factors = dict(loaded)
        return {
            "available": any(item.get("available") for item in factors.values()),
            "factors": factors,
        }

    async def _fetch_fred_series(self, series_id: str, *, start_date: str) -> pd.Series:
        async with httpx.AsyncClient(base_url=self.fred_graph_base_url, timeout=20) as client:
            response = await client.get("/graph/fredgraph.csv", params={"id": series_id})
            response.raise_for_status()
        frame = pd.read_csv(io.StringIO(response.text))
        if "observation_date" not in frame.columns or series_id not in frame.columns:
            raise FeatureStoreError(f"FRED CSV malformed for {series_id}")
        frame["timestamp"] = pd.to_datetime(frame["observation_date"], utc=True)
        frame[series_id] = pd.to_numeric(frame[series_id], errors="coerce")
        series = frame.dropna(subset=[series_id]).set_index("timestamp")[series_id].sort_index()
        series = series[series.index >= pd.Timestamp(start_date, tz="UTC")]
        if series.empty:
            raise FeatureStoreError(f"FRED returned no recent observations for {series_id}")
        return series

    async def _derivatives(self, *, exchange: str, symbols: list[str]) -> dict[str, Any]:
        if exchange == "binance":
            values = await asyncio.gather(*(self._binance_derivatives(symbol) for symbol in symbols))
        else:
            values = await asyncio.gather(*(self._bybit_derivatives(symbol) for symbol in symbols))
        return {
            "available": any(item.get("available") for item in values),
            "by_symbol": {symbol: item for symbol, item in zip(symbols, values, strict=True)},
        }

    async def _binance_derivatives(self, symbol: str) -> dict[str, Any]:
        async with httpx.AsyncClient(base_url=self.binance_futures_base_url, timeout=15) as client:
            try:
                funding_response, oi_response = await asyncio.gather(
                    client.get("/fapi/v1/fundingRate", params={"symbol": symbol, "limit": 1}),
                    client.get("/fapi/v1/openInterest", params={"symbol": symbol}),
                )
                funding_response.raise_for_status()
                oi_response.raise_for_status()
                funding_payload = funding_response.json()
                oi_payload = oi_response.json()
            except Exception as error:
                return {
                    "available": False,
                    "source": self.binance_futures_base_url,
                    "error": str(error),
                }
        latest_funding = funding_payload[-1] if funding_payload else {}
        return {
            "available": bool(latest_funding) or bool(oi_payload),
            "funding_rate": self._round(latest_funding.get("fundingRate")),
            "funding_time": self._ms_to_iso(latest_funding.get("fundingTime")),
            "open_interest": self._round(oi_payload.get("openInterest")),
            "open_interest_time": self._ms_to_iso(oi_payload.get("time")),
            "source": self.binance_futures_base_url,
        }

    async def _bybit_derivatives(self, symbol: str) -> dict[str, Any]:
        async with httpx.AsyncClient(base_url=self.bybit_market_base_url, timeout=15) as client:
            try:
                funding_response, oi_response = await asyncio.gather(
                    client.get("/v5/market/funding/history", params={"category": "linear", "symbol": symbol, "limit": 1}),
                    client.get(
                        "/v5/market/open-interest",
                        params={"category": "linear", "symbol": symbol, "intervalTime": "1h", "limit": 1},
                    ),
                )
                funding_response.raise_for_status()
                oi_response.raise_for_status()
                funding_payload = funding_response.json()
                oi_payload = oi_response.json()
            except Exception as error:
                return {
                    "available": False,
                    "source": self.bybit_market_base_url,
                    "error": str(error),
                }
        funding_rows = funding_payload.get("result", {}).get("list", []) if str(funding_payload.get("retCode")) == "0" else []
        oi_rows = oi_payload.get("result", {}).get("list", []) if str(oi_payload.get("retCode")) == "0" else []
        latest_funding = funding_rows[0] if funding_rows else {}
        latest_oi = oi_rows[0] if oi_rows else {}
        return {
            "available": bool(latest_funding) or bool(latest_oi),
            "funding_rate": self._round(latest_funding.get("fundingRate")),
            "funding_time": self._ms_to_iso(latest_funding.get("fundingRateTimestamp")),
            "open_interest": self._round(latest_oi.get("openInterest")),
            "open_interest_time": self._ms_to_iso(latest_oi.get("timestamp")),
            "source": self.bybit_market_base_url,
        }

    def _data_sources(self, request: FeatureStoreRequest) -> list[str]:
        sources = [f"{request.exchange}_official_ohlcv"]
        if request.include_macro_factors:
            sources.append(f"{self.fred_graph_base_url}/graph/fredgraph.csv")
        if request.include_derivatives:
            if request.exchange == "binance":
                sources.append(f"{self.binance_futures_base_url}/fapi/v1/fundingRate")
                sources.append(f"{self.binance_futures_base_url}/fapi/v1/openInterest")
            else:
                sources.append(f"{self.bybit_market_base_url}/v5/market/funding/history")
                sources.append(f"{self.bybit_market_base_url}/v5/market/open-interest")
        return sources

    def _feature_set_key(self, request: FeatureStoreRequest) -> str:
        symbols = ",".join(request.symbols)
        return (
            f"{request.exchange}:{symbols}:{request.interval}:{request.lookback}:"
            f"macro={request.include_macro_factors}:derivatives={request.include_derivatives}:"
            f"schema={self.FEATURE_SCHEMA_VERSION}"
        )

    def _content_hash(self, payload: dict[str, Any]) -> str:
        serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        return hashlib.sha256(serialized.encode()).hexdigest()

    def _short_hash(self, value: str) -> str:
        return hashlib.sha256(value.encode()).hexdigest()[:10]

    def _periods_per_year(self, index: pd.Index) -> float:
        if len(index) < 2:
            return 365.0
        deltas = pd.Series(index).diff().dropna()
        median_seconds = float(deltas.median().total_seconds())
        if median_seconds <= 0:
            return 365.0
        return (365.0 * 24.0 * 60.0 * 60.0) / median_seconds

    def _period_return(self, series: pd.Series, periods: int) -> float | None:
        if len(series) <= periods:
            return None
        previous = float(series.iloc[-periods - 1])
        latest = float(series.iloc[-1])
        if previous == 0:
            return None
        return self._round((latest / previous) - 1.0)

    def _sma_ratio(self, series: pd.Series, window: int) -> float | None:
        if len(series) < window:
            return None
        sma = float(series.rolling(window, min_periods=window).mean().iloc[-1])
        if sma == 0 or math.isnan(sma):
            return None
        return self._round((float(series.iloc[-1]) / sma) - 1.0)

    def _annualized_volatility(self, returns: pd.Series, window: int, periods_per_year: float) -> float | None:
        if len(returns.dropna()) < max(5, window // 3):
            return None
        realized = returns.rolling(window, min_periods=max(5, window // 3)).std(ddof=1).iloc[-1]
        if pd.isna(realized):
            return None
        return self._round(float(realized) * math.sqrt(periods_per_year) * 100.0)

    def _rolling_latest(self, series: pd.Series, window: int) -> float | None:
        value = series.rolling(window, min_periods=max(2, window // 2)).mean().iloc[-1]
        return self._round(value)

    def _series_change(self, series: pd.Series, periods: int) -> float | None:
        clean = series.dropna()
        if len(clean) <= periods:
            return None
        return self._round(float(clean.iloc[-1] - clean.iloc[-periods - 1]))

    def _ms_to_iso(self, value: Any) -> str | None:
        if value in (None, ""):
            return None
        try:
            return datetime.fromtimestamp(int(value) / 1000.0, tz=UTC).isoformat()
        except (TypeError, ValueError, OSError):
            return None

    def _round(self, value: Any) -> float | None:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(numeric):
            return None
        return round(numeric, 10)

    def _sanitize(self, value: Any) -> Any:
        if isinstance(value, dict):
            return {str(key): self._sanitize(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self._sanitize(item) for item in value]
        if isinstance(value, tuple):
            return [self._sanitize(item) for item in value]
        if isinstance(value, (np.integer,)):
            return int(value)
        if isinstance(value, (np.floating,)):
            return self._round(value)
        if isinstance(value, pd.Timestamp):
            return value.isoformat()
        return value
