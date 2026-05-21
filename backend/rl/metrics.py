from __future__ import annotations

import math

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

from rl.schemas import RLPerformanceMetrics


class RLMetricCalculator:
    def calculate(
        self,
        *,
        equity_curve: list[float],
        trade_pnls: list[float],
        walk_forward_splits: int,
        test_rows: int,
    ) -> RLPerformanceMetrics:
        values = pd.Series(equity_curve, dtype=float)
        returns = values.pct_change().replace([np.inf, -np.inf], np.nan).dropna()
        total_return = float((values.iloc[-1] / values.iloc[0]) - 1.0) if len(values) > 1 and values.iloc[0] else 0.0
        sharpe_ratio = self._sharpe_ratio(returns)
        max_drawdown = self._max_drawdown(values)
        win_rate = self._win_rate(pd.Series(trade_pnls, dtype=float))
        profit_factor = self._profit_factor(pd.Series(trade_pnls, dtype=float))
        stability_score = self._stability_score(values)
        return RLPerformanceMetrics(
            total_return=round(total_return, 8),
            final_equity=round(float(values.iloc[-1]), 8),
            total_trades=len(trade_pnls),
            win_rate=round(win_rate, 8) if win_rate is not None else None,
            profit_factor=round(profit_factor, 8) if profit_factor is not None else None,
            sharpe_ratio=round(sharpe_ratio, 8) if sharpe_ratio is not None else None,
            max_drawdown=round(max_drawdown, 8),
            stability_score=round(stability_score, 8),
            walk_forward_splits=walk_forward_splits,
            test_rows=test_rows,
        )

    def _sharpe_ratio(self, returns: pd.Series) -> float | None:
        if returns.empty or len(returns) < 2:
            return None
        std = float(returns.std(ddof=1))
        if std <= 0 or math.isnan(std):
            return None
        return float((returns.mean() / std) * math.sqrt(365 * 24))

    def _max_drawdown(self, values: pd.Series) -> float:
        running_max = values.cummax()
        drawdown = (values / running_max) - 1.0
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

    def _stability_score(self, values: pd.Series) -> float:
        clean = values.astype(float).replace([np.inf, -np.inf], np.nan).dropna()
        if len(clean) < 5:
            return 0.0
        normalized = (clean / clean.iloc[0]) - 1.0
        x = np.arange(len(normalized), dtype=float).reshape(-1, 1)
        y = normalized.to_numpy(dtype=float)
        model = LinearRegression().fit(x, y)
        r2 = max(0.0, float(model.score(x, y)))
        positive_slope = 1.0 if float(model.coef_[0]) > 0 else 0.0
        segment_returns = []
        for segment in np.array_split(clean.to_numpy(dtype=float), min(8, max(3, len(clean) // 30))):
            if len(segment) >= 2 and segment[0] != 0:
                segment_returns.append(float((segment[-1] / segment[0]) - 1.0))
        positive_segments = float(np.mean([item > 0 for item in segment_returns])) if segment_returns else 0.0
        dispersion_penalty = min(0.35, (float(np.std(segment_returns)) if len(segment_returns) > 1 else 0.0) * 2.0)
        return float(np.clip(0.4 * r2 + 0.35 * positive_segments + 0.25 * positive_slope - dispersion_penalty, 0.0, 1.0))
