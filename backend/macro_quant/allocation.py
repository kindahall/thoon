from __future__ import annotations

import numpy as np
import pandas as pd

from macro_quant.schemas import CrossAssetMacroRequest, MacroRegime


class AllocationEngine:
    def allocate(
        self,
        *,
        request: CrossAssetMacroRequest,
        aligned: pd.DataFrame,
        macro_regime: MacroRegime,
        signal_score: float,
        risk_score: float,
    ) -> dict[str, float]:
        crypto_symbols = request.symbols
        returns = aligned[crypto_symbols].pct_change().dropna()
        momentum = aligned[crypto_symbols].pct_change(72).iloc[-1].clip(lower=0.0)
        inverse_vol = 1.0 / returns.tail(168).std(ddof=1).replace(0.0, np.nan)
        base = (momentum + 1e-6) * inverse_vol
        if base.replace([np.inf, -np.inf], np.nan).dropna().sum() <= 0:
            base = inverse_vol
        crypto_weights = base.replace([np.inf, -np.inf], np.nan).fillna(0.0)
        crypto_weights = crypto_weights / crypto_weights.sum() if crypto_weights.sum() > 0 else pd.Series(1 / len(crypto_symbols), index=crypto_symbols)

        gross_crypto = self._gross_crypto_exposure(
            regime=macro_regime,
            signal_score=signal_score,
            risk_score=risk_score,
            max_crypto_weight=request.max_crypto_weight,
            min_cash_weight=request.min_cash_weight,
        )
        allocation = {symbol.replace("USDT", ""): round(float(weight * gross_crypto), 8) for symbol, weight in crypto_weights.items()}
        allocation["USDT_CASH"] = round(float(max(request.min_cash_weight, 1.0 - sum(allocation.values()))), 8)
        total = sum(allocation.values())
        if total > 1.0:
            allocation = {key: round(float(value / total), 8) for key, value in allocation.items()}
        return allocation

    def _gross_crypto_exposure(
        self,
        *,
        regime: MacroRegime,
        signal_score: float,
        risk_score: float,
        max_crypto_weight: float,
        min_cash_weight: float,
    ) -> float:
        regime_target = {
            "risk_on": 0.78,
            "easing_liquidity": 0.70,
            "low_inflation": 0.62,
            "high_inflation": 0.48,
            "tightening_liquidity": 0.34,
            "risk_off": 0.22,
        }[regime]
        adjusted = regime_target + 0.20 * signal_score - 0.35 * risk_score
        return round(float(np.clip(adjusted, 0.0, min(max_crypto_weight, 1.0 - min_cash_weight))), 8)
