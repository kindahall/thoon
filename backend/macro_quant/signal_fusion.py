from __future__ import annotations

import numpy as np
import pandas as pd

from macro_quant.schemas import CorrelationSnapshot, MacroRegime


class SignalFusionEngine:
    def score(
        self,
        *,
        aligned: pd.DataFrame,
        crypto_symbols: list[str],
        macro_regime: MacroRegime,
        regime_scores: dict[MacroRegime, float],
        correlations: dict[str, CorrelationSnapshot],
    ) -> tuple[float, float, float]:
        crypto_returns = aligned[crypto_symbols].pct_change().dropna()
        crypto_trend = float(aligned[crypto_symbols].pct_change(72).iloc[-1].mean())
        crypto_vol = float(crypto_returns.tail(168).std(ddof=1).mean() * np.sqrt(365 * 24))
        drawdown = self._basket_drawdown(aligned[crypto_symbols])
        breakdown_count = sum(snapshot.breakdown for snapshot in correlations.values())
        breakdown_ratio = breakdown_count / max(1, len(correlations))

        directional = {
            "risk_on": 0.45,
            "easing_liquidity": 0.35,
            "low_inflation": 0.20,
            "high_inflation": -0.05,
            "tightening_liquidity": -0.30,
            "risk_off": -0.45,
        }[macro_regime]
        trend_component = float(np.clip(crypto_trend * 6.0, -0.35, 0.35))
        signal_score = round(float(np.clip(directional + trend_component, -1.0, 1.0)), 8)

        risk_score = 0.35 * min(1.0, crypto_vol / 1.2) + 0.35 * min(1.0, abs(drawdown) / 0.35) + 0.30 * breakdown_ratio
        risk_score = round(float(np.clip(risk_score, 0.0, 1.0)), 8)

        regime_margin = self._regime_margin(regime_scores)
        data_completeness = min(1.0, len(aligned) / 240)
        confidence = 0.42 * regime_margin + 0.28 * (1.0 - breakdown_ratio) + 0.30 * data_completeness
        confidence = round(float(np.clip(confidence, 0.0, 1.0)), 8)
        return signal_score, risk_score, confidence

    def _basket_drawdown(self, prices: pd.DataFrame) -> float:
        basket = prices.mean(axis=1)
        running_max = basket.cummax()
        drawdown = (basket / running_max) - 1.0
        return float(drawdown.min())

    def _regime_margin(self, scores: dict[MacroRegime, float]) -> float:
        ordered = sorted(scores.values(), reverse=True)
        if not ordered:
            return 0.0
        if len(ordered) == 1:
            return ordered[0]
        return float(np.clip(ordered[0] - ordered[1] + 0.35, 0.0, 1.0))
