from __future__ import annotations

import numpy as np
import pandas as pd

from macro_quant.schemas import MacroRegime


class MacroRegimeDetector:
    def detect(self, *, aligned: pd.DataFrame, crypto_symbols: list[str]) -> tuple[MacroRegime, dict[str, float], pd.Series]:
        scores = self._scores(aligned=aligned, crypto_symbols=crypto_symbols)
        regime = max(scores, key=lambda key: scores[key])
        mask = self._regime_mask(aligned=aligned, regime=regime, crypto_symbols=crypto_symbols)
        return regime, scores, mask

    def _scores(self, *, aligned: pd.DataFrame, crypto_symbols: list[str]) -> dict[MacroRegime, float]:
        crypto_returns = aligned[crypto_symbols].pct_change().dropna()
        crypto_trend = float((aligned[crypto_symbols].iloc[-1] / aligned[crypto_symbols].iloc[max(0, len(aligned) - 168)] - 1.0).mean())
        crypto_vol = float(crypto_returns.tail(168).std(ddof=1).mean() * np.sqrt(365 * 24))

        dxy_change = self._change(aligned["DXY_PROXY"], periods=120)
        us10y_change = self._change(aligned["US10Y"], periods=120)
        us2y_change = self._change(aligned["US2Y"], periods=120)
        fed_change = self._change(aligned["FEDFUNDS"], periods=120)
        cpi_3m = self._change(aligned["CPI"], periods=90)
        cpi_12m = self._change(aligned["CPI"], periods=252)

        tightening = max(0.0, us10y_change / 1.5) + max(0.0, us2y_change / 1.5) + max(0.0, fed_change / 1.0)
        easing = max(0.0, -us10y_change / 1.5) + max(0.0, -us2y_change / 1.5) + max(0.0, -fed_change / 1.0)
        inflation_score = max(0.0, cpi_3m / 2.0) + max(0.0, cpi_12m / 10.0)
        low_inflation_score = max(0.0, -cpi_3m / 1.0) + max(0.0, 3.0 - cpi_12m) / 3.0

        risk_on = 0.35 + max(0.0, crypto_trend * 4.0) + easing * 0.25 + max(0.0, -dxy_change / 4.0)
        risk_off = 0.25 + max(0.0, -crypto_trend * 5.0) + tightening * 0.20 + max(0.0, dxy_change / 4.0) + min(0.5, crypto_vol / 2.0)

        return {
            "risk_on": round(float(np.clip(risk_on, 0.0, 1.0)), 8),
            "risk_off": round(float(np.clip(risk_off, 0.0, 1.0)), 8),
            "tightening_liquidity": round(float(np.clip(tightening / 2.0, 0.0, 1.0)), 8),
            "easing_liquidity": round(float(np.clip(easing / 2.0, 0.0, 1.0)), 8),
            "high_inflation": round(float(np.clip(inflation_score, 0.0, 1.0)), 8),
            "low_inflation": round(float(np.clip(low_inflation_score, 0.0, 1.0)), 8),
        }

    def _regime_mask(self, *, aligned: pd.DataFrame, regime: MacroRegime, crypto_symbols: list[str]) -> pd.Series:
        crypto_trend = aligned[crypto_symbols].mean(axis=1).pct_change(48).fillna(0.0)
        dxy_change = aligned["DXY_PROXY"].diff(48).fillna(0.0)
        rates_change = aligned[["US10Y", "US2Y", "FEDFUNDS"]].diff(48).mean(axis=1).fillna(0.0)
        cpi_change = aligned["CPI"].diff(120).fillna(0.0)
        if regime == "risk_on":
            return (crypto_trend > 0) & (dxy_change <= 0)
        if regime == "risk_off":
            return (crypto_trend < 0) | (dxy_change > 0)
        if regime == "tightening_liquidity":
            return rates_change > 0
        if regime == "easing_liquidity":
            return rates_change < 0
        if regime == "high_inflation":
            return cpi_change > 0
        return cpi_change <= 0

    def _change(self, series: pd.Series, *, periods: int) -> float:
        clean = series.dropna()
        if len(clean) <= periods:
            return 0.0
        return float(clean.iloc[-1] - clean.iloc[-periods - 1])
