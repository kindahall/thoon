from __future__ import annotations

import math
from datetime import UTC, datetime

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

from evolution.strategy_store import EvolvableStrategy, PerformanceRecord, PerformanceSource
from paper.schemas import TradeExecution


class PerformanceEvaluator:
    def evaluate_backtest(
        self,
        *,
        ohlcv: pd.DataFrame,
        strategy: EvolvableStrategy,
        source: PerformanceSource,
        symbol: str,
        interval: str,
    ) -> PerformanceRecord:
        if source not in {"backtest_train", "backtest_validation", "backtest_full"}:
            raise ValueError("evaluate_backtest requires a backtest source")
        if len(ohlcv) < strategy.slow_window + 5:
            raise ValueError("not enough real OHLCV rows for strategy evaluation")

        value, trade_pnls = self._run_signal_backtest(ohlcv=ohlcv, strategy=strategy)
        returns = value.pct_change().replace([np.inf, -np.inf], np.nan).dropna()

        total_return = float((value.iloc[-1] / value.iloc[0]) - 1.0)
        sharpe_ratio = self._sharpe_ratio(returns)
        max_drawdown = self._max_drawdown(value)
        win_rate = self._win_rate(trade_pnls)
        profit_factor = self._profit_factor(trade_pnls)
        stability_score = self._stability_score(value)
        total_trades = int(len(trade_pnls))
        score = self.score_metrics(
            total_return=total_return,
            sharpe_ratio=sharpe_ratio,
            max_drawdown=max_drawdown,
            win_rate=win_rate,
            profit_factor=profit_factor,
            stability_score=stability_score,
            total_trades=total_trades,
        )

        return PerformanceRecord(
            strategy_id=strategy.strategy_id,
            source=source,
            symbol=symbol.upper(),
            interval=interval,
            rows=len(ohlcv),
            started_at=ohlcv.index[0].to_pydatetime().astimezone(UTC),
            ended_at=ohlcv.index[-1].to_pydatetime().astimezone(UTC),
            total_return=round(total_return, 8),
            sharpe_ratio=round(sharpe_ratio, 8) if sharpe_ratio is not None else None,
            max_drawdown=round(max_drawdown, 8),
            win_rate=round(win_rate, 8) if win_rate is not None else None,
            profit_factor=round(profit_factor, 8) if profit_factor is not None else None,
            stability_score=round(stability_score, 8),
            total_trades=total_trades,
            score=round(score, 8),
            metadata={
                "fast_window": strategy.fast_window,
                "slow_window": strategy.slow_window,
                "momentum_window": strategy.momentum_window,
                "stop_loss_pct": strategy.stop_loss_pct,
                "take_profit_pct": strategy.take_profit_pct,
            },
        )

    def evaluate_paper_trades(
        self,
        *,
        strategy_id: str,
        symbol: str,
        trades: list[TradeExecution],
    ) -> PerformanceRecord:
        if not trades:
            raise ValueError("no real paper trades available for strategy feedback")

        ordered = sorted(trades, key=lambda trade: trade.timestamp)
        pnl = pd.Series([trade.realized_pnl_delta for trade in ordered], dtype=float)
        notional = pd.Series([trade.notional for trade in ordered], dtype=float).abs()
        capital_proxy = float(notional.sum())
        if capital_proxy <= 0:
            raise ValueError("paper trades contain no positive notional")

        cumulative = pnl.cumsum()
        value = capital_proxy + cumulative
        returns = pnl / notional.replace(0.0, np.nan)
        returns = returns.replace([np.inf, -np.inf], np.nan).dropna()
        total_return = float(cumulative.iloc[-1] / capital_proxy)
        sharpe_ratio = self._sharpe_ratio(returns)
        max_drawdown = self._max_drawdown(value)
        win_rate = self._win_rate(pnl)
        profit_factor = self._profit_factor(pnl)
        stability_score = self._stability_score(value)
        score = self.score_metrics(
            total_return=total_return,
            sharpe_ratio=sharpe_ratio,
            max_drawdown=max_drawdown,
            win_rate=win_rate,
            profit_factor=profit_factor,
            stability_score=stability_score,
            total_trades=len(ordered),
        )

        return PerformanceRecord(
            strategy_id=strategy_id,
            source="paper_trading",
            symbol=symbol.upper(),
            rows=len(ordered),
            started_at=ordered[0].timestamp,
            ended_at=ordered[-1].timestamp,
            total_return=round(total_return, 8),
            sharpe_ratio=round(sharpe_ratio, 8) if sharpe_ratio is not None else None,
            max_drawdown=round(max_drawdown, 8),
            win_rate=round(win_rate, 8) if win_rate is not None else None,
            profit_factor=round(profit_factor, 8) if profit_factor is not None else None,
            stability_score=round(stability_score, 8),
            total_trades=len(ordered),
            score=round(score, 8),
            metadata={"capital_proxy_from_real_notional": round(capital_proxy, 8)},
            created_at=datetime.now(UTC),
        )

    def score_metrics(
        self,
        *,
        total_return: float,
        sharpe_ratio: float | None,
        max_drawdown: float,
        win_rate: float | None,
        profit_factor: float | None,
        stability_score: float,
        total_trades: int,
    ) -> float:
        sharpe_component = 0.0 if sharpe_ratio is None else np.clip((sharpe_ratio + 1.0) / 4.0, 0.0, 1.0)
        return_component = np.clip((total_return + 0.2) / 0.6, 0.0, 1.0)
        drawdown_component = 1.0 - np.clip(abs(max_drawdown) / 0.5, 0.0, 1.0)
        win_component = 0.5 if win_rate is None else np.clip(win_rate, 0.0, 1.0)
        profit_component = 0.5 if profit_factor is None else np.clip(profit_factor / 3.0, 0.0, 1.0)
        activity_component = np.clip(total_trades / 12.0, 0.0, 1.0)
        score = (
            0.25 * sharpe_component
            + 0.18 * return_component
            + 0.18 * drawdown_component
            + 0.14 * win_component
            + 0.14 * profit_component
            + 0.08 * stability_score
            + 0.03 * activity_component
        )
        return float(np.clip(score, 0.0, 1.0))

    def _run_signal_backtest(self, *, ohlcv: pd.DataFrame, strategy: EvolvableStrategy) -> tuple[pd.Series, pd.Series]:
        close = ohlcv["close"]
        fast_ma = close.rolling(strategy.fast_window, min_periods=strategy.fast_window).mean()
        slow_ma = close.rolling(strategy.slow_window, min_periods=strategy.slow_window).mean()
        momentum = close.pct_change(strategy.momentum_window)
        cross_up = (fast_ma > slow_ma) & (fast_ma.shift(1) <= slow_ma.shift(1))
        cross_down = (fast_ma < slow_ma) & (fast_ma.shift(1) >= slow_ma.shift(1))

        entries = self._entry_signals(strategy.entry_condition, close, fast_ma, slow_ma, momentum, cross_up)
        exits = self._exit_signals(strategy.exit_condition, close, fast_ma, momentum, cross_down)

        cash = float(strategy.initial_cash)
        quantity = 0.0
        entry_price = 0.0
        entry_equity = 0.0
        values: list[float] = []
        trade_pnls: list[float] = []

        for timestamp, price in close.items():
            price = float(price)
            if price <= 0:
                values.append(cash + quantity * max(price, 0.0))
                continue

            if quantity > 0:
                stop_hit = strategy.stop_loss_pct > 0 and price <= entry_price * (1.0 - strategy.stop_loss_pct)
                take_profit_hit = strategy.take_profit_pct > 0 and price >= entry_price * (1.0 + strategy.take_profit_pct)
                exit_hit = bool(exits.loc[timestamp]) or stop_hit or take_profit_hit
                if exit_hit:
                    gross_value = quantity * price
                    fee = gross_value * strategy.fees
                    cash = gross_value - fee
                    trade_pnls.append(cash - entry_equity)
                    quantity = 0.0
                    entry_price = 0.0
                    entry_equity = 0.0

            if quantity == 0 and bool(entries.loc[timestamp]) and cash > 0:
                entry_equity = cash
                fee = cash * strategy.fees
                quantity = (cash - fee) / price
                cash = 0.0
                entry_price = price

            values.append(cash + quantity * price)

        value = pd.Series(values, index=close.index, dtype=float)
        return value, pd.Series(trade_pnls, dtype=float)

    def _entry_signals(
        self,
        condition: str,
        close: pd.Series,
        fast_ma: pd.Series,
        slow_ma: pd.Series,
        momentum: pd.Series,
        cross_up: pd.Series,
    ) -> pd.Series:
        if condition == "ma_cross_positive_momentum":
            return cross_up & (momentum > 0)
        if condition == "ma_cross_price_above_slow":
            return cross_up & (close > slow_ma)
        if condition == "trend_following_pullback":
            return (close > slow_ma) & (close.shift(1) < fast_ma.shift(1)) & (close > fast_ma) & (momentum > 0)
        return cross_up

    def _exit_signals(
        self,
        condition: str,
        close: pd.Series,
        fast_ma: pd.Series,
        momentum: pd.Series,
        cross_down: pd.Series,
    ) -> pd.Series:
        if condition == "price_below_fast":
            return (close < fast_ma) & (close.shift(1) >= fast_ma.shift(1))
        if condition == "negative_momentum":
            return momentum < 0
        if condition == "ma_cross_or_negative_momentum":
            return cross_down | (momentum < 0)
        return cross_down

    def _sharpe_ratio(self, returns: pd.Series) -> float | None:
        if returns.empty or len(returns) < 2:
            return None
        std = float(returns.std(ddof=1))
        if std <= 0 or math.isnan(std):
            return None
        return float((returns.mean() / std) * math.sqrt(self._periods_per_year(returns.index)))

    def _periods_per_year(self, index: pd.Index) -> float:
        if not isinstance(index, pd.DatetimeIndex) or len(index) < 2:
            return 365.0
        deltas = pd.Series(index).diff().dropna()
        median_seconds = float(deltas.median().total_seconds())
        if median_seconds <= 0:
            return 365.0
        return (365.0 * 24.0 * 60.0 * 60.0) / median_seconds

    def _max_drawdown(self, value: pd.Series) -> float:
        running_max = value.cummax()
        drawdown = (value / running_max) - 1.0
        return float(drawdown.min())

    def _win_rate(self, pnls: pd.Series) -> float | None:
        if pnls.empty:
            return None
        return float((pnls > 0).sum() / len(pnls))

    def _profit_factor(self, pnls: pd.Series) -> float | None:
        if pnls.empty:
            return None
        gross_profit = float(pnls[pnls > 0].sum())
        gross_loss = float(abs(pnls[pnls < 0].sum()))
        if gross_loss == 0:
            return 10.0 if gross_profit > 0 else None
        return gross_profit / gross_loss

    def _stability_score(self, value: pd.Series) -> float:
        clean = value.astype(float).replace([np.inf, -np.inf], np.nan).dropna()
        if len(clean) < 5:
            return 0.0
        normalized = (clean / clean.iloc[0]) - 1.0
        x = np.arange(len(normalized), dtype=float).reshape(-1, 1)
        y = normalized.to_numpy(dtype=float)
        model = LinearRegression().fit(x, y)
        r2 = max(0.0, float(model.score(x, y)))
        slope_component = 1.0 if float(model.coef_[0]) > 0 else 0.0

        segments = min(8, max(3, len(clean) // 30))
        segment_returns: list[float] = []
        for segment in np.array_split(clean.to_numpy(dtype=float), segments):
            if len(segment) >= 2 and segment[0] != 0:
                segment_returns.append(float((segment[-1] / segment[0]) - 1.0))
        positive_ratio = float(np.mean([item > 0 for item in segment_returns])) if segment_returns else 0.0
        dispersion = float(np.std(segment_returns)) if len(segment_returns) > 1 else 0.0
        dispersion_penalty = min(0.35, dispersion * 2.0)
        score = 0.4 * r2 + 0.35 * positive_ratio + 0.25 * slope_component - dispersion_penalty
        return float(np.clip(score, 0.0, 1.0))
