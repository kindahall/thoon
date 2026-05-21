from __future__ import annotations

import math

import numpy as np
import pandas as pd

from portfolio.schemas import CovarianceMethod


class CovarianceEstimator:
    def returns_from_prices(self, close_prices: pd.DataFrame) -> pd.DataFrame:
        if close_prices.empty or close_prices.shape[1] < 2:
            raise ValueError("at least two real assets are required")
        returns = np.log(close_prices / close_prices.shift(1)).replace([np.inf, -np.inf], np.nan).dropna(how="any")
        if len(returns) < 30:
            raise ValueError("not enough aligned historical Binance returns")
        return returns

    def expected_returns(self, returns: pd.DataFrame, *, annualization_factor: float) -> pd.Series:
        return returns.mean() * annualization_factor

    def estimate(
        self,
        returns: pd.DataFrame,
        *,
        method: CovarianceMethod,
        annualization_factor: float,
        window: int | None = None,
        span: int | None = None,
    ) -> pd.DataFrame:
        if method == "rolling":
            lookback = min(window or 120, len(returns))
            covariance = returns.tail(lookback).cov()
        else:
            covariance = self._exponential_covariance(returns, span=min(span or 90, len(returns)))
        covariance = covariance * annualization_factor
        return self._nearest_psd(covariance)

    def periods_per_year(self, index: pd.Index) -> float:
        if len(index) < 2:
            return 365.0
        deltas = pd.Series(index).diff().dropna()
        median_seconds = float(deltas.median().total_seconds())
        if median_seconds <= 0:
            return 365.0
        return (365.0 * 24.0 * 60.0 * 60.0) / median_seconds

    def asset_drawdowns(self, close_prices: pd.DataFrame) -> pd.Series:
        running_max = close_prices.cummax()
        drawdowns = (close_prices / running_max) - 1.0
        return drawdowns.min().abs().fillna(0.0)

    def realized_volatility_percent(self, returns: pd.DataFrame) -> float:
        if returns.empty:
            return 0.0
        annualization_factor = self.periods_per_year(returns.index)
        portfolio_proxy = returns.mean(axis=1)
        return float(portfolio_proxy.std(ddof=1) * math.sqrt(annualization_factor) * 100)

    def _exponential_covariance(self, returns: pd.DataFrame, *, span: int) -> pd.DataFrame:
        alpha = 2.0 / (span + 1.0)
        raw_weights = np.array([(1.0 - alpha) ** i for i in range(len(returns) - 1, -1, -1)], dtype=float)
        weights = raw_weights / raw_weights.sum()
        values = returns.to_numpy(dtype=float)
        mean = np.average(values, axis=0, weights=weights)
        centered = values - mean
        denominator = max(1e-12, 1.0 - float(np.sum(weights**2)))
        covariance = (centered * weights[:, None]).T @ centered / denominator
        return pd.DataFrame(covariance, index=returns.columns, columns=returns.columns)

    def _nearest_psd(self, covariance: pd.DataFrame) -> pd.DataFrame:
        matrix = covariance.to_numpy(dtype=float)
        matrix = (matrix + matrix.T) / 2.0
        eigenvalues, eigenvectors = np.linalg.eigh(matrix)
        clipped = np.clip(eigenvalues, 1e-10, None)
        psd = eigenvectors @ np.diag(clipped) @ eigenvectors.T
        psd = (psd + psd.T) / 2.0
        return pd.DataFrame(psd, index=covariance.index, columns=covariance.columns)
