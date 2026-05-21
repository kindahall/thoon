from __future__ import annotations

import math

import numpy as np
import pandas as pd

from research_platform.schemas import RegimeName, RegimePerformance


class RegimeAnalysisModule:
    REGIMES: tuple[RegimeName, ...] = ("bull_market", "bear_market", "high_volatility", "low_liquidity")

    def breakdown(self, *, ohlcv: pd.DataFrame, portfolio_value: pd.Series) -> dict[RegimeName, RegimePerformance]:
        close = ohlcv["close"].astype(float)
        volume = ohlcv["volume"].astype(float)
        market_returns = close.pct_change().replace([np.inf, -np.inf], np.nan).fillna(0.0)
        strategy_returns = portfolio_value.astype(float).pct_change().replace([np.inf, -np.inf], np.nan).fillna(0.0)
        labels = self._labels(close=close, volume=volume)
        result: dict[RegimeName, RegimePerformance] = {}
        for regime in self.REGIMES:
            mask = labels[regime].reindex(close.index, fill_value=False)
            regime_market_returns = market_returns.loc[mask]
            regime_strategy_returns = strategy_returns.reindex(close.index, fill_value=0.0).loc[mask]
            regime_volume = volume.loc[mask]
            rows = int(mask.sum())
            if rows == 0:
                result[regime] = RegimePerformance(
                    regime=regime,
                    rows=0,
                    bar_ratio=0.0,
                    strategy_return=0.0,
                    market_return=0.0,
                    realized_volatility=0.0,
                    average_volume=0.0,
                    liquidity_score=0.0,
                )
                continue
            strategy_return = float(np.prod(1.0 + regime_strategy_returns.to_numpy(dtype=float)) - 1.0)
            market_return = float(np.prod(1.0 + regime_market_returns.to_numpy(dtype=float)) - 1.0)
            realized_volatility = self._realized_volatility(regime_market_returns)
            average_volume = float(regime_volume.mean())
            median_volume = float(volume.median()) if float(volume.median()) > 0 else 0.0
            liquidity_score = 0.0 if median_volume == 0 else max(0.0, average_volume / median_volume)
            result[regime] = RegimePerformance(
                regime=regime,
                rows=rows,
                bar_ratio=round(float(rows / len(close)), 8),
                strategy_return=round(strategy_return, 8),
                market_return=round(market_return, 8),
                realized_volatility=round(realized_volatility, 8),
                average_volume=round(average_volume, 8),
                liquidity_score=round(liquidity_score, 8),
            )
        return result

    def _labels(self, *, close: pd.Series, volume: pd.Series) -> pd.DataFrame:
        lookback = max(12, min(72, len(close) // 6))
        trend_return = close.pct_change(lookback).replace([np.inf, -np.inf], np.nan).fillna(0.0)
        market_returns = close.pct_change().replace([np.inf, -np.inf], np.nan)
        rolling_vol = market_returns.rolling(lookback, min_periods=max(3, lookback // 3)).std().fillna(0.0)
        high_vol_threshold = float(rolling_vol.quantile(0.75))
        low_liquidity_threshold = float(volume.quantile(0.25))
        return pd.DataFrame(
            {
                "bull_market": trend_return > 0,
                "bear_market": trend_return < 0,
                "high_volatility": rolling_vol >= high_vol_threshold,
                "low_liquidity": volume <= low_liquidity_threshold,
            },
            index=close.index,
        )

    def _realized_volatility(self, returns: pd.Series) -> float:
        clean = returns.replace([np.inf, -np.inf], np.nan).dropna()
        if len(clean) < 2:
            return 0.0
        periods = min(365 * 24, max(1, len(clean)))
        return float(clean.std(ddof=1) * math.sqrt(periods))
