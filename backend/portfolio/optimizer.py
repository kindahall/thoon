from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize

from portfolio.risk_constraints import PortfolioRiskConstraints
from portfolio.schemas import OptimizationMethod, PortfolioRiskConfig


class PortfolioOptimizer:
    def __init__(self, *, risk_constraints: PortfolioRiskConstraints | None = None) -> None:
        self.risk_constraints = risk_constraints or PortfolioRiskConstraints()

    def optimize(
        self,
        *,
        method: OptimizationMethod,
        expected_returns: pd.Series,
        covariance: pd.DataFrame,
        drawdowns: pd.Series,
        config: PortfolioRiskConfig,
        risk_free_rate: float,
    ) -> pd.Series:
        assets = list(expected_returns.index)
        covariance = covariance.loc[assets, assets]
        if method == "mean_variance":
            weights = self._mean_variance(expected_returns, covariance, drawdowns, config)
        elif method == "risk_parity":
            weights = self._risk_parity(expected_returns, covariance, drawdowns, config)
        else:
            weights = self._max_sharpe(expected_returns, covariance, drawdowns, config, risk_free_rate)

        validation = self.risk_constraints.validate_weights(
            weights=weights,
            covariance=covariance,
            drawdowns=drawdowns,
            config=config,
        )
        if not validation.valid:
            raise ValueError(f"portfolio math validation failed: {', '.join(validation.violations)}")
        return weights

    def portfolio_stats(
        self,
        *,
        weights: pd.Series,
        expected_returns: pd.Series,
        covariance: pd.DataFrame,
        risk_free_rate: float,
    ) -> tuple[float, float, float]:
        aligned_returns = expected_returns.reindex(weights.index).fillna(0.0)
        aligned_covariance = covariance.loc[weights.index, weights.index]
        values = weights.to_numpy(dtype=float)
        expected_return = float(aligned_returns.to_numpy(dtype=float) @ values)
        variance = float(values.T @ aligned_covariance.to_numpy(dtype=float) @ values)
        expected_risk = float(np.sqrt(max(variance, 0.0)))
        sharpe = (expected_return - risk_free_rate) / expected_risk if expected_risk > 0 else 0.0
        return expected_return, expected_risk, float(sharpe)

    def _mean_variance(
        self,
        expected_returns: pd.Series,
        covariance: pd.DataFrame,
        drawdowns: pd.Series,
        config: PortfolioRiskConfig,
    ) -> pd.Series:
        import cvxpy as cp

        assets = list(expected_returns.index)
        mu = expected_returns.to_numpy(dtype=float)
        sigma = covariance.to_numpy(dtype=float)
        w = cp.Variable(len(assets))
        risk_aversion = 2.5
        objective = cp.Maximize(mu @ w - risk_aversion * cp.quad_form(w, cp.psd_wrap(sigma)))
        problem = cp.Problem(objective, self.risk_constraints.cvxpy_constraints(w, assets=assets, drawdowns=drawdowns, config=config))
        try:
            problem.solve(solver=cp.CLARABEL, verbose=False)
        except Exception:
            problem.solve(solver=cp.SCS, verbose=False)
        if w.value is None:
            raise ValueError("mean-variance optimization failed")
        return self._clean_weights(pd.Series(np.asarray(w.value).ravel(), index=assets), config)

    def _risk_parity(
        self,
        expected_returns: pd.Series,
        covariance: pd.DataFrame,
        drawdowns: pd.Series,
        config: PortfolioRiskConfig,
    ) -> pd.Series:
        assets = list(expected_returns.index)
        sigma = covariance.to_numpy(dtype=float)
        n_assets = len(assets)
        initial = np.repeat(config.target_exposure / n_assets, n_assets)

        def objective(w: np.ndarray) -> float:
            portfolio_variance = max(float(w.T @ sigma @ w), 1e-12)
            marginal = sigma @ w
            contributions = w * marginal / portfolio_variance
            target = np.repeat(1.0 / n_assets, n_assets)
            return float(((contributions - target) ** 2).sum())

        constraints = [
            {"type": "eq", "fun": lambda w: float(w.sum() - config.target_exposure)},
            {
                "type": "ineq",
                "fun": lambda w: float(config.max_drawdown - np.dot(drawdowns.reindex(assets).fillna(0.0).to_numpy(dtype=float), w)),
            },
        ]
        bounds = [(0.0, config.max_exposure_per_asset) for _ in assets]
        result = minimize(objective, initial, method="SLSQP", bounds=bounds, constraints=constraints, options={"maxiter": 1000})
        if not result.success:
            raise ValueError(f"risk parity optimization failed: {result.message}")
        return self._clean_weights(pd.Series(result.x, index=assets), config)

    def _max_sharpe(
        self,
        expected_returns: pd.Series,
        covariance: pd.DataFrame,
        drawdowns: pd.Series,
        config: PortfolioRiskConfig,
        risk_free_rate: float,
    ) -> pd.Series:
        assets = list(expected_returns.index)
        mu = expected_returns.to_numpy(dtype=float)
        sigma = covariance.to_numpy(dtype=float)
        n_assets = len(assets)
        initial = np.repeat(config.target_exposure / n_assets, n_assets)

        def objective(w: np.ndarray) -> float:
            ret = float(mu @ w)
            risk = float(np.sqrt(max(w.T @ sigma @ w, 1e-12)))
            return -((ret - risk_free_rate) / risk)

        constraints = [
            {"type": "eq", "fun": lambda w: float(w.sum() - config.target_exposure)},
            {
                "type": "ineq",
                "fun": lambda w: float(config.max_drawdown - np.dot(drawdowns.reindex(assets).fillna(0.0).to_numpy(dtype=float), w)),
            },
        ]
        bounds = [(0.0, config.max_exposure_per_asset) for _ in assets]
        result = minimize(objective, initial, method="SLSQP", bounds=bounds, constraints=constraints, options={"maxiter": 1000})
        if not result.success:
            raise ValueError(f"max Sharpe optimization failed: {result.message}")
        return self._clean_weights(pd.Series(result.x, index=assets), config)

    def _clean_weights(self, weights: pd.Series, config: PortfolioRiskConfig) -> pd.Series:
        cleaned = weights.clip(lower=0.0 if config.long_only else None, upper=config.max_exposure_per_asset)
        cleaned[cleaned.abs() < 1e-8] = 0.0
        target_exposure = config.target_exposure
        for _ in range(len(cleaned) + 2):
            total = float(cleaned.sum())
            gap = target_exposure - total
            if abs(gap) <= 1e-6:
                break
            if gap > 0:
                capacity = (config.max_exposure_per_asset - cleaned).clip(lower=0.0)
                capacity_total = float(capacity.sum())
                if capacity_total <= 1e-8:
                    break
                cleaned = cleaned + capacity * (min(gap, capacity_total) / capacity_total)
            else:
                reducible = cleaned.clip(lower=0.0)
                reducible_total = float(reducible.sum())
                if reducible_total <= 1e-8:
                    break
                cleaned = cleaned - reducible * (min(-gap, reducible_total) / reducible_total)

        total = float(cleaned.sum())
        if total <= 0:
            raise ValueError("optimizer returned zero allocation")
        if abs(total - target_exposure) > 1e-5:
            raise ValueError("optimizer returned allocation outside feasible exposure target")
        return cleaned
