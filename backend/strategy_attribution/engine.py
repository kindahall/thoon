from __future__ import annotations

from datetime import UTC, datetime

import numpy as np
import pandas as pd

from backtest.engine import BacktestEngine, StrategyConfig
from backtest.metrics import MetricsCalculator
from data_quality.engine import DataQualityEngine, DataQualityError
from data_quality.schemas import DataQualityRequest
from rl.data_loader import RLMarketDataLoader, normalize_market_error
from strategy_attribution.schemas import (
    AttributionBucket,
    SignalContribution,
    StrategyAttributionRequest,
    StrategyAttributionResult,
)


class StrategyAttributionError(RuntimeError):
    pass


class StrategyAttributionEngine:
    def __init__(
        self,
        *,
        data_loader: RLMarketDataLoader | None = None,
        data_quality: DataQualityEngine | None = None,
        backtest_engine: BacktestEngine | None = None,
        metrics: MetricsCalculator | None = None,
    ) -> None:
        self.data_loader = data_loader or RLMarketDataLoader()
        self.data_quality = data_quality or DataQualityEngine(market_loader=self.data_loader)
        self.backtest_engine = backtest_engine or BacktestEngine()
        self.metrics = metrics or MetricsCalculator()

    async def analyze(self, request: StrategyAttributionRequest) -> StrategyAttributionResult:
        try:
            ohlcv = await self.data_loader.download_ohlcv(
                exchange=request.exchange,
                symbol=request.symbol,
                interval=request.interval,
                limit=request.lookback,
            )
        except Exception as error:
            raise normalize_market_error(error) from error

        frame = self._validate_frame(ohlcv, request.strategy)
        quality_request = DataQualityRequest(
            exchange=request.exchange,
            symbol=request.symbol,
            interval=request.interval,
            limit=request.lookback,
            compare_cross_exchange=request.compare_cross_exchange,
            min_quality_score=request.min_data_quality_score,
        )
        try:
            comparison = None
            if request.compare_cross_exchange:
                comparison = await self.data_quality._cross_exchange_comparison(request=quality_request, primary=frame)
            quality = self.data_quality.evaluate_frame(request=quality_request, frame=frame, comparison=comparison)
        except DataQualityError as error:
            raise StrategyAttributionError(str(error)) from error

        if not quality.usable_for_backtest:
            issue_codes = ", ".join(issue.code for issue in quality.issues) or "unknown_data_quality_issue"
            raise StrategyAttributionError(f"real OHLCV data rejected by quality gate: {issue_codes}")

        portfolio, _signals = self.backtest_engine.run(frame, request.strategy)
        performance = self.metrics.calculate(portfolio)
        state = self._strategy_state(frame=frame, config=request.strategy, portfolio=portfolio)
        benchmark_return = self._compound_return(state["benchmark_return"])
        attribution = self._build_attribution(state=state, request=request)
        signal_contribution = self._signal_contribution(state=state, request=request)
        strengths, weaknesses = self._strengths_and_weaknesses(
            performance=performance,
            benchmark_return=benchmark_return,
            attribution=attribution,
            signal_contribution=signal_contribution,
        )

        return StrategyAttributionResult(
            exchange=request.exchange,
            symbol=request.symbol,
            interval=request.interval,
            rows=len(frame),
            data_start=frame.index[0].to_pydatetime(),
            data_end=frame.index[-1].to_pydatetime(),
            strategy=request.strategy,
            performance=performance,
            benchmark_return=self._round(benchmark_return),
            data_quality_score=quality.quality_score,
            data_quality_issues=quality.issues,
            attribution=attribution,
            signal_contribution=signal_contribution,
            strengths=strengths,
            weaknesses=weaknesses,
            data_sources=self._data_sources(request.exchange),
            generated_at=datetime.now(UTC),
        )

    def _validate_frame(self, ohlcv: pd.DataFrame, strategy: StrategyConfig) -> pd.DataFrame:
        required_columns = {"open", "high", "low", "close", "volume"}
        missing_columns = required_columns.difference(ohlcv.columns)
        if missing_columns:
            raise StrategyAttributionError(f"OHLCV frame missing columns: {', '.join(sorted(missing_columns))}")
        if ohlcv.empty:
            raise StrategyAttributionError("OHLCV frame is empty")
        frame = ohlcv.sort_index().copy()
        if frame.index.tz is None:
            frame.index = frame.index.tz_localize("UTC")
        if not frame.index.is_monotonic_increasing:
            raise StrategyAttributionError("OHLCV timestamps must be monotonic")
        if frame.index.has_duplicates:
            raise StrategyAttributionError("OHLCV timestamps contain duplicates")
        min_rows = max(strategy.slow_window + 5, 80)
        if len(frame) < min_rows:
            raise StrategyAttributionError("not enough real OHLCV rows for strategy attribution")
        for column in required_columns:
            frame[column] = pd.to_numeric(frame[column], errors="raise")
        return frame

    def _strategy_state(self, *, frame: pd.DataFrame, config: StrategyConfig, portfolio: object) -> pd.DataFrame:
        close = frame["close"].astype(float)
        volume = frame["volume"].astype(float)
        fast_ma = close.rolling(config.fast_window, min_periods=config.fast_window).mean()
        slow_ma = close.rolling(config.slow_window, min_periods=config.slow_window).mean()
        entries = ((fast_ma > slow_ma) & (fast_ma.shift(1) <= slow_ma.shift(1))).fillna(False)
        exits = ((fast_ma < slow_ma) & (fast_ma.shift(1) >= slow_ma.shift(1))).fillna(False)

        raw_position = pd.Series(np.nan, index=frame.index, dtype=float)
        raw_position.loc[entries] = 1.0
        raw_position.loc[exits] = 0.0
        raw_position = raw_position.ffill().fillna(0.0)
        execution_position = raw_position.shift(1).fillna(0.0)
        benchmark_return = close.pct_change().replace([np.inf, -np.inf], np.nan).fillna(0.0)
        portfolio_value = portfolio.value().reindex(frame.index).ffill()
        strategy_return = portfolio_value.pct_change().replace([np.inf, -np.inf], np.nan).fillna(0.0)

        state = pd.DataFrame(
            {
                "close": close,
                "volume": volume,
                "fast_ma": fast_ma,
                "slow_ma": slow_ma,
                "entry": entries.astype(bool),
                "exit": exits.astype(bool),
                "position": execution_position,
                "benchmark_return": benchmark_return,
                "strategy_return": strategy_return,
            },
            index=frame.index,
        )
        lookback = max(12, min(72, len(state) // 6))
        state["trend_return"] = close.pct_change(lookback).replace([np.inf, -np.inf], np.nan)
        state["rolling_volatility"] = benchmark_return.rolling(lookback, min_periods=max(6, lookback // 2)).std()
        state["regime"] = self._regime_labels(state)
        state["volatility_bucket"] = self._volatility_buckets(state["rolling_volatility"])
        state["hour_bucket"] = [f"{timestamp.hour:02d}:00" for timestamp in state.index]
        state["weekday_bucket"] = [timestamp.day_name().lower() for timestamp in state.index]
        return state

    def _regime_labels(self, state: pd.DataFrame) -> pd.Series:
        labels = pd.Series("neutral", index=state.index, dtype=object)
        trend = state["trend_return"].fillna(0.0)
        volatility = state["rolling_volatility"].fillna(0.0)
        volume = state["volume"].astype(float)
        high_vol_threshold = float(volatility.quantile(0.75)) if len(volatility.dropna()) else 0.0
        low_liquidity_threshold = float(volume.quantile(0.25)) if len(volume.dropna()) else 0.0

        labels.loc[trend > 0.0] = "bull_market"
        labels.loc[trend < 0.0] = "bear_market"
        labels.loc[volatility >= high_vol_threshold] = "high_volatility"
        labels.loc[volume <= low_liquidity_threshold] = "low_liquidity"
        return labels

    def _volatility_buckets(self, volatility: pd.Series) -> pd.Series:
        clean = volatility.replace([np.inf, -np.inf], np.nan)
        if clean.dropna().empty:
            return pd.Series("undefined_volatility", index=volatility.index, dtype=object)
        low_threshold = float(clean.quantile(0.33))
        high_threshold = float(clean.quantile(0.66))
        buckets = pd.Series("medium_volatility", index=volatility.index, dtype=object)
        buckets.loc[clean <= low_threshold] = "low_volatility"
        buckets.loc[clean >= high_threshold] = "high_volatility"
        buckets.loc[clean.isna()] = "undefined_volatility"
        return buckets

    def _build_attribution(
        self,
        *,
        state: pd.DataFrame,
        request: StrategyAttributionRequest,
    ) -> dict[str, dict[str, AttributionBucket]]:
        return {
            "regime": self._bucket_group(state=state, labels=state["regime"], min_rows=request.min_bucket_rows),
            "hour": self._bucket_group(state=state, labels=state["hour_bucket"], min_rows=request.min_bucket_rows),
            "weekday": self._bucket_group(state=state, labels=state["weekday_bucket"], min_rows=request.min_bucket_rows),
            "volatility": self._bucket_group(
                state=state,
                labels=state["volatility_bucket"],
                min_rows=request.min_bucket_rows,
            ),
            "exchange": self._bucket_group(
                state=state,
                labels=pd.Series(request.exchange, index=state.index),
                min_rows=request.min_bucket_rows,
            ),
        }

    def _bucket_group(
        self,
        *,
        state: pd.DataFrame,
        labels: pd.Series,
        min_rows: int,
    ) -> dict[str, AttributionBucket]:
        buckets: dict[str, AttributionBucket] = {}
        total_rows = len(state)
        total_strategy_sum = float(state["strategy_return"].sum())
        denominator = total_strategy_sum if abs(total_strategy_sum) > 1e-12 else 1.0
        for label in sorted(str(value) for value in labels.dropna().unique()):
            mask = labels.astype(str) == label
            subset = state.loc[mask]
            if len(subset) < min_rows:
                continue
            strategy_returns = subset["strategy_return"].replace([np.inf, -np.inf], np.nan).dropna()
            benchmark_returns = subset["benchmark_return"].replace([np.inf, -np.inf], np.nan).dropna()
            active_returns = strategy_returns[strategy_returns != 0.0]
            hit_rate = None if active_returns.empty else float((active_returns > 0.0).mean())
            volatility = None if len(strategy_returns) < 2 else float(strategy_returns.std(ddof=1))
            buckets[label] = AttributionBucket(
                name=label,
                rows=len(subset),
                bar_ratio=self._round(len(subset) / total_rows),
                strategy_return=self._round(self._compound_return(strategy_returns)),
                benchmark_return=self._round(self._compound_return(benchmark_returns)),
                excess_return=self._round(
                    self._compound_return(strategy_returns) - self._compound_return(benchmark_returns)
                ),
                hit_rate=None if hit_rate is None else self._round(hit_rate),
                average_strategy_return=self._round(float(strategy_returns.mean()) if not strategy_returns.empty else 0.0),
                volatility=None if volatility is None else self._round(volatility),
                contribution_to_total_return=self._round(float(strategy_returns.sum()) / denominator),
            )
        return buckets

    def _signal_contribution(
        self,
        *,
        state: pd.DataFrame,
        request: StrategyAttributionRequest,
    ) -> dict[str, SignalContribution]:
        forward_bars = min(request.forward_bars, max(1, len(state) - 1))
        close = state["close"].astype(float)
        forward_return = (close.shift(-forward_bars) / close - 1.0).replace([np.inf, -np.inf], np.nan)
        return {
            "entry_signal": self._forward_signal(
                name="entry_signal",
                mask=state["entry"],
                values=forward_return,
                forward_bars=forward_bars,
            ),
            "exit_signal": self._forward_signal(
                name="exit_signal",
                mask=state["exit"],
                values=-forward_return,
                forward_bars=forward_bars,
            ),
            "in_position_bars": self._bar_signal(
                name="in_position_bars",
                mask=state["position"] > 0.0,
                values=state["strategy_return"],
                forward_bars=1,
            ),
        }

    def _forward_signal(
        self,
        *,
        name: str,
        mask: pd.Series,
        values: pd.Series,
        forward_bars: int,
    ) -> SignalContribution:
        signal_values = values.loc[mask.astype(bool)].dropna()
        return self._signal_from_values(name=name, values=signal_values, forward_bars=forward_bars)

    def _bar_signal(
        self,
        *,
        name: str,
        mask: pd.Series,
        values: pd.Series,
        forward_bars: int,
    ) -> SignalContribution:
        signal_values = values.loc[mask.astype(bool)].replace([np.inf, -np.inf], np.nan).dropna()
        return self._signal_from_values(name=name, values=signal_values, forward_bars=forward_bars)

    def _signal_from_values(self, *, name: str, values: pd.Series, forward_bars: int) -> SignalContribution:
        if values.empty:
            return SignalContribution(
                signal=name,
                count=0,
                forward_bars=forward_bars,
                average_forward_return=None,
                median_forward_return=None,
                hit_rate=None,
                total_contribution=0.0,
                best_timestamp=None,
                worst_timestamp=None,
            )
        best_timestamp = values.idxmax()
        worst_timestamp = values.idxmin()
        return SignalContribution(
            signal=name,
            count=len(values),
            forward_bars=forward_bars,
            average_forward_return=self._round(float(values.mean())),
            median_forward_return=self._round(float(values.median())),
            hit_rate=self._round(float((values > 0.0).mean())),
            total_contribution=self._round(float(values.sum())),
            best_timestamp=best_timestamp.to_pydatetime(),
            worst_timestamp=worst_timestamp.to_pydatetime(),
        )

    def _strengths_and_weaknesses(
        self,
        *,
        performance,
        benchmark_return: float,
        attribution: dict[str, dict[str, AttributionBucket]],
        signal_contribution: dict[str, SignalContribution],
    ) -> tuple[list[str], list[str]]:
        strengths: list[str] = []
        weaknesses: list[str] = []
        excess = performance.total_return - benchmark_return
        if excess > 0.0:
            strengths.append(f"outperformed_buy_hold_by_{self._round(excess)}")
        elif excess < 0.0:
            weaknesses.append(f"underperformed_buy_hold_by_{self._round(abs(excess))}")

        if performance.sharpe_ratio is not None and performance.sharpe_ratio >= 1.0:
            strengths.append(f"positive_risk_adjusted_return_sharpe_{self._round(performance.sharpe_ratio)}")
        elif performance.sharpe_ratio is not None and performance.sharpe_ratio < 0.0:
            weaknesses.append(f"negative_risk_adjusted_return_sharpe_{self._round(performance.sharpe_ratio)}")

        if performance.max_drawdown > -0.10:
            strengths.append(f"controlled_drawdown_{self._round(performance.max_drawdown)}")
        elif performance.max_drawdown <= -0.25:
            weaknesses.append(f"large_drawdown_{self._round(performance.max_drawdown)}")

        if performance.total_trades == 0:
            weaknesses.append("no_completed_trades_on_real_sample")

        regime_buckets = list(attribution.get("regime", {}).values())
        if regime_buckets:
            best_regime = max(regime_buckets, key=lambda bucket: bucket.excess_return)
            worst_regime = min(regime_buckets, key=lambda bucket: bucket.excess_return)
            if best_regime.excess_return > 0.0:
                strengths.append(f"best_regime_{best_regime.name}_excess_{best_regime.excess_return}")
            if worst_regime.excess_return < 0.0:
                weaknesses.append(f"weak_regime_{worst_regime.name}_excess_{worst_regime.excess_return}")

        high_vol = attribution.get("volatility", {}).get("high_volatility")
        if high_vol is not None and high_vol.excess_return > 0.0:
            strengths.append(f"high_volatility_resilience_excess_{high_vol.excess_return}")
        elif high_vol is not None and high_vol.excess_return < 0.0:
            weaknesses.append(f"high_volatility_drag_excess_{high_vol.excess_return}")

        low_liquidity = attribution.get("regime", {}).get("low_liquidity")
        if low_liquidity is not None and low_liquidity.excess_return < 0.0:
            weaknesses.append(f"low_liquidity_underperformance_excess_{low_liquidity.excess_return}")

        entry = signal_contribution.get("entry_signal")
        if entry is not None and entry.hit_rate is not None:
            if entry.hit_rate >= 0.55:
                strengths.append(f"entry_signal_positive_forward_hit_rate_{entry.hit_rate}")
            elif entry.hit_rate <= 0.45:
                weaknesses.append(f"entry_signal_weak_forward_hit_rate_{entry.hit_rate}")

        exit_signal = signal_contribution.get("exit_signal")
        if exit_signal is not None and exit_signal.hit_rate is not None:
            if exit_signal.hit_rate >= 0.55:
                strengths.append(f"exit_signal_avoids_forward_losses_hit_rate_{exit_signal.hit_rate}")
            elif exit_signal.hit_rate <= 0.45:
                weaknesses.append(f"exit_signal_poor_forward_avoidance_hit_rate_{exit_signal.hit_rate}")

        return strengths, weaknesses

    def _compound_return(self, returns: pd.Series) -> float:
        clean = returns.replace([np.inf, -np.inf], np.nan).dropna()
        if clean.empty:
            return 0.0
        return float(np.prod(1.0 + clean.to_numpy(dtype=float)) - 1.0)

    def _data_sources(self, exchange: str) -> list[str]:
        if exchange == "binance":
            return ["binance:/api/v3/klines", "vectorbt:Portfolio.from_signals"]
        return ["bybit:/v5/market/kline", "vectorbt:Portfolio.from_signals"]

    def _round(self, value: float) -> float:
        if np.isnan(value) or np.isinf(value):
            return 0.0
        return round(float(value), 8)
