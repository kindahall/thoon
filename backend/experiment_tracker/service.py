from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import UTC, datetime
from typing import Any

import pandas as pd

from backtest.engine import BacktestEngine
from backtest.metrics import MetricsCalculator, PerformanceMetrics
from data_quality.engine import DataQualityEngine, DataQualityError
from data_quality.schemas import DataQualityRequest
from experiment_tracker.schemas import (
    ExperimentDataset,
    ExperimentDecision,
    ExperimentRecord,
    ExperimentResults,
    ExperimentStatus,
    ExperimentTrackerRequest,
)
from experiment_tracker.storage import PostgresExperimentStore
from rl.data_loader import RLMarketDataLoader, normalize_market_error
from walk_forward.engine import WalkForwardValidationEngine
from walk_forward.schemas import WalkForwardRequest, WalkForwardValidationResult


class ExperimentTrackerError(RuntimeError):
    pass


class ExperimentTrackerService:
    def __init__(
        self,
        *,
        store: PostgresExperimentStore | None = None,
        data_loader: RLMarketDataLoader | None = None,
        data_quality: DataQualityEngine | None = None,
        backtest_engine: BacktestEngine | None = None,
        metrics: MetricsCalculator | None = None,
        walk_forward: WalkForwardValidationEngine | None = None,
    ) -> None:
        self.store = store or PostgresExperimentStore()
        self.data_loader = data_loader or RLMarketDataLoader()
        self.data_quality = data_quality or DataQualityEngine(market_loader=self.data_loader)
        self.backtest_engine = backtest_engine or BacktestEngine()
        self.metrics = metrics or MetricsCalculator()
        self.walk_forward = walk_forward or WalkForwardValidationEngine(
            data_loader=self.data_loader,
            backtest_engine=self.backtest_engine,
            metrics=self.metrics,
        )

    async def track(self, request: ExperimentTrackerRequest) -> ExperimentRecord:
        await asyncio.to_thread(self.store.ensure_schema)
        try:
            ohlcv = await self.data_loader.download_ohlcv(
                exchange=request.exchange,
                symbol=request.symbol,
                interval=request.interval,
                limit=request.lookback,
            )
        except Exception as error:
            raise normalize_market_error(error) from error

        frame = self._validate_frame(ohlcv)
        quality_request = DataQualityRequest(
            exchange=request.exchange,
            symbol=request.symbol,
            interval=request.interval,
            limit=request.lookback,
            compare_cross_exchange=request.compare_cross_exchange,
            min_quality_score=request.min_quality_score,
        )
        try:
            comparison = None
            if request.compare_cross_exchange:
                comparison = await self.data_quality._cross_exchange_comparison(request=quality_request, primary=frame)
            quality = self.data_quality.evaluate_frame(request=quality_request, frame=frame, comparison=comparison)
        except DataQualityError as error:
            raise ExperimentTrackerError(str(error)) from error

        dataset = ExperimentDataset(
            exchange=request.exchange,
            symbol=request.symbol,
            interval=request.interval,
            rows=len(frame),
            data_start=frame.index[0].to_pydatetime(),
            data_end=frame.index[-1].to_pydatetime(),
            data_sources=self._data_sources(request.exchange),
            quality_score=quality.quality_score,
            quality_issues=quality.issues,
        )

        metrics: PerformanceMetrics | None = None
        signals = None
        walk_forward_result: WalkForwardValidationResult | None = None
        errors: list[str] = []
        if quality.usable_for_backtest:
            portfolio, signals = self.backtest_engine.run(frame, request.strategy)
            metrics = self.metrics.calculate(portfolio)
            if request.run_walk_forward:
                try:
                    walk_forward_result = self.walk_forward.validate_frame(
                        request=WalkForwardRequest(
                            exchange=request.exchange,
                            symbol=request.symbol,
                            interval=request.interval,
                            limit=request.lookback,
                            strategy=request.strategy,
                            splits=request.walk_forward_splits,
                            train_ratio=request.walk_forward_train_ratio,
                            min_walk_forward_score=request.min_walk_forward_score,
                            max_overfit_risk=request.max_walk_forward_overfit_risk,
                        ),
                        ohlcv=frame,
                    )
                except Exception as error:
                    errors.append(f"walk_forward_failed:{error}")
        else:
            issue_codes = ",".join(issue.code for issue in quality.issues) or "quality_score_below_threshold"
            errors.append(f"data_quality_rejected:{issue_codes}")

        results = ExperimentResults(
            backtest_metrics=metrics,
            signals=signals,
            walk_forward=walk_forward_result,
            errors=errors,
        )
        decision = self._decision(request=request, quality_usable=quality.usable_for_backtest, results=results)
        strategy_hash = self._strategy_hash(request)
        strategy_version = f"{request.strategy.name}_v{strategy_hash[:12]}"
        config_hash = self._config_hash(request=request, dataset=dataset, strategy_hash=strategy_hash)
        record = ExperimentRecord(
            experiment_id=f"exp_{config_hash[:18]}",
            status=decision.status,
            reproducible=True,
            strategy_version=strategy_version,
            strategy_content_hash=strategy_hash,
            config_hash=config_hash,
            request=request,
            dataset=dataset,
            results=results,
            decision=decision,
            persisted=False,
            created_at=datetime.now(UTC),
        )
        return await asyncio.to_thread(self.store.upsert_experiment, record)

    async def get(self, experiment_id: str) -> ExperimentRecord:
        return await asyncio.to_thread(self.store.get_experiment, experiment_id)

    async def list(
        self,
        *,
        limit: int,
        status: ExperimentStatus | None,
        symbol: str | None,
    ) -> list[ExperimentRecord]:
        return await asyncio.to_thread(self.store.list_experiments, limit=limit, status=status, symbol=symbol)

    def _validate_frame(self, ohlcv: pd.DataFrame) -> pd.DataFrame:
        required_columns = {"open", "high", "low", "close", "volume"}
        missing_columns = required_columns.difference(ohlcv.columns)
        if missing_columns:
            raise ExperimentTrackerError(f"OHLCV frame missing columns: {', '.join(sorted(missing_columns))}")
        if ohlcv.empty:
            raise ExperimentTrackerError("OHLCV frame is empty")
        frame = ohlcv.sort_index().copy()
        if frame.index.tz is None:
            frame.index = frame.index.tz_localize("UTC")
        if not frame.index.is_monotonic_increasing:
            raise ExperimentTrackerError("OHLCV timestamps must be monotonic")
        if frame.index.has_duplicates:
            raise ExperimentTrackerError("OHLCV timestamps contain duplicates")
        return frame

    def _decision(
        self,
        *,
        request: ExperimentTrackerRequest,
        quality_usable: bool,
        results: ExperimentResults,
    ) -> ExperimentDecision:
        reasons: list[str] = []
        if not quality_usable:
            reasons.append("data_quality_gate_failed")
        metrics = results.backtest_metrics
        if metrics is None:
            reasons.append("backtest_metrics_unavailable")
        else:
            if metrics.total_trades < request.min_total_trades:
                reasons.append("insufficient_total_trades")
            if metrics.total_return < request.min_total_return:
                reasons.append("total_return_below_threshold")
            if abs(metrics.max_drawdown) > request.max_drawdown:
                reasons.append("max_drawdown_exceeded")

        if request.run_walk_forward:
            if results.walk_forward is None:
                reasons.append("walk_forward_unavailable")
            else:
                if not results.walk_forward.accepted:
                    reasons.extend([f"walk_forward:{reason}" for reason in results.walk_forward.rejection_reasons])
                if results.walk_forward.walk_forward_score < request.min_walk_forward_score:
                    reasons.append("walk_forward_score_below_threshold")
                if results.walk_forward.overfit_risk > request.max_walk_forward_overfit_risk:
                    reasons.append("walk_forward_overfit_risk_exceeded")

        status: ExperimentStatus = "accepted" if not reasons else "rejected"
        return ExperimentDecision(
            status=status,
            accepted=status == "accepted",
            rejection_reasons=sorted(set(reasons)),
            acceptance_criteria={
                "min_quality_score": request.min_quality_score,
                "min_total_trades": request.min_total_trades,
                "min_total_return": request.min_total_return,
                "max_drawdown": request.max_drawdown,
                "run_walk_forward": request.run_walk_forward,
                "min_walk_forward_score": request.min_walk_forward_score,
                "max_walk_forward_overfit_risk": request.max_walk_forward_overfit_risk,
            },
        )

    def _strategy_hash(self, request: ExperimentTrackerRequest) -> str:
        payload = request.strategy.model_dump(mode="json")
        return self._sha256(payload)

    def _config_hash(self, *, request: ExperimentTrackerRequest, dataset: ExperimentDataset, strategy_hash: str) -> str:
        payload = {
            "request": request.model_dump(mode="json"),
            "strategy_content_hash": strategy_hash,
            "dataset": {
                "exchange": dataset.exchange,
                "symbol": dataset.symbol,
                "interval": dataset.interval,
                "rows": dataset.rows,
                "data_start": dataset.data_start.isoformat(),
                "data_end": dataset.data_end.isoformat(),
                "data_sources": dataset.data_sources,
            },
        }
        return self._sha256(payload)

    def _sha256(self, payload: dict[str, Any]) -> str:
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(encoded).hexdigest()

    def _data_sources(self, exchange: str) -> list[str]:
        if exchange == "binance":
            return ["binance:/api/v3/klines", "vectorbt:Portfolio.from_signals"]
        return ["bybit:/v5/market/kline", "vectorbt:Portfolio.from_signals"]
