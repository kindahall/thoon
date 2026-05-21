from __future__ import annotations

import hashlib
import json
import math
from datetime import UTC, datetime
from typing import Any

import numpy as np
import pandas as pd

from backtest.engine import BacktestEngine, StrategyConfig
from research_platform.ranking import RankingSystem
from research_platform.regime import RegimeAnalysisModule
from research_platform.schemas import (
    EvaluationSplitMetrics,
    QuantResearchRequest,
    StrategyEvaluationRecord,
    StrategyPerformanceMetrics,
    StrategyRegistryRecord,
)


class EvaluationEngineError(RuntimeError):
    pass


class EvaluationEngine:
    def __init__(
        self,
        *,
        backtest_engine: BacktestEngine | None = None,
        regime_module: RegimeAnalysisModule | None = None,
        ranking: RankingSystem | None = None,
    ) -> None:
        self.backtest_engine = backtest_engine or BacktestEngine()
        self.regime_module = regime_module or RegimeAnalysisModule()
        self.ranking = ranking or RankingSystem()

    def evaluate(
        self,
        *,
        request: QuantResearchRequest,
        strategy: StrategyRegistryRecord,
        ohlcv: pd.DataFrame,
    ) -> StrategyEvaluationRecord:
        config = self._config_from_strategy(request=request, strategy=strategy)
        required_lookback = self.backtest_engine.required_lookback(config)
        if len(ohlcv) < max(120, required_lookback * 3):
            raise EvaluationEngineError("not enough real OHLCV rows for temporal evaluation")

        train_data, validation_data, test_data = self._split(
            ohlcv,
            train_ratio=request.train_ratio,
            validation_ratio=request.validation_ratio,
        )
        train = self._run_split("train", train_data, config)
        validation = self._run_split("validation", validation_data, config)
        test = self._run_split("test", test_data, config)
        full = self._run_split("full", ohlcv, config)
        full_portfolio, _ = self.backtest_engine.run(ohlcv, config)
        regime_breakdown = self.regime_module.breakdown(ohlcv=ohlcv, portfolio_value=full_portfolio.value())
        decision = self.ranking.score(request=request, train=train, validation=validation, test=test)
        evaluation_id = self._evaluation_id(request=request, strategy=strategy, data_start=ohlcv.index[0], data_end=ohlcv.index[-1])
        return StrategyEvaluationRecord(
            evaluation_id=evaluation_id,
            strategy_id=strategy.strategy_id,
            version_id=strategy.version_id,
            exchange=request.exchange,
            symbol=request.symbol,
            interval=request.interval,
            rows=len(ohlcv),
            data_start=ohlcv.index[0].to_pydatetime().astimezone(UTC),
            data_end=ohlcv.index[-1].to_pydatetime().astimezone(UTC),
            train=train,
            validation=validation,
            test=test,
            full=full,
            regime_breakdown=regime_breakdown,
            overfit_score=decision.overfit_score,
            ranking_score=decision.ranking_score,
            selection_status="selected" if not decision.rejection_reasons else "rejected",
            rejection_reasons=decision.rejection_reasons,
            created_at=datetime.now(UTC),
        )

    def _run_split(self, split: str, ohlcv: pd.DataFrame, config: StrategyConfig) -> EvaluationSplitMetrics:
        if len(ohlcv) < self.backtest_engine.required_lookback(config) + 3:
            raise EvaluationEngineError(f"not enough rows for {split} split")
        portfolio, _ = self.backtest_engine.run(ohlcv, config)
        value = portfolio.value()
        return EvaluationSplitMetrics(
            split=split,
            rows=len(ohlcv),
            start=ohlcv.index[0].to_pydatetime().astimezone(UTC),
            end=ohlcv.index[-1].to_pydatetime().astimezone(UTC),
            metrics=self._metrics(portfolio=portfolio, value=value),
        )

    def _config_from_strategy(self, *, request: QuantResearchRequest, strategy: StrategyRegistryRecord) -> StrategyConfig:
        allowed_fields = set(StrategyConfig.model_fields)
        params = {key: value for key, value in strategy.params.items() if key in allowed_fields}
        return StrategyConfig(
            **params,
            name=strategy.strategy_type,
            initial_cash=request.initial_cash,
            fees=request.fees,
        )

    def _metrics(self, *, portfolio: Any, value: pd.Series) -> StrategyPerformanceMetrics:
        clean_value = value.astype(float).replace([np.inf, -np.inf], np.nan).dropna()
        returns = clean_value.pct_change().replace([np.inf, -np.inf], np.nan).dropna()
        total_return = 0.0 if len(clean_value) < 2 else float((clean_value.iloc[-1] / clean_value.iloc[0]) - 1.0)
        total_trades = int(self._scalar(portfolio.trades.count()))
        win_rate, profit_factor = self._trade_metrics(portfolio=portfolio, total_trades=total_trades)
        return StrategyPerformanceMetrics(
            total_return=round(total_return, 8),
            sharpe_ratio=self._round_optional(self._sharpe_ratio(returns)),
            sortino_ratio=self._round_optional(self._sortino_ratio(returns)),
            max_drawdown=round(self._max_drawdown(clean_value), 8),
            win_rate=self._round_optional(win_rate),
            profit_factor=self._round_optional(profit_factor),
            stability_over_time=round(self._stability(clean_value), 8),
            total_trades=total_trades,
            final_value=round(float(clean_value.iloc[-1]), 8),
        )

    def _trade_metrics(self, *, portfolio: Any, total_trades: int) -> tuple[float | None, float | None]:
        if total_trades == 0:
            return None, None
        readable = portfolio.trades.records_readable
        pnl: pd.Series | None = None
        if "PnL" in readable.columns:
            pnl = readable["PnL"].astype(float)
        elif "Return" in readable.columns:
            pnl = readable["Return"].astype(float)
        if pnl is None or pnl.empty:
            return None, None
        wins = pnl[pnl > 0]
        losses = pnl[pnl < 0]
        win_rate = float(len(wins) / total_trades)
        if losses.empty:
            profit_factor = None if wins.empty else float("inf")
        else:
            profit_factor = float(wins.sum() / abs(losses.sum())) if abs(float(losses.sum())) > 0 else None
        if profit_factor is not None and math.isinf(profit_factor):
            profit_factor = 10.0
        return win_rate, profit_factor

    def _split(
        self,
        ohlcv: pd.DataFrame,
        *,
        train_ratio: float,
        validation_ratio: float,
    ) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        train_end = int(len(ohlcv) * train_ratio)
        validation_end = train_end + int(len(ohlcv) * validation_ratio)
        train = ohlcv.iloc[:train_end]
        validation = ohlcv.iloc[train_end:validation_end]
        test = ohlcv.iloc[validation_end:]
        if min(len(train), len(validation), len(test)) < 30:
            raise EvaluationEngineError("temporal split too small for reproducible evaluation")
        return train, validation, test

    def _sharpe_ratio(self, returns: pd.Series) -> float | None:
        if returns.empty:
            return None
        std = float(returns.std(ddof=1))
        if std == 0 or math.isnan(std):
            return None
        return float((returns.mean() / std) * math.sqrt(self._periods_per_year(returns.index)))

    def _sortino_ratio(self, returns: pd.Series) -> float | None:
        if returns.empty:
            return None
        downside = returns[returns < 0]
        if downside.empty:
            return None
        downside_std = float(downside.std(ddof=1))
        if downside_std == 0 or math.isnan(downside_std):
            return None
        return float((returns.mean() / downside_std) * math.sqrt(self._periods_per_year(returns.index)))

    def _periods_per_year(self, index: pd.Index) -> float:
        if len(index) < 2:
            return 365.0
        deltas = pd.Series(index).diff().dropna()
        median_seconds = float(deltas.median().total_seconds())
        if median_seconds <= 0:
            return 365.0
        return (365.0 * 24.0 * 60.0 * 60.0) / median_seconds

    def _max_drawdown(self, value: pd.Series) -> float:
        if value.empty:
            return 0.0
        running_max = value.cummax()
        drawdown = (value / running_max) - 1.0
        return float(drawdown.min())

    def _stability(self, value: pd.Series) -> float:
        clean = value.astype(float).replace([np.inf, -np.inf], np.nan).dropna()
        if len(clean) < 5 or clean.iloc[0] == 0:
            return 0.0
        normalized = (clean / clean.iloc[0]) - 1.0
        x = np.arange(len(normalized), dtype=float)
        y = normalized.to_numpy(dtype=float)
        slope = float(np.polyfit(x, y, 1)[0])
        correlation = float(np.corrcoef(x, y)[0, 1]) if len(x) > 1 and float(np.std(y)) > 0 else 0.0
        r2 = max(0.0, correlation * correlation)
        segments = min(8, max(3, len(clean) // 20))
        segment_returns = [
            float((segment[-1] / segment[0]) - 1.0)
            for segment in np.array_split(clean.to_numpy(dtype=float), segments)
            if len(segment) >= 2 and segment[0] != 0
        ]
        positive_ratio = float(np.mean([item > 0 for item in segment_returns])) if segment_returns else 0.0
        slope_component = 1.0 if slope > 0 else 0.0
        return float(np.clip(0.4 * r2 + 0.35 * positive_ratio + 0.25 * slope_component, 0.0, 1.0))

    def _evaluation_id(
        self,
        *,
        request: QuantResearchRequest,
        strategy: StrategyRegistryRecord,
        data_start: pd.Timestamp,
        data_end: pd.Timestamp,
    ) -> str:
        payload = {
            "version_id": strategy.version_id,
            "exchange": request.exchange,
            "symbol": request.symbol,
            "interval": request.interval,
            "data_start": data_start.isoformat(),
            "data_end": data_end.isoformat(),
            "fees": request.fees,
            "initial_cash": request.initial_cash,
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return f"eval_{hashlib.sha256(encoded).hexdigest()[:18]}"

    def _round_optional(self, value: float | None) -> float | None:
        if value is None or math.isnan(value):
            return None
        return round(float(value), 8)

    def _scalar(self, value: Any) -> float:
        if hasattr(value, "iloc"):
            return float(value.iloc[0])
        if hasattr(value, "item"):
            return float(value.item())
        return float(value)
