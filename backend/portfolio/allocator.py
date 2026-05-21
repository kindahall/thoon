from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime
from typing import Any

import httpx
import pandas as pd

from agents.macro_market import MacroAnalysis, MacroAnalyzeRequest, MacroMarketAgent
from backtest.data_loader import BinanceHistoricalDataLoader
from portfolio.covariance import CovarianceEstimator
from portfolio.optimizer import PortfolioOptimizer
from portfolio.risk_constraints import PortfolioRiskConstraints
from portfolio.schemas import (
    AssetUniverseEntry,
    PortfolioAllocationRequest,
    PortfolioAllocationResult,
    PortfolioRegime,
    PortfolioRiskConfig,
)
from services.binance import BinanceAPIError, normalize_symbol


class RegimeBasedAllocator:
    EXCLUDED_BASE_ASSETS = {
        "AEUR",
        "ARS",
        "BUSD",
        "BRL",
        "DAI",
        "EUR",
        "EURI",
        "FDUSD",
        "PAXG",
        "PYUSD",
        "RLUSD",
        "SUSD",
        "TRY",
        "TUSD",
        "USDC",
        "USDD",
        "USDE",
        "USDP",
        "USDS",
        "USD1",
        "USDX",
        "UST",
        "USTC",
        "XAUT",
    }
    LEVERAGED_SUFFIXES = ("UPUSDT", "DOWNUSDT", "BULLUSDT", "BEARUSDT")

    def __init__(
        self,
        *,
        macro_agent: MacroMarketAgent | None = None,
        data_loader: BinanceHistoricalDataLoader | None = None,
        covariance_estimator: CovarianceEstimator | None = None,
        optimizer: PortfolioOptimizer | None = None,
    ) -> None:
        base_url = os.getenv("BINANCE_REST_BASE_URL", "https://api.binance.com")
        self.base_url = base_url
        self.macro_agent = macro_agent or MacroMarketAgent()
        self.data_loader = data_loader or BinanceHistoricalDataLoader(base_url=base_url)
        self.covariance_estimator = covariance_estimator or CovarianceEstimator()
        self.risk_constraints = PortfolioRiskConstraints()
        self.optimizer = optimizer or PortfolioOptimizer(risk_constraints=self.risk_constraints)

    async def allocate(self, request: PortfolioAllocationRequest) -> PortfolioAllocationResult:
        universe = await self._top_universe(request.top_n)
        close_prices, quote_volumes = await self._historical_close_matrix(universe, request)
        returns = self.covariance_estimator.returns_from_prices(close_prices)
        annualization = self.covariance_estimator.periods_per_year(returns.index)
        expected_returns = self.covariance_estimator.expected_returns(returns, annualization_factor=annualization)
        covariance = self.covariance_estimator.estimate(
            returns,
            method=request.covariance_method,
            annualization_factor=annualization,
        )
        covariance_validation = self.risk_constraints.validate_covariance(covariance)
        if not covariance_validation.valid:
            raise ValueError(f"covariance validation failed: {', '.join(covariance_validation.violations)}")

        drawdowns = self.covariance_estimator.asset_drawdowns(close_prices)
        macro_analysis = await self._macro_analysis(request)
        regime = self._detect_regime(
            macro_analysis=macro_analysis,
            returns=returns,
            quote_volumes=quote_volumes,
            close_prices=close_prices,
        )
        risk_config = self._risk_config_for_regime(
            regime,
            request,
            asset_count=len(close_prices.columns),
            drawdowns=drawdowns,
        )
        weights = self.optimizer.optimize(
            method=request.optimization_method,
            expected_returns=expected_returns,
            covariance=covariance,
            drawdowns=drawdowns,
            config=risk_config,
            risk_free_rate=request.risk_free_rate,
        )
        expected_return, expected_risk, sharpe = self.optimizer.portfolio_stats(
            weights=weights,
            expected_returns=expected_returns,
            covariance=covariance,
            risk_free_rate=request.risk_free_rate,
        )
        portfolio_weights = {symbol.replace("USDT", ""): round(float(weight), 8) for symbol, weight in weights.items()}
        cash_weight = max(0.0, 1.0 - float(weights.sum()))
        if cash_weight > 1e-8:
            portfolio_weights["USDT_CASH"] = round(cash_weight, 8)

        reasoning = self._reasoning(
            request=request,
            regime=regime,
            macro_analysis=macro_analysis,
            universe=universe,
            expected_risk=expected_risk,
            sharpe=sharpe,
            validation="passed",
        )
        return PortfolioAllocationResult(
            portfolio_weights=portfolio_weights,
            expected_return=round(expected_return, 8),
            expected_risk=round(expected_risk, 8),
            sharpe_estimate=round(sharpe, 8),
            regime=regime,
            reasoning=reasoning,
        )

    async def _top_universe(self, top_n: int) -> list[AssetUniverseEntry]:
        async with httpx.AsyncClient(base_url=self.base_url, timeout=15) as client:
            response = await client.get("/api/v3/ticker/24hr")
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as error:
                raise BinanceAPIError(f"Binance 24hr universe request failed: {response.text}") from error
            payload = response.json()

        candidates: list[AssetUniverseEntry] = []
        for item in payload:
            symbol = str(item.get("symbol", ""))
            if not self._is_tradeable_usdt_crypto(symbol):
                continue
            try:
                quote_volume = float(item["quoteVolume"])
                last_price = float(item["lastPrice"])
            except (KeyError, TypeError, ValueError):
                continue
            if quote_volume <= 0 or last_price <= 0:
                continue
            candidates.append(AssetUniverseEntry(symbol=symbol, quote_volume=quote_volume, last_price=last_price))

        ranked = sorted(candidates, key=lambda asset: asset.quote_volume, reverse=True)
        selected_symbols: list[str] = []
        for required in ("BTCUSDT", "ETHUSDT"):
            if any(asset.symbol == required for asset in ranked):
                selected_symbols.append(required)
        for asset in ranked:
            if asset.symbol not in selected_symbols:
                selected_symbols.append(asset.symbol)
            if len(selected_symbols) >= top_n:
                break
        by_symbol = {asset.symbol: asset for asset in ranked}
        universe = [by_symbol[symbol] for symbol in selected_symbols if symbol in by_symbol]
        if len(universe) < 2:
            raise ValueError("Binance returned fewer than two eligible real crypto assets")
        return universe

    async def _historical_close_matrix(
        self,
        universe: list[AssetUniverseEntry],
        request: PortfolioAllocationRequest,
    ) -> tuple[pd.DataFrame, pd.Series]:
        async def load(symbol: str) -> tuple[str, pd.DataFrame]:
            frame = await self.data_loader.download_ohlcv(symbol=symbol, interval=request.interval, limit=request.lookback)
            return symbol, frame

        loaded = await asyncio.gather(*(load(asset.symbol) for asset in universe))
        closes = {
            symbol: frame["close"].rename(symbol)
            for symbol, frame in loaded
            if "close" in frame.columns and not frame.empty
        }
        close_prices = pd.concat(closes.values(), axis=1, join="inner").dropna(how="any")
        if close_prices.shape[1] < 2:
            raise ValueError("not enough aligned Binance OHLCV histories for portfolio allocation")
        quote_volumes = pd.Series({asset.symbol: asset.quote_volume for asset in universe}).reindex(close_prices.columns)
        return close_prices, quote_volumes

    async def _macro_analysis(self, request: PortfolioAllocationRequest) -> MacroAnalysis:
        macro_request = MacroAnalyzeRequest(
            interval=request.interval,
            limit=min(max(request.lookback, 60), 1000),
            include_fred=request.include_fred,
            llm_model=request.llm_model,
        )
        if request.use_macro_agent_llm:
            return await self.macro_agent.analyze(macro_request)
        snapshot = await self.macro_agent.collect_snapshot(macro_request)
        return MacroAnalysis(
            regime=snapshot.deterministic_regime,
            confidence=snapshot.deterministic_confidence,
            signals=snapshot.deterministic_signals,
            explanation="Deterministic MacroMarketAgent snapshot used without LLM refinement.",
        )

    def _detect_regime(
        self,
        *,
        macro_analysis: MacroAnalysis,
        returns: pd.DataFrame,
        quote_volumes: pd.Series,
        close_prices: pd.DataFrame,
    ) -> PortfolioRegime:
        volatility = self.covariance_estimator.realized_volatility_percent(returns)
        median_quote_volume = float(quote_volumes.median())
        min_quote_volume = float(quote_volumes.min())
        if volatility >= 85.0:
            return "high_volatility"
        if min_quote_volume < max(5_000_000.0, median_quote_volume * 0.08):
            return "low_liquidity"
        if macro_analysis.regime == "risk_on":
            return "risk_on"
        if macro_analysis.regime == "risk_off":
            return "risk_off"
        trend = (close_prices.iloc[-1] / close_prices.tail(min(20, len(close_prices))).mean() - 1.0).mean()
        if trend > 0.015 and macro_analysis.confidence >= 0.55:
            return "risk_on"
        if trend < -0.015 and macro_analysis.confidence >= 0.55:
            return "risk_off"
        return "neutral"

    def _risk_config_for_regime(
        self,
        regime: PortfolioRegime,
        request: PortfolioAllocationRequest,
        *,
        asset_count: int,
        drawdowns: pd.Series,
    ) -> PortfolioRiskConfig:
        target_exposure = min(1.0, request.leverage_cap)
        max_weight = request.max_exposure_per_asset
        max_drawdown = request.max_drawdown

        if regime == "risk_on":
            target_exposure = min(1.0, request.leverage_cap)
            max_weight = min(max_weight, 0.45)
        elif regime == "neutral":
            target_exposure = min(0.8, request.leverage_cap)
            max_weight = min(max_weight, 0.35)
        elif regime == "risk_off":
            target_exposure = min(0.45, request.leverage_cap)
            max_weight = min(max_weight, 0.25)
            max_drawdown = min(max_drawdown, 0.08)
        elif regime == "high_volatility":
            target_exposure = min(0.5, request.leverage_cap)
            max_weight = min(max_weight, 0.22)
            max_drawdown = min(max_drawdown, 0.07)
        elif regime == "low_liquidity":
            target_exposure = min(0.4, request.leverage_cap)
            max_weight = min(max_weight, 0.2)
            max_drawdown = min(max_drawdown, 0.06)

        feasible_exposure_cap = max_weight * max(asset_count, 1)
        drawdown_exposure_cap = self._max_feasible_exposure_from_drawdown(
            max_weight=max_weight,
            max_drawdown=max_drawdown,
            drawdowns=drawdowns,
        )
        target_exposure = min(target_exposure, feasible_exposure_cap, drawdown_exposure_cap, request.leverage_cap)
        if target_exposure <= 1e-8:
            raise ValueError("portfolio risk constraints are infeasible for current Binance history")

        return PortfolioRiskConfig(
            max_exposure_per_asset=max_weight,
            leverage_cap=request.leverage_cap,
            max_drawdown=max_drawdown,
            target_exposure=target_exposure,
            long_only=True,
        )

    @staticmethod
    def _max_feasible_exposure_from_drawdown(
        *,
        max_weight: float,
        max_drawdown: float,
        drawdowns: pd.Series,
    ) -> float:
        remaining_drawdown = max_drawdown
        feasible_exposure = 0.0
        for drawdown in sorted(float(value) for value in drawdowns.dropna().to_list()):
            if drawdown <= 0:
                feasible_exposure += max_weight
                continue
            allocation = min(max_weight, remaining_drawdown / drawdown)
            if allocation <= 0:
                break
            feasible_exposure += allocation
            remaining_drawdown -= allocation * drawdown
            if remaining_drawdown <= 1e-10:
                break
        return feasible_exposure

    def _is_tradeable_usdt_crypto(self, symbol: str) -> bool:
        if not symbol.endswith("USDT"):
            return False
        base_asset = symbol.removesuffix("USDT")
        if base_asset in self.EXCLUDED_BASE_ASSETS:
            return False
        if symbol.endswith(self.LEVERAGED_SUFFIXES):
            return False
        try:
            normalize_symbol(symbol)
        except BinanceAPIError:
            return False
        return True

    def _reasoning(
        self,
        *,
        request: PortfolioAllocationRequest,
        regime: PortfolioRegime,
        macro_analysis: MacroAnalysis,
        universe: list[AssetUniverseEntry],
        expected_risk: float,
        sharpe: float,
        validation: str,
    ) -> str:
        symbols = ",".join(asset.symbol for asset in universe)
        return (
            f"universe={symbols}; regime={regime}; macro_regime={macro_analysis.regime}; "
            f"macro_confidence={macro_analysis.confidence}; covariance={request.covariance_method}; "
            f"optimizer={request.optimization_method}; expected_risk={expected_risk:.6f}; "
            f"sharpe={sharpe:.6f}; math_validation={validation}; timestamp={datetime.now(UTC).isoformat()}"
        )
