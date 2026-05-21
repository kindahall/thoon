from __future__ import annotations

import numpy as np
import pandas as pd

from portfolio.schemas import MathValidationResult, PortfolioRiskConfig


class PortfolioRiskConstraints:
    def validate_covariance(self, covariance: pd.DataFrame) -> MathValidationResult:
        violations: list[str] = []
        matrix = covariance.to_numpy(dtype=float)
        if not np.all(np.isfinite(matrix)):
            violations.append("covariance_contains_non_finite_values")
        if not np.allclose(matrix, matrix.T, atol=1e-8):
            violations.append("covariance_not_symmetric")
        if matrix.size:
            min_eigenvalue = float(np.linalg.eigvalsh((matrix + matrix.T) / 2.0).min())
            if min_eigenvalue < -1e-8:
                violations.append("covariance_not_positive_semidefinite")
        return MathValidationResult(valid=not violations, violations=violations)

    def validate_weights(
        self,
        *,
        weights: pd.Series,
        covariance: pd.DataFrame,
        drawdowns: pd.Series,
        config: PortfolioRiskConfig,
    ) -> MathValidationResult:
        violations: list[str] = []
        values = weights.to_numpy(dtype=float)
        if not np.all(np.isfinite(values)):
            violations.append("weights_contain_non_finite_values")
        if config.long_only and (values < -1e-8).any():
            violations.append("long_only_weight_breach")
        if values.sum() - config.leverage_cap > 1e-6:
            violations.append("leverage_cap_breach")
        if values.max(initial=0.0) - config.max_exposure_per_asset > 1e-6:
            violations.append("max_exposure_per_asset_breach")
        estimated_drawdown = float(weights.reindex(drawdowns.index).fillna(0.0).dot(drawdowns))
        if estimated_drawdown - config.max_drawdown > 1e-6:
            violations.append("max_drawdown_breach")
        portfolio_variance = float(values.T @ covariance.loc[weights.index, weights.index].to_numpy(dtype=float) @ values)
        if portfolio_variance < -1e-8:
            violations.append("negative_portfolio_variance")
        return MathValidationResult(valid=not violations, violations=violations)

    def cvxpy_constraints(self, w, *, assets: list[str], drawdowns: pd.Series, config: PortfolioRiskConfig):
        import cvxpy as cp

        asset_drawdown_vector = drawdowns.reindex(assets).fillna(0.0).to_numpy(dtype=float)
        constraints = [
            cp.sum(w) == config.target_exposure,
            cp.sum(cp.abs(w)) <= config.leverage_cap,
            w <= config.max_exposure_per_asset,
            asset_drawdown_vector @ w <= config.max_drawdown,
        ]
        if config.long_only:
            constraints.append(w >= 0)
        return constraints
