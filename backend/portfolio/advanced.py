from __future__ import annotations

import asyncio
import math
from datetime import UTC, datetime
import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import leaves_list, linkage
from scipy.optimize import minimize
from scipy.spatial.distance import squareform

from advanced_risk.engine import AdvancedRiskEngine
from advanced_risk.schemas import AdvancedRiskRequest, AdvancedRiskResult
from data_quality.engine import DataQualityEngine
from data_quality.schemas import DataQualityRequest
from macro_quant.data_engine import CrossAssetDataError
from macro_quant.schemas import CrossAssetMacroRequest, CrossAssetMacroOutput
from macro_quant.service import CrossAssetMacroTradingSystem
from portfolio.covariance import CovarianceEstimator
from portfolio.schemas import (
    AdvancedPortfolioRequest,
    AdvancedPortfolioResult,
    RiskBudgetEntry,
)
from rl.data_loader import RLMarketDataLoader, normalize_market_error


class AdvancedPortfolioConstructionError(RuntimeError):
    pass


class AdvancedPortfolioConstructor:
    def __init__(
        self,
        *,
        market_loader: RLMarketDataLoader | None = None,
        quality_engine: DataQualityEngine | None = None,
        covariance_estimator: CovarianceEstimator | None = None,
        macro_system: CrossAssetMacroTradingSystem | None = None,
        advanced_risk: AdvancedRiskEngine | None = None,
    ) -> None:
        self.market_loader = market_loader or RLMarketDataLoader()
        self.quality_engine = quality_engine or DataQualityEngine()
        self.covariance_estimator = covariance_estimator or CovarianceEstimator()
        self.macro_system = macro_system or CrossAssetMacroTradingSystem()
        self.advanced_risk = advanced_risk or AdvancedRiskEngine()

    async def construct(self, request: AdvancedPortfolioRequest) -> AdvancedPortfolioResult:
        frames = await self._load_frames(request)
        close_prices = self._aligned_close_prices(frames)
        returns = self.covariance_estimator.returns_from_prices(close_prices)
        annualization = self.covariance_estimator.periods_per_year(returns.index)
        covariance = self.covariance_estimator.estimate(
            returns,
            method=request.covariance_method,
            annualization_factor=annualization,
        )
        expected_returns = self.covariance_estimator.expected_returns(returns, annualization_factor=annualization)
        drawdowns = self.covariance_estimator.asset_drawdowns(close_prices)
        macro_output = await self._macro_output(request)
        hrp_weights = self._hrp_weights(covariance)
        budget_targets = self._risk_budget_targets(request, returns.columns.tolist())
        rb_weights = self._risk_budgeting_weights(
            covariance=covariance,
            targets=budget_targets,
            max_weight=request.max_weight_per_asset,
        )
        base_weights = self._base_weights(request=request, hrp_weights=hrp_weights, rb_weights=rb_weights)
        drawdown_adjusted = self._drawdown_adjusted_weights(
            request=request,
            weights=base_weights,
            drawdowns=drawdowns,
        )
        exposure_target = self._target_exposure(
            request=request,
            weights=drawdown_adjusted,
            covariance=covariance,
            macro_output=macro_output,
        )
        final_asset_weights = self._scale_to_exposure(
            weights=drawdown_adjusted,
            exposure=exposure_target,
            max_weight=request.max_weight_per_asset,
        )
        cash_weight = max(0.0, 1.0 - float(final_asset_weights.sum()))
        final_weights = {symbol: float(final_asset_weights[symbol]) for symbol in final_asset_weights.index}
        final_weights["USDT_CASH"] = cash_weight
        realized_volatility = self._portfolio_volatility(final_asset_weights, covariance)
        expected_return = float(expected_returns.reindex(final_asset_weights.index).fillna(0.0).dot(final_asset_weights))
        risk_budget = self._risk_budget_entries(
            weights=final_asset_weights,
            covariance=covariance,
            targets=budget_targets,
        )
        risk_result = await self._advanced_risk_result(request=request, weights=final_asset_weights)
        return AdvancedPortfolioResult(
            exchange=request.exchange,
            symbols=returns.columns.tolist(),
            interval=request.interval,
            lookback=request.lookback,
            method=request.method,
            weights=self._rounded_weights(final_weights),
            target_volatility=round(request.target_volatility, 10),
            realized_volatility=round(realized_volatility, 10),
            expected_return=round(expected_return, 10),
            expected_risk=round(realized_volatility, 10),
            risk_budget=risk_budget,
            hrp_weights=self._rounded_weights(hrp_weights.to_dict()),
            risk_budget_weights=self._rounded_weights(rb_weights.to_dict()),
            drawdown_adjusted_weights=self._rounded_weights(drawdown_adjusted.to_dict()),
            cash_weight=round(cash_weight, 10),
            macro_regime=macro_output.macro_regime if macro_output is not None else "NON_DEFINI",
            macro_confidence=macro_output.confidence if macro_output is not None else None,
            macro_risk_score=macro_output.risk_score if macro_output is not None else None,
            risk_level=risk_result.risk_level if risk_result is not None else None,
            risk_score=risk_result.risk_score if risk_result is not None else None,
            advanced_risk=risk_result,
            data_start=returns.index[0].to_pydatetime().astimezone(UTC),
            data_end=returns.index[-1].to_pydatetime().astimezone(UTC),
            rows=len(returns),
            data_sources=self._data_sources(request, macro_output=macro_output, risk_result=risk_result),
            reasoning=self._reasoning(request=request, macro_output=macro_output, risk_result=risk_result, exposure=exposure_target),
            generated_at=datetime.now(UTC),
        )

    async def _load_frames(self, request: AdvancedPortfolioRequest) -> dict[str, pd.DataFrame]:
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
                raise AdvancedPortfolioConstructionError(f"{request.exchange} returned no OHLCV rows for {symbol}")
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
                raise AdvancedPortfolioConstructionError(f"advanced portfolio blocked by data quality for {symbol}: {issue_codes}")
            return symbol, frame

        loaded = await asyncio.gather(*(load_symbol(symbol) for symbol in request.symbols))
        return dict(loaded)

    def _aligned_close_prices(self, frames: dict[str, pd.DataFrame]) -> pd.DataFrame:
        close_prices = pd.concat(
            [frame["close"].astype(float).rename(symbol) for symbol, frame in frames.items()],
            axis=1,
            join="inner",
        ).dropna(how="any")
        if close_prices.shape[1] < 2 or len(close_prices) < 120:
            raise AdvancedPortfolioConstructionError("not enough aligned real OHLCV history for advanced portfolio construction")
        return close_prices

    async def _macro_output(self, request: AdvancedPortfolioRequest) -> CrossAssetMacroOutput | None:
        if not request.include_macro_regime:
            return None
        required = {"BTCUSDT", "ETHUSDT"}
        if not required.issubset(set(request.symbols)):
            if request.require_macro_regime:
                raise AdvancedPortfolioConstructionError("macro regime requires BTCUSDT and ETHUSDT in symbols")
            return None
        try:
            return await self.macro_system.analyze(
                CrossAssetMacroRequest(
                    crypto_exchange=request.exchange,
                    symbols=request.symbols[:6],
                    interval=request.interval,
                    crypto_lookback=min(max(request.lookback, 240), 1000),
                    macro_lookback_days=request.macro_lookback_days,
                    max_crypto_weight=min(0.95, request.max_gross_exposure),
                    min_cash_weight=request.min_cash_weight,
                )
            )
        except (CrossAssetDataError, ValueError):
            if request.require_macro_regime:
                raise
            return None

    def _hrp_weights(self, covariance: pd.DataFrame) -> pd.Series:
        assets = covariance.index.tolist()
        if len(assets) == 2:
            return self._inverse_variance_weights(covariance)
        corr = self._correlation_from_covariance(covariance).clip(-1.0, 1.0)
        distance = np.sqrt(np.clip((1.0 - corr.to_numpy(dtype=float)) / 2.0, 0.0, 1.0))
        condensed = squareform(distance, checks=False)
        ordered_assets = [assets[index] for index in leaves_list(linkage(condensed, method="single"))]
        weights = pd.Series(1.0, index=ordered_assets)
        clusters: list[list[str]] = [ordered_assets]
        while clusters:
            cluster = clusters.pop(0)
            if len(cluster) <= 1:
                continue
            split = len(cluster) // 2
            left = cluster[:split]
            right = cluster[split:]
            left_var = self._cluster_variance(covariance, left)
            right_var = self._cluster_variance(covariance, right)
            alpha = 1.0 - left_var / max(left_var + right_var, 1e-12)
            weights[left] *= alpha
            weights[right] *= 1.0 - alpha
            clusters.extend([left, right])
        return self._normalize(weights.reindex(assets).fillna(0.0))

    def _risk_budgeting_weights(self, *, covariance: pd.DataFrame, targets: pd.Series, max_weight: float) -> pd.Series:
        assets = covariance.index.tolist()
        sigma = covariance.loc[assets, assets].to_numpy(dtype=float)
        target = targets.reindex(assets).fillna(1.0 / len(assets)).to_numpy(dtype=float)
        target = target / target.sum()
        initial = np.repeat(1.0 / len(assets), len(assets))

        def objective(values: np.ndarray) -> float:
            contributions = self._risk_contribution_values(values, sigma)
            return float(((contributions - target) ** 2).sum())

        result = minimize(
            objective,
            initial,
            method="SLSQP",
            bounds=[(0.0, max_weight) for _ in assets],
            constraints=[{"type": "eq", "fun": lambda values: float(values.sum() - 1.0)}],
            options={"maxiter": 1000},
        )
        if not result.success:
            raise AdvancedPortfolioConstructionError(f"risk budgeting optimization failed: {result.message}")
        return self._normalize(pd.Series(result.x, index=assets).clip(lower=0.0, upper=max_weight))

    def _base_weights(self, *, request: AdvancedPortfolioRequest, hrp_weights: pd.Series, rb_weights: pd.Series) -> pd.Series:
        if request.method == "hrp":
            base = hrp_weights
        elif request.method == "risk_budgeting":
            base = rb_weights
        else:
            base = (request.hrp_blend_weight * hrp_weights) + ((1.0 - request.hrp_blend_weight) * rb_weights)
        return self._cap_and_normalize(base, max_weight=request.max_weight_per_asset)

    def _drawdown_adjusted_weights(
        self,
        *,
        request: AdvancedPortfolioRequest,
        weights: pd.Series,
        drawdowns: pd.Series,
    ) -> pd.Series:
        aligned = drawdowns.reindex(weights.index).fillna(0.0)
        penalty = 1.0 / (1.0 + request.drawdown_sensitivity * (aligned / request.max_asset_drawdown))
        adjusted = weights * penalty.clip(lower=0.15, upper=1.0)
        return self._cap_and_normalize(adjusted, max_weight=request.max_weight_per_asset)

    def _target_exposure(
        self,
        *,
        request: AdvancedPortfolioRequest,
        weights: pd.Series,
        covariance: pd.DataFrame,
        macro_output: CrossAssetMacroOutput | None,
    ) -> float:
        realized_vol = self._portfolio_volatility(weights, covariance)
        volatility_exposure = request.target_volatility / realized_vol if realized_vol > 1e-12 else request.max_gross_exposure
        macro_exposure = self._macro_exposure_cap(request, macro_output)
        cash_floor = self._cash_floor(request, macro_output)
        max_exposure_allowed = max(0.0, min(request.max_gross_exposure, macro_exposure, 1.0 - cash_floor))
        min_exposure_required = max(0.0, 1.0 - request.max_cash_weight)
        exposure = min(max_exposure_allowed, volatility_exposure)
        if max_exposure_allowed >= min_exposure_required:
            exposure = max(min_exposure_required, exposure)
        return max(0.0, min(exposure, max_exposure_allowed))

    def _macro_exposure_cap(self, request: AdvancedPortfolioRequest, macro_output: CrossAssetMacroOutput | None) -> float:
        if macro_output is None:
            return min(request.max_gross_exposure, 1.0 - request.min_cash_weight)
        regime = macro_output.macro_regime
        if regime in {"risk_off", "tightening_liquidity", "high_inflation"}:
            return min(request.max_gross_exposure, 0.55)
        if regime in {"risk_on", "easing_liquidity", "low_inflation"}:
            return min(request.max_gross_exposure, 1.0 - request.min_cash_weight)
        return min(request.max_gross_exposure, 0.75)

    def _cash_floor(self, request: AdvancedPortfolioRequest, macro_output: CrossAssetMacroOutput | None) -> float:
        floor = request.min_cash_weight
        if macro_output is None:
            return floor
        if macro_output.macro_regime in {"risk_off", "tightening_liquidity", "high_inflation"}:
            floor = max(floor, 0.35)
        if macro_output.risk_score >= 0.65:
            floor = max(floor, min(request.max_cash_weight, 0.45))
        elif macro_output.risk_score >= 0.45:
            floor = max(floor, min(request.max_cash_weight, 0.25))
        return min(floor, request.max_cash_weight)

    def _scale_to_exposure(self, *, weights: pd.Series, exposure: float, max_weight: float) -> pd.Series:
        normalized = self._cap_and_normalize(weights, max_weight=max_weight)
        scaled = normalized * exposure
        if float(scaled.max()) > max_weight:
            scaled = scaled.clip(upper=max_weight)
            total = float(scaled.sum())
            if total > 0:
                scaled = scaled * (min(exposure, total) / total)
        return scaled

    async def _advanced_risk_result(
        self,
        *,
        request: AdvancedPortfolioRequest,
        weights: pd.Series,
    ) -> AdvancedRiskResult | None:
        if not request.include_advanced_risk:
            return None
        return await self.advanced_risk.analyze(
            AdvancedRiskRequest(
                exchange=request.exchange,
                symbols=weights.index.tolist(),
                interval=request.interval,
                lookback=request.lookback,
                weights={symbol: float(weights[symbol]) for symbol in weights.index},
                portfolio_value=request.portfolio_value,
                confidence_level=request.risk_confidence_level,
                horizon_bars=request.risk_horizon_bars,
                max_weight_per_asset=request.max_weight_per_asset,
                include_liquidity=request.include_liquidity_risk,
                use_websocket=request.use_websocket_liquidity,
                allow_rest_fallback=request.allow_rest_fallback,
            )
        )

    def _risk_budget_targets(self, request: AdvancedPortfolioRequest, assets: list[str]) -> pd.Series:
        if request.risk_budget_targets is None:
            return pd.Series(1.0 / len(assets), index=assets)
        return pd.Series(request.risk_budget_targets).reindex(assets).fillna(0.0)

    def _risk_budget_entries(
        self,
        *,
        weights: pd.Series,
        covariance: pd.DataFrame,
        targets: pd.Series,
    ) -> dict[str, RiskBudgetEntry]:
        sigma = covariance.loc[weights.index, weights.index].to_numpy(dtype=float)
        contributions = self._risk_contribution_values(weights.to_numpy(dtype=float), sigma)
        return {
            symbol: RiskBudgetEntry(
                target=round(float(targets.reindex(weights.index).fillna(0.0)[symbol]), 10),
                contribution=round(float(contributions[index]), 10),
                weight=round(float(weights[symbol]), 10),
            )
            for index, symbol in enumerate(weights.index)
        }

    def _risk_contribution_values(self, weights: np.ndarray, covariance: np.ndarray) -> np.ndarray:
        variance = float(weights.T @ covariance @ weights)
        if variance <= 1e-16:
            return np.repeat(1.0 / len(weights), len(weights))
        marginal = covariance @ weights
        contributions = weights * marginal / variance
        return np.clip(contributions, 0.0, None) / max(float(np.clip(contributions, 0.0, None).sum()), 1e-12)

    def _inverse_variance_weights(self, covariance: pd.DataFrame) -> pd.Series:
        diagonal = pd.Series(np.diag(covariance.to_numpy(dtype=float)), index=covariance.index).clip(lower=1e-12)
        inv = 1.0 / diagonal
        return self._normalize(inv)

    def _cluster_variance(self, covariance: pd.DataFrame, assets: list[str]) -> float:
        cluster_covariance = covariance.loc[assets, assets]
        weights = self._inverse_variance_weights(cluster_covariance)
        values = weights.to_numpy(dtype=float)
        return float(values.T @ cluster_covariance.to_numpy(dtype=float) @ values)

    def _correlation_from_covariance(self, covariance: pd.DataFrame) -> pd.DataFrame:
        diagonal = np.sqrt(np.clip(np.diag(covariance.to_numpy(dtype=float)), 1e-12, None))
        corr = covariance.to_numpy(dtype=float) / np.outer(diagonal, diagonal)
        corr = np.nan_to_num(corr, nan=0.0, posinf=0.0, neginf=0.0)
        np.fill_diagonal(corr, 1.0)
        return pd.DataFrame(corr, index=covariance.index, columns=covariance.columns)

    def _portfolio_volatility(self, weights: pd.Series, covariance: pd.DataFrame) -> float:
        aligned = weights.reindex(covariance.index).fillna(0.0)
        values = aligned.to_numpy(dtype=float)
        variance = float(values.T @ covariance.loc[aligned.index, aligned.index].to_numpy(dtype=float) @ values)
        return math.sqrt(max(variance, 0.0))

    def _cap_and_normalize(self, weights: pd.Series, *, max_weight: float) -> pd.Series:
        cleaned = weights.clip(lower=0.0, upper=max_weight)
        if float(cleaned.sum()) <= 0:
            raise AdvancedPortfolioConstructionError("portfolio weights collapsed to zero")
        for _ in range(len(cleaned) + 3):
            total = float(cleaned.sum())
            gap = 1.0 - total
            if abs(gap) <= 1e-10:
                break
            capacity = (max_weight - cleaned).clip(lower=0.0)
            if gap > 0:
                capacity_total = float(capacity.sum())
                if capacity_total <= 1e-12:
                    break
                cleaned += capacity * (gap / capacity_total)
            else:
                reducible = cleaned.clip(lower=0.0)
                reducible_total = float(reducible.sum())
                if reducible_total <= 1e-12:
                    break
                cleaned -= reducible * (min(-gap, reducible_total) / reducible_total)
        return self._normalize(cleaned.clip(lower=0.0, upper=max_weight))

    def _normalize(self, weights: pd.Series) -> pd.Series:
        total = float(weights.sum())
        if total <= 0:
            raise AdvancedPortfolioConstructionError("cannot normalize zero weights")
        return weights / total

    def _rounded_weights(self, weights: dict[str, float]) -> dict[str, float]:
        return {symbol: round(float(weight), 10) for symbol, weight in weights.items()}

    def _data_sources(
        self,
        request: AdvancedPortfolioRequest,
        *,
        macro_output: CrossAssetMacroOutput | None,
        risk_result: AdvancedRiskResult | None,
    ) -> list[str]:
        sources = [f"{request.exchange}_official_ohlcv"]
        if macro_output is not None:
            sources.append("fred_official_macro_series")
        if risk_result is not None:
            sources.extend(risk_result.data_sources)
        return list(dict.fromkeys(sources))

    def _reasoning(
        self,
        *,
        request: AdvancedPortfolioRequest,
        macro_output: CrossAssetMacroOutput | None,
        risk_result: AdvancedRiskResult | None,
        exposure: float,
    ) -> str:
        macro = macro_output.macro_regime if macro_output is not None else "NON_DEFINI"
        risk_level = risk_result.risk_level if risk_result is not None else "NON_DEFINI"
        return (
            f"method={request.method}; target_volatility={request.target_volatility}; "
            f"gross_exposure={round(exposure, 10)}; macro_regime={macro}; risk_level={risk_level}; "
            "weights derived from real OHLCV covariance, observed drawdowns, HRP/risk-budgeting, "
            "macro regime when available, and advanced risk checks when enabled."
        )
