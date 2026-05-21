from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict


class PerformanceMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_return: float
    sharpe_ratio: float | None
    max_drawdown: float
    win_rate: float | None
    total_trades: int
    final_value: float


class MetricsCalculator:
    def calculate(self, portfolio: Any) -> PerformanceMetrics:
        value = portfolio.value()
        returns = value.pct_change().replace([np.inf, -np.inf], np.nan).dropna()
        sharpe = self._sharpe_ratio(returns)
        max_drawdown = self._max_drawdown(value)
        total_return = float((value.iloc[-1] / value.iloc[0]) - 1.0)
        total_trades = int(self._scalar(portfolio.trades.count()))
        win_rate = self._win_rate(portfolio)

        return PerformanceMetrics(
            total_return=round(total_return, 8),
            sharpe_ratio=round(sharpe, 8) if sharpe is not None else None,
            max_drawdown=round(max_drawdown, 8),
            win_rate=round(win_rate, 8) if win_rate is not None else None,
            total_trades=total_trades,
            final_value=round(float(value.iloc[-1]), 8),
        )

    def _sharpe_ratio(self, returns: pd.Series) -> float | None:
        if returns.empty:
            return None
        std = float(returns.std(ddof=1))
        if std == 0 or math.isnan(std):
            return None
        periods_per_year = self._periods_per_year(returns.index)
        return float((returns.mean() / std) * math.sqrt(periods_per_year))

    def _periods_per_year(self, index: pd.Index) -> float:
        if len(index) < 2:
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

    def _win_rate(self, portfolio: Any) -> float | None:
        total_trades = int(self._scalar(portfolio.trades.count()))
        if total_trades == 0:
            return None
        readable = portfolio.trades.records_readable
        if "Return" in readable.columns:
            wins = (readable["Return"] > 0).sum()
            return float(wins / total_trades)
        if "PnL" in readable.columns:
            wins = (readable["PnL"] > 0).sum()
            return float(wins / total_trades)
        return None

    def _scalar(self, value: Any) -> float:
        if hasattr(value, "iloc"):
            return float(value.iloc[0])
        if hasattr(value, "item"):
            return float(value.item())
        return float(value)
