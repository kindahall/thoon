from __future__ import annotations

import pandas as pd

from macro_quant.schemas import CorrelationSnapshot


class CorrelationEngine:
    def calculate(
        self,
        *,
        aligned: pd.DataFrame,
        crypto_symbols: list[str],
        macro_columns: list[str],
        window: int,
        breakdown_threshold: float,
    ) -> dict[str, CorrelationSnapshot]:
        returns = self._cross_asset_returns(aligned=aligned, crypto_symbols=crypto_symbols, macro_columns=macro_columns)
        correlations: dict[str, CorrelationSnapshot] = {}
        for crypto in crypto_symbols:
            for macro in macro_columns:
                key = f"{crypto}:{macro}"
                rolling = returns[crypto].rolling(window).corr(returns[macro]).dropna()
                if rolling.empty:
                    correlations[key] = CorrelationSnapshot(latest=None, previous=None, breakdown=False)
                    continue
                latest = float(rolling.iloc[-1])
                previous = float(rolling.iloc[-min(len(rolling), window)])
                correlations[key] = CorrelationSnapshot(
                    latest=round(latest, 8),
                    previous=round(previous, 8),
                    breakdown=abs(latest - previous) >= breakdown_threshold,
                )
        return correlations

    def regime_based(
        self,
        *,
        aligned: pd.DataFrame,
        crypto_symbols: list[str],
        macro_columns: list[str],
        regime_mask: pd.Series,
    ) -> dict[str, float | None]:
        returns = self._cross_asset_returns(aligned=aligned, crypto_symbols=crypto_symbols, macro_columns=macro_columns)
        regime_returns = returns.loc[regime_mask.reindex(returns.index, fill_value=False)]
        output: dict[str, float | None] = {}
        if len(regime_returns) < 20:
            return {f"{crypto}:{macro}": None for crypto in crypto_symbols for macro in macro_columns}
        for crypto in crypto_symbols:
            for macro in macro_columns:
                value = regime_returns[crypto].corr(regime_returns[macro])
                output[f"{crypto}:{macro}"] = None if pd.isna(value) else round(float(value), 8)
        return output

    def _cross_asset_returns(
        self,
        *,
        aligned: pd.DataFrame,
        crypto_symbols: list[str],
        macro_columns: list[str],
    ) -> pd.DataFrame:
        crypto_returns = aligned[crypto_symbols].pct_change()
        macro_changes = aligned[macro_columns].diff()
        returns = pd.concat([crypto_returns, macro_changes], axis=1)
        return returns.replace([float("inf"), float("-inf")], pd.NA).dropna(how="any")
