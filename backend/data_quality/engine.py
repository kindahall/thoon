from __future__ import annotations

import math

import numpy as np
import pandas as pd

from data_quality.schemas import (
    CrossExchangeComparison,
    DataQualityIssue,
    DataQualityRequest,
    DataQualityResult,
    ExchangeName,
)
from rl.data_loader import MarketDataError, RLMarketDataLoader


class DataQualityError(RuntimeError):
    pass


class DataQualityEngine:
    INTERVAL_SECONDS = {
        "1s": 1,
        "1m": 60,
        "3m": 180,
        "5m": 300,
        "15m": 900,
        "30m": 1800,
        "1h": 3600,
        "2h": 7200,
        "4h": 14400,
        "6h": 21600,
        "8h": 28800,
        "12h": 43200,
        "1d": 86400,
        "3d": 259200,
        "1w": 604800,
    }

    REQUIRED_COLUMNS = ("open", "high", "low", "close", "volume")

    def __init__(self, *, market_loader: RLMarketDataLoader | None = None) -> None:
        self.market_loader = market_loader or RLMarketDataLoader()

    async def check(self, request: DataQualityRequest) -> DataQualityResult:
        primary = await self.market_loader.download_ohlcv(
            exchange=request.exchange,
            symbol=request.symbol,
            interval=request.interval,
            limit=request.limit,
        )
        comparison = None
        if request.compare_cross_exchange:
            comparison = await self._cross_exchange_comparison(request=request, primary=primary)
        return self.evaluate_frame(request=request, frame=primary, comparison=comparison)

    def evaluate_frame(
        self,
        *,
        request: DataQualityRequest,
        frame: pd.DataFrame,
        comparison: CrossExchangeComparison | None = None,
    ) -> DataQualityResult:
        expected_seconds = self._expected_seconds(request.interval)
        issues: list[DataQualityIssue] = []
        clean = self._validate_frame(frame)
        issues.extend(self._timestamp_issues(clean, expected_seconds=expected_seconds, request=request))
        issues.extend(self._ohlc_issues(clean))
        issues.extend(self._volume_issues(clean, request=request))
        issues.extend(self._return_issues(clean, request=request))
        issues.extend(self._range_issues(clean))
        if comparison is not None:
            issues.extend(comparison.issues)

        quality_score = self._quality_score(issues)
        usable = quality_score >= request.min_quality_score and not any(issue.severity == "error" for issue in issues)
        return DataQualityResult(
            exchange=request.exchange,
            symbol=request.symbol,
            interval=request.interval,
            rows=len(clean),
            start=clean.index[0].to_pydatetime() if len(clean) else None,
            end=clean.index[-1].to_pydatetime() if len(clean) else None,
            expected_interval_seconds=expected_seconds,
            quality_score=quality_score,
            usable_for_backtest=usable,
            issues=issues,
            comparison=comparison,
        )

    async def _cross_exchange_comparison(
        self,
        *,
        request: DataQualityRequest,
        primary: pd.DataFrame,
    ) -> CrossExchangeComparison:
        secondary_exchange: ExchangeName = "bybit" if request.exchange == "binance" else "binance"
        issues: list[DataQualityIssue] = []
        try:
            secondary = await self.market_loader.download_ohlcv(
                exchange=secondary_exchange,
                symbol=request.symbol,
                interval=request.interval,
                limit=request.limit,
            )
        except (MarketDataError, Exception) as error:
            issues.append(
                DataQualityIssue(
                    code="cross_exchange_unavailable",
                    severity="warning",
                    message=f"{secondary_exchange} comparison unavailable: {error}",
                )
            )
            return CrossExchangeComparison(
                status="unavailable",
                primary_exchange=request.exchange,
                secondary_exchange=secondary_exchange,
                aligned_rows=0,
                latest_close_deviation_bps=None,
                median_close_deviation_bps=None,
                max_close_deviation_bps=None,
                close_return_correlation=None,
                issues=issues,
            )

        primary_close = primary["close"].astype(float).rename("primary")
        secondary_close = secondary["close"].astype(float).rename("secondary")
        aligned = pd.concat([primary_close, secondary_close], axis=1, join="inner").dropna(how="any")
        if len(aligned) < max(20, min(100, request.limit // 5)):
            issues.append(
                DataQualityIssue(
                    code="cross_exchange_insufficient_overlap",
                    severity="warning",
                    message="not enough overlapping candles between exchanges",
                    count=len(aligned),
                    threshold=float(max(20, min(100, request.limit // 5))),
                )
            )
            return CrossExchangeComparison(
                status="insufficient_overlap",
                primary_exchange=request.exchange,
                secondary_exchange=secondary_exchange,
                aligned_rows=len(aligned),
                latest_close_deviation_bps=None,
                median_close_deviation_bps=None,
                max_close_deviation_bps=None,
                close_return_correlation=None,
                issues=issues,
            )

        denominator = aligned.mean(axis=1)
        deviations = ((aligned["primary"] - aligned["secondary"]).abs() / denominator * 10_000).replace([np.inf, -np.inf], np.nan).dropna()
        primary_returns = aligned["primary"].pct_change()
        secondary_returns = aligned["secondary"].pct_change()
        correlation = primary_returns.corr(secondary_returns)
        latest_deviation = float(deviations.iloc[-1])
        median_deviation = float(deviations.median())
        max_deviation = float(deviations.max())
        if latest_deviation > request.max_cross_exchange_close_deviation_bps:
            issues.append(
                DataQualityIssue(
                    code="cross_exchange_latest_close_deviation",
                    severity="error",
                    message="latest close deviates too much between exchanges",
                    metric=round(latest_deviation, 8),
                    threshold=request.max_cross_exchange_close_deviation_bps,
                )
            )
        if median_deviation > request.max_cross_exchange_close_deviation_bps:
            issues.append(
                DataQualityIssue(
                    code="cross_exchange_median_close_deviation",
                    severity="warning",
                    message="median close deviation between exchanges is elevated",
                    metric=round(median_deviation, 8),
                    threshold=request.max_cross_exchange_close_deviation_bps,
                )
            )
        if not pd.isna(correlation) and float(correlation) < 0.75:
            issues.append(
                DataQualityIssue(
                    code="cross_exchange_return_correlation_low",
                    severity="warning",
                    message="cross-exchange close returns correlation is low",
                    metric=round(float(correlation), 8),
                    threshold=0.75,
                )
            )
        return CrossExchangeComparison(
            status="available",
            primary_exchange=request.exchange,
            secondary_exchange=secondary_exchange,
            aligned_rows=len(aligned),
            latest_close_deviation_bps=round(latest_deviation, 8),
            median_close_deviation_bps=round(median_deviation, 8),
            max_close_deviation_bps=round(max_deviation, 8),
            close_return_correlation=None if pd.isna(correlation) else round(float(correlation), 8),
            issues=issues,
        )

    def _validate_frame(self, frame: pd.DataFrame) -> pd.DataFrame:
        if frame.empty:
            raise DataQualityError("market data frame is empty")
        missing_columns = [column for column in self.REQUIRED_COLUMNS if column not in frame.columns]
        if missing_columns:
            raise DataQualityError(f"market data missing columns: {', '.join(missing_columns)}")
        clean = frame.copy()
        if clean.index.tz is None:
            clean.index = clean.index.tz_localize("UTC")
        clean = clean.sort_index()
        for column in self.REQUIRED_COLUMNS:
            clean[column] = pd.to_numeric(clean[column], errors="raise")
        return clean

    def _timestamp_issues(
        self,
        frame: pd.DataFrame,
        *,
        expected_seconds: int,
        request: DataQualityRequest,
    ) -> list[DataQualityIssue]:
        issues: list[DataQualityIssue] = []
        duplicate_count = int(frame.index.duplicated().sum())
        if duplicate_count:
            issues.append(
                DataQualityIssue(
                    code="duplicate_timestamps",
                    severity="error",
                    message="duplicate candle timestamps detected",
                    count=duplicate_count,
                )
            )
        if not frame.index.is_monotonic_increasing:
            issues.append(
                DataQualityIssue(
                    code="timestamps_not_monotonic",
                    severity="error",
                    message="candle timestamps are not strictly increasing",
                )
            )
        diffs = frame.index.to_series().diff().dropna().dt.total_seconds()
        if diffs.empty:
            return issues
        missing = int(((diffs / expected_seconds).round().clip(lower=1) - 1).sum())
        missing_ratio = missing / max(1, len(frame) + missing)
        if missing_ratio > request.max_missing_ratio:
            issues.append(
                DataQualityIssue(
                    code="missing_candles",
                    severity="error",
                    message="missing candle ratio exceeds threshold",
                    count=missing,
                    metric=round(float(missing_ratio), 8),
                    threshold=request.max_missing_ratio,
                )
            )
        elif missing:
            issues.append(
                DataQualityIssue(
                    code="missing_candles",
                    severity="warning",
                    message="missing candles detected",
                    count=missing,
                    metric=round(float(missing_ratio), 8),
                    threshold=request.max_missing_ratio,
                )
            )
        irregular = int(((diffs - expected_seconds).abs() > max(1.0, expected_seconds * 0.05)).sum())
        if irregular:
            issues.append(
                DataQualityIssue(
                    code="irregular_intervals",
                    severity="warning",
                    message="candle interval deviations detected",
                    count=irregular,
                    metric=round(float(irregular / max(1, len(diffs))), 8),
                    threshold=0.0,
                )
            )
        return issues

    def _ohlc_issues(self, frame: pd.DataFrame) -> list[DataQualityIssue]:
        issues: list[DataQualityIssue] = []
        non_positive = int((frame[["open", "high", "low", "close"]] <= 0).any(axis=1).sum())
        if non_positive:
            issues.append(
                DataQualityIssue(
                    code="non_positive_prices",
                    severity="error",
                    message="non-positive OHLC prices detected",
                    count=non_positive,
                )
            )
        invalid_ohlc = (
            (frame["high"] < frame[["open", "close", "low"]].max(axis=1))
            | (frame["low"] > frame[["open", "close", "high"]].min(axis=1))
        )
        invalid_count = int(invalid_ohlc.sum())
        if invalid_count:
            issues.append(
                DataQualityIssue(
                    code="invalid_ohlc_relationship",
                    severity="error",
                    message="OHLC relationship is invalid",
                    count=invalid_count,
                )
            )
        return issues

    def _volume_issues(self, frame: pd.DataFrame, *, request: DataQualityRequest) -> list[DataQualityIssue]:
        issues: list[DataQualityIssue] = []
        negative_volume = int((frame["volume"] < 0).sum())
        if negative_volume:
            issues.append(
                DataQualityIssue(
                    code="negative_volume",
                    severity="error",
                    message="negative volume detected",
                    count=negative_volume,
                )
            )
        zero_ratio = float((frame["volume"] == 0).sum() / max(1, len(frame)))
        if zero_ratio > request.max_zero_volume_ratio:
            issues.append(
                DataQualityIssue(
                    code="zero_volume_ratio",
                    severity="error",
                    message="zero-volume candle ratio exceeds threshold",
                    count=int((frame["volume"] == 0).sum()),
                    metric=round(zero_ratio, 8),
                    threshold=request.max_zero_volume_ratio,
                )
            )
        anomalous_volume = self._robust_outliers(frame["volume"], threshold=12.0)
        if anomalous_volume > 0:
            issues.append(
                DataQualityIssue(
                    code="anomalous_volume",
                    severity="warning",
                    message="volume outliers detected by robust z-score",
                    count=anomalous_volume,
                    threshold=12.0,
                )
            )
        return issues

    def _return_issues(self, frame: pd.DataFrame, *, request: DataQualityRequest) -> list[DataQualityIssue]:
        issues: list[DataQualityIssue] = []
        returns_bps = frame["close"].pct_change().abs().replace([np.inf, -np.inf], np.nan).dropna() * 10_000
        if returns_bps.empty:
            return issues
        extreme_returns = int((returns_bps > request.max_single_bar_return_bps).sum())
        if extreme_returns:
            issues.append(
                DataQualityIssue(
                    code="extreme_single_bar_returns",
                    severity="warning",
                    message="single-bar close returns exceed threshold",
                    count=extreme_returns,
                    metric=round(float(returns_bps.max()), 8),
                    threshold=request.max_single_bar_return_bps,
                )
            )
        robust_outliers = self._robust_outliers(returns_bps, threshold=10.0)
        if robust_outliers:
            issues.append(
                DataQualityIssue(
                    code="return_outliers",
                    severity="warning",
                    message="close-return outliers detected by robust z-score",
                    count=robust_outliers,
                    threshold=10.0,
                )
            )
        return issues

    def _range_issues(self, frame: pd.DataFrame) -> list[DataQualityIssue]:
        issues: list[DataQualityIssue] = []
        close = frame["close"].replace(0.0, np.nan)
        range_bps = ((frame["high"] - frame["low"]) / close * 10_000).replace([np.inf, -np.inf], np.nan).dropna()
        anomalous_range = self._robust_outliers(range_bps, threshold=12.0)
        if anomalous_range:
            issues.append(
                DataQualityIssue(
                    code="anomalous_high_low_range",
                    severity="warning",
                    message="high-low candle range outliers detected",
                    count=anomalous_range,
                    threshold=12.0,
                )
            )
        return issues

    def _quality_score(self, issues: list[DataQualityIssue]) -> float:
        score = 1.0
        for issue in issues:
            if issue.severity == "error":
                score -= 0.22
            elif issue.severity == "warning":
                score -= 0.06
            else:
                score -= 0.015
            if issue.metric is not None and issue.threshold not in (None, 0):
                score -= min(0.08, max(0.0, float(issue.metric) / float(issue.threshold) - 1.0) * 0.04)
        return round(float(np.clip(score, 0.0, 1.0)), 8)

    def _robust_outliers(self, series: pd.Series, *, threshold: float) -> int:
        clean = series.astype(float).replace([np.inf, -np.inf], np.nan).dropna()
        if len(clean) < 20:
            return 0
        median = float(clean.median())
        mad = float((clean - median).abs().median())
        if mad == 0 or math.isnan(mad):
            return 0
        robust_z = 0.6745 * (clean - median).abs() / mad
        return int((robust_z > threshold).sum())

    def _expected_seconds(self, interval: str) -> int:
        if interval not in self.INTERVAL_SECONDS:
            raise DataQualityError(f"unsupported interval for quality check: {interval}")
        return self.INTERVAL_SECONDS[interval]
