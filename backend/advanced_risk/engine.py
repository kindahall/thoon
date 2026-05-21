from __future__ import annotations

import asyncio
import math
from datetime import UTC, datetime
from itertools import combinations
from typing import Any

import numpy as np
import pandas as pd

from advanced_risk.schemas import (
    AdvancedRiskRequest,
    AdvancedRiskResult,
    ConcentrationRiskResult,
    CorrelationShockResult,
    LiquidityRiskResult,
    LiquiditySymbolRisk,
    RiskMetric,
    StressScenarioResult,
)
from data_quality.engine import DataQualityEngine
from data_quality.schemas import DataQualityRequest
from microstructure.engine import MicrostructureEngine
from microstructure.schemas import MicrostructureRequest
from rl.data_loader import RLMarketDataLoader, normalize_market_error


class AdvancedRiskError(RuntimeError):
    pass


class AdvancedRiskEngine:
    def __init__(
        self,
        *,
        market_loader: RLMarketDataLoader | None = None,
        quality_engine: DataQualityEngine | None = None,
        microstructure_engine: MicrostructureEngine | None = None,
    ) -> None:
        self.market_loader = market_loader or RLMarketDataLoader()
        self.quality_engine = quality_engine or DataQualityEngine()
        self.microstructure_engine = microstructure_engine or MicrostructureEngine()

    async def analyze(self, request: AdvancedRiskRequest) -> AdvancedRiskResult:
        frames = await self._load_frames(request)
        close_prices = self._aligned_close_prices(frames)
        returns = close_prices.pct_change().replace([np.inf, -np.inf], np.nan).dropna(how="any")
        if len(returns) < 60:
            raise AdvancedRiskError("not enough aligned real return observations for advanced risk analysis")
        weights = self._weights(request, returns.columns.tolist())
        portfolio_returns = returns.dot(pd.Series(weights).reindex(returns.columns).fillna(0.0))
        horizon_returns = self._horizon_returns(portfolio_returns, request.horizon_bars)
        var_fraction, cvar_fraction = self._historical_var_cvar(horizon_returns, request.confidence_level)
        stress_tests = self._stress_tests(
            portfolio_returns=portfolio_returns,
            returns=returns,
            weights=weights,
            request=request,
        )
        stress_loss = max((scenario.loss_fraction for scenario in stress_tests), default=0.0)
        correlation_shock = self._correlation_shock(
            returns=returns,
            portfolio_returns=portfolio_returns,
            portfolio_value=request.portfolio_value,
            request=request,
        )
        liquidity_risk = (
            await self._liquidity_risk(request=request, weights=weights)
            if request.include_liquidity
            else LiquidityRiskResult(
                available=False,
                weighted_liquidity_score=None,
                worst_liquidity_score=None,
                liquidity_risk_score=None,
                by_symbol={},
            )
        )
        concentration_risk = self._concentration_risk(request=request, weights=weights)
        scenario_analysis = self._scenario_analysis(
            returns=returns,
            portfolio_returns=portfolio_returns,
            weights=weights,
            request=request,
        )
        violations = self._violations(
            request=request,
            var_fraction=var_fraction,
            cvar_fraction=cvar_fraction,
            stress_loss=stress_loss,
            correlation_shock=correlation_shock,
            liquidity_risk=liquidity_risk,
            concentration_risk=concentration_risk,
        )
        risk_score = self._risk_score(
            request=request,
            var_fraction=var_fraction,
            cvar_fraction=cvar_fraction,
            stress_loss=stress_loss,
            correlation_shock=correlation_shock,
            liquidity_risk=liquidity_risk,
            concentration_risk=concentration_risk,
        )
        return AdvancedRiskResult(
            exchange=request.exchange,
            symbols=returns.columns.tolist(),
            interval=request.interval,
            lookback=request.lookback,
            weights={symbol: round(weight, 10) for symbol, weight in weights.items()},
            portfolio_value=round(request.portfolio_value, 8),
            data_start=returns.index[0].to_pydatetime().astimezone(UTC),
            data_end=returns.index[-1].to_pydatetime().astimezone(UTC),
            rows=len(returns),
            var=round(var_fraction, 10),
            cvar=round(cvar_fraction, 10),
            stress_loss=round(stress_loss, 10),
            risk_level=self._risk_level(risk_score, violations),
            var_metric=RiskMetric(
                fraction=round(var_fraction, 10),
                amount=round(var_fraction * request.portfolio_value, 8),
                confidence_level=request.confidence_level,
                horizon_bars=request.horizon_bars,
            ),
            cvar_metric=RiskMetric(
                fraction=round(cvar_fraction, 10),
                amount=round(cvar_fraction * request.portfolio_value, 8),
                confidence_level=request.confidence_level,
                horizon_bars=request.horizon_bars,
            ),
            stress_tests=stress_tests,
            scenario_analysis=scenario_analysis,
            correlation_shock=correlation_shock,
            liquidity_risk=liquidity_risk,
            concentration_risk=concentration_risk,
            risk_score=round(risk_score, 10),
            violations=violations,
            data_sources=self._data_sources(request),
            generated_at=datetime.now(UTC),
        )

    async def _load_frames(self, request: AdvancedRiskRequest) -> dict[str, pd.DataFrame]:
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
                raise AdvancedRiskError(f"{request.exchange} returned no OHLCV rows for {symbol}")
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
                raise AdvancedRiskError(f"advanced risk blocked by data quality for {symbol}: {issue_codes}")
            return symbol, frame

        loaded = await asyncio.gather(*(load_symbol(symbol) for symbol in request.symbols))
        return dict(loaded)

    def _aligned_close_prices(self, frames: dict[str, pd.DataFrame]) -> pd.DataFrame:
        closes = [
            frame["close"].astype(float).rename(symbol)
            for symbol, frame in frames.items()
            if "close" in frame.columns and not frame.empty
        ]
        close_prices = pd.concat(closes, axis=1, join="inner").dropna(how="any")
        if close_prices.empty:
            raise AdvancedRiskError("no aligned real close prices for requested portfolio")
        return close_prices

    def _weights(self, request: AdvancedRiskRequest, symbols: list[str]) -> dict[str, float]:
        if request.weights is None:
            equal = 1.0 / len(symbols)
            return {symbol: equal for symbol in symbols}
        return {symbol: float(request.weights[symbol]) for symbol in symbols}

    def _horizon_returns(self, portfolio_returns: pd.Series, horizon_bars: int) -> pd.Series:
        if horizon_bars <= 1:
            return portfolio_returns.dropna()
        compounded = (1.0 + portfolio_returns).rolling(horizon_bars).apply(np.prod, raw=True) - 1.0
        return compounded.replace([np.inf, -np.inf], np.nan).dropna()

    def _historical_var_cvar(self, horizon_returns: pd.Series, confidence_level: float) -> tuple[float, float]:
        losses = (-horizon_returns).replace([np.inf, -np.inf], np.nan).dropna()
        if losses.empty:
            raise AdvancedRiskError("no historical losses available for VaR/CVaR")
        var_fraction = max(0.0, float(losses.quantile(confidence_level)))
        tail = losses[losses >= var_fraction]
        cvar_fraction = max(var_fraction, float(tail.mean())) if not tail.empty else var_fraction
        return var_fraction, cvar_fraction

    def _stress_tests(
        self,
        *,
        portfolio_returns: pd.Series,
        returns: pd.DataFrame,
        weights: dict[str, float],
        request: AdvancedRiskRequest,
    ) -> list[StressScenarioResult]:
        portfolio_value = (1.0 + portfolio_returns).cumprod()
        drawdown = (portfolio_value / portfolio_value.cummax()) - 1.0
        worst_bar_loss = max(0.0, float((-portfolio_returns).max()))
        stress_window = min(request.stress_window_bars, len(portfolio_returns))
        rolling_window_loss = self._rolling_loss(portfolio_returns, stress_window)
        max_drawdown_loss = max(0.0, abs(float(drawdown.min())))
        worst_asset_contribution = self._worst_asset_contribution(returns=returns, weights=weights)
        return [
            StressScenarioResult(
                name="observed_worst_single_bar",
                loss_fraction=round(worst_bar_loss, 10),
                loss_amount=round(worst_bar_loss * request.portfolio_value, 8),
                source="historical_observed_portfolio_returns",
                details={"horizon_bars": 1},
            ),
            StressScenarioResult(
                name=f"observed_worst_{stress_window}_bar_window",
                loss_fraction=round(rolling_window_loss, 10),
                loss_amount=round(rolling_window_loss * request.portfolio_value, 8),
                source="historical_observed_rolling_portfolio_returns",
                details={"window_bars": stress_window},
            ),
            StressScenarioResult(
                name="observed_peak_to_trough_drawdown",
                loss_fraction=round(max_drawdown_loss, 10),
                loss_amount=round(max_drawdown_loss * request.portfolio_value, 8),
                source="historical_observed_portfolio_equity_curve",
                details={"method": "cumprod_returns_drawdown"},
            ),
            StressScenarioResult(
                name="observed_worst_asset_weighted_contribution",
                loss_fraction=round(worst_asset_contribution["loss_fraction"], 10),
                loss_amount=round(worst_asset_contribution["loss_fraction"] * request.portfolio_value, 8),
                source="historical_observed_asset_returns",
                details=worst_asset_contribution,
            ),
        ]

    def _rolling_loss(self, returns: pd.Series, window: int) -> float:
        if window <= 1:
            return max(0.0, float((-returns).max()))
        rolling_return = (1.0 + returns).rolling(window).apply(np.prod, raw=True) - 1.0
        if rolling_return.dropna().empty:
            return 0.0
        return max(0.0, float((-rolling_return).max()))

    def _worst_asset_contribution(self, *, returns: pd.DataFrame, weights: dict[str, float]) -> dict[str, Any]:
        worst_symbol = returns.columns[0]
        worst_loss = 0.0
        worst_return = 0.0
        for symbol in returns.columns:
            weighted_returns = returns[symbol] * weights[symbol]
            loss = max(0.0, float((-weighted_returns).max()))
            if loss >= worst_loss:
                worst_loss = loss
                worst_symbol = symbol
                worst_return = float(returns[symbol].loc[weighted_returns.idxmin()])
        return {
            "symbol": worst_symbol,
            "asset_return": round(worst_return, 10),
            "weight": round(weights[worst_symbol], 10),
            "loss_fraction": round(worst_loss, 10),
        }

    def _correlation_shock(
        self,
        *,
        returns: pd.DataFrame,
        portfolio_returns: pd.Series,
        portfolio_value: float,
        request: AdvancedRiskRequest,
    ) -> CorrelationShockResult:
        if returns.shape[1] < 2:
            return CorrelationShockResult(
                available=False,
                average_correlation=None,
                max_pair_correlation=None,
                rolling_max_pair_correlation=None,
                shock_loss_fraction=None,
                shock_loss_amount=None,
                source="single_asset_portfolio",
            )
        corr = returns.corr()
        pair_values = [
            float(corr.loc[left, right])
            for left, right in combinations(returns.columns, 2)
            if pd.notna(corr.loc[left, right])
        ]
        average_correlation = float(np.mean(pair_values)) if pair_values else None
        max_pair_correlation = max(pair_values) if pair_values else None
        rolling_max = self._rolling_max_correlation(returns)
        shock_loss = self._observed_high_correlation_loss(
            returns=returns,
            portfolio_returns=portfolio_returns,
            window=min(30, max(10, len(returns) // 4)),
        )
        return CorrelationShockResult(
            available=True,
            average_correlation=round(average_correlation, 10) if average_correlation is not None else None,
            max_pair_correlation=round(max_pair_correlation, 10) if max_pair_correlation is not None else None,
            rolling_max_pair_correlation=round(rolling_max, 10) if rolling_max is not None else None,
            shock_loss_fraction=round(shock_loss, 10) if shock_loss is not None else None,
            shock_loss_amount=round(shock_loss * portfolio_value, 8) if shock_loss is not None else None,
            source="observed_historical_return_correlations",
        )

    def _rolling_max_correlation(self, returns: pd.DataFrame) -> float | None:
        if returns.shape[1] < 2 or len(returns) < 20:
            return None
        window = min(90, max(20, len(returns) // 3))
        max_values: list[float] = []
        for left, right in combinations(returns.columns, 2):
            rolling = returns[left].rolling(window, min_periods=max(10, window // 3)).corr(returns[right]).dropna()
            if not rolling.empty:
                max_values.append(float(rolling.max()))
        return max(max_values) if max_values else None

    def _observed_high_correlation_loss(
        self,
        *,
        returns: pd.DataFrame,
        portfolio_returns: pd.Series,
        window: int,
    ) -> float | None:
        if returns.shape[1] < 2 or len(returns) < window:
            return None
        pair_rolling = []
        for left, right in combinations(returns.columns, 2):
            pair_rolling.append(returns[left].rolling(window, min_periods=max(5, window // 3)).corr(returns[right]))
        if not pair_rolling:
            return None
        rolling_corr = pd.concat(pair_rolling, axis=1).mean(axis=1).dropna()
        if rolling_corr.empty:
            return None
        threshold = float(rolling_corr.quantile(0.90))
        high_corr_index = rolling_corr[rolling_corr >= threshold].index
        aligned_losses = (-portfolio_returns).reindex(high_corr_index).dropna()
        if aligned_losses.empty:
            return None
        return max(0.0, float(aligned_losses.max()))

    async def _liquidity_risk(self, *, request: AdvancedRiskRequest, weights: dict[str, float]) -> LiquidityRiskResult:
        async def analyze_symbol(symbol: str) -> tuple[str, LiquiditySymbolRisk]:
            symbol_notional = request.liquidity_target_notional or max(25.0, abs(weights[symbol]) * request.portfolio_value)
            analysis = await self.microstructure_engine.analyze(
                MicrostructureRequest(
                    exchange=request.exchange,
                    symbol=symbol,
                    target_notional=symbol_notional,
                    sample_seconds=request.microstructure_sample_seconds,
                    use_websocket=request.use_websocket,
                    allow_rest_fallback=request.allow_rest_fallback,
                    min_liquidity_score=request.min_liquidity_score,
                )
            )
            return symbol, LiquiditySymbolRisk(
                symbol=symbol,
                target_notional=round(symbol_notional, 8),
                liquidity_score=analysis.liquidity_score,
                spread_bps=analysis.spread_bps,
                order_book_imbalance=analysis.order_book_imbalance,
                buy_slippage_bps=analysis.execution.buy_slippage_bps,
                sell_slippage_bps=analysis.execution.sell_slippage_bps,
                execution_feasibility=analysis.execution_feasibility,
                anomaly_flags=analysis.anomaly_flags,
                source=analysis.source,
            )

        results = dict(await asyncio.gather(*(analyze_symbol(symbol) for symbol in weights)))
        gross = sum(abs(value) for value in weights.values())
        weighted_score = sum(abs(weights[symbol]) * result.liquidity_score for symbol, result in results.items()) / gross
        worst_score = min(result.liquidity_score for result in results.values())
        liquidity_risk_score = max(0.0, min(1.0, 1.0 - weighted_score))
        return LiquidityRiskResult(
            available=True,
            weighted_liquidity_score=round(weighted_score, 10),
            worst_liquidity_score=round(worst_score, 10),
            liquidity_risk_score=round(liquidity_risk_score, 10),
            by_symbol=results,
        )

    def _concentration_risk(self, *, request: AdvancedRiskRequest, weights: dict[str, float]) -> ConcentrationRiskResult:
        values = np.array(list(weights.values()), dtype=float)
        gross_exposure = float(np.sum(np.abs(values)))
        net_exposure = float(np.sum(values))
        max_weight = float(np.max(np.abs(values))) if values.size else 0.0
        hhi = float(np.sum((np.abs(values) / gross_exposure) ** 2)) if gross_exposure > 0 else 0.0
        score = max(
            max_weight / request.max_weight_per_asset if request.max_weight_per_asset > 0 else 1.0,
            hhi,
            max(0.0, gross_exposure - 1.0),
        )
        violations: list[str] = []
        if max_weight > request.max_weight_per_asset:
            violations.append("max_weight_per_asset_breach")
        if gross_exposure > 1.000001:
            violations.append("gross_exposure_above_100_percent")
        if hhi > 0.60:
            violations.append("high_herfindahl_concentration")
        return ConcentrationRiskResult(
            max_weight=round(max_weight, 10),
            gross_exposure=round(gross_exposure, 10),
            net_exposure=round(net_exposure, 10),
            herfindahl_index=round(hhi, 10),
            concentration_score=round(max(0.0, min(1.0, score)), 10),
            violations=violations,
        )

    def _scenario_analysis(
        self,
        *,
        returns: pd.DataFrame,
        portfolio_returns: pd.Series,
        weights: dict[str, float],
        request: AdvancedRiskRequest,
    ) -> dict[str, Any]:
        recent_window = min(request.stress_window_bars, len(portfolio_returns))
        recent_return = float((1.0 + portfolio_returns.tail(recent_window)).prod() - 1.0)
        asset_worst: dict[str, Any] = {}
        for symbol in returns.columns:
            asset_losses = -returns[symbol]
            worst_timestamp = asset_losses.idxmax()
            asset_worst[symbol] = {
                "worst_return": round(float(returns.loc[worst_timestamp, symbol]), 10),
                "weighted_loss_fraction": round(max(0.0, float(asset_losses.loc[worst_timestamp] * weights[symbol])), 10),
                "timestamp": worst_timestamp.isoformat(),
            }
        return {
            "observed_recent_window": {
                "window_bars": recent_window,
                "return_fraction": round(recent_return, 10),
                "loss_fraction": round(max(0.0, -recent_return), 10),
            },
            "observed_worst_assets": asset_worst,
        }

    def _violations(
        self,
        *,
        request: AdvancedRiskRequest,
        var_fraction: float,
        cvar_fraction: float,
        stress_loss: float,
        correlation_shock: CorrelationShockResult,
        liquidity_risk: LiquidityRiskResult,
        concentration_risk: ConcentrationRiskResult,
    ) -> list[str]:
        violations: list[str] = []
        if var_fraction > request.max_portfolio_var_fraction:
            violations.append("var_above_limit")
        if cvar_fraction > request.max_portfolio_cvar_fraction:
            violations.append("cvar_above_limit")
        if stress_loss > request.max_stress_loss_fraction:
            violations.append("stress_loss_above_limit")
        if correlation_shock.max_pair_correlation is not None and correlation_shock.max_pair_correlation > request.max_pair_correlation:
            violations.append("pair_correlation_above_limit")
        if liquidity_risk.available:
            if liquidity_risk.worst_liquidity_score is not None and liquidity_risk.worst_liquidity_score < request.min_liquidity_score:
                violations.append("liquidity_score_below_limit")
            if any(not item.execution_feasibility for item in liquidity_risk.by_symbol.values()):
                violations.append("liquidity_execution_not_feasible")
        violations.extend(concentration_risk.violations)
        return list(dict.fromkeys(violations))

    def _risk_score(
        self,
        *,
        request: AdvancedRiskRequest,
        var_fraction: float,
        cvar_fraction: float,
        stress_loss: float,
        correlation_shock: CorrelationShockResult,
        liquidity_risk: LiquidityRiskResult,
        concentration_risk: ConcentrationRiskResult,
    ) -> float:
        var_component = min(1.0, var_fraction / request.max_portfolio_var_fraction)
        cvar_component = min(1.0, cvar_fraction / request.max_portfolio_cvar_fraction)
        stress_component = min(1.0, stress_loss / request.max_stress_loss_fraction)
        concentration_component = concentration_risk.concentration_score
        liquidity_component = liquidity_risk.liquidity_risk_score if liquidity_risk.liquidity_risk_score is not None else 0.0
        correlation_value = correlation_shock.max_pair_correlation if correlation_shock.max_pair_correlation is not None else 0.0
        correlation_component = min(1.0, max(0.0, correlation_value) / max(request.max_pair_correlation, 1e-12))
        return max(
            0.0,
            min(
                1.0,
                (0.22 * var_component)
                + (0.20 * cvar_component)
                + (0.22 * stress_component)
                + (0.14 * liquidity_component)
                + (0.12 * concentration_component)
                + (0.10 * correlation_component),
            ),
        )

    def _risk_level(self, risk_score: float, violations: list[str]) -> str:
        severe = {
            "cvar_above_limit",
            "stress_loss_above_limit",
            "liquidity_execution_not_feasible",
            "gross_exposure_above_100_percent",
        }
        if risk_score >= 0.65 or any(item in severe for item in violations):
            return "high"
        if risk_score >= 0.35 or violations:
            return "medium"
        return "low"

    def _data_sources(self, request: AdvancedRiskRequest) -> list[str]:
        sources = [f"{request.exchange}_official_ohlcv"]
        if request.include_liquidity:
            source = f"{request.exchange}_official_orderbook_ws" if request.use_websocket else f"{request.exchange}_official_orderbook_rest"
            sources.append(source)
            if request.allow_rest_fallback and request.use_websocket:
                sources.append(f"{request.exchange}_official_orderbook_rest_fallback")
        return sources
