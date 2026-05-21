from __future__ import annotations

import os

from pydantic import BaseModel, ConfigDict, Field

from backtest.data_loader import BinanceHistoricalDataLoader, parse_utc_datetime
from backtest.engine import BacktestEngine, StrategyConfig, StrategySignals
from backtest.metrics import MetricsCalculator, PerformanceMetrics
from data_quality.engine import DataQualityEngine
from data_quality.schemas import DataQualityRequest, DataQualityResult
from transaction_cost.engine import TransactionCostEngine
from transaction_cost.schemas import TransactionCostEstimate, TransactionCostRequest
from walk_forward.engine import WalkForwardValidationEngine
from walk_forward.schemas import WalkForwardRequest, WalkForwardValidationResult


class BacktestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str = "BTCUSDT"
    interval: str = "1h"
    start: str | None = None
    end: str | None = None
    limit: int = Field(default=500, ge=60, le=1000)
    strategy: StrategyConfig = Field(default_factory=StrategyConfig)
    validate_data_quality: bool = True
    min_quality_score: float = Field(default=0.75, ge=0.0, le=1.0)
    estimate_transaction_costs: bool = False
    transaction_cost_order_notional: float = Field(default=250.0, gt=10.0, le=1_000_000.0)
    transaction_cost_side: str = Field(default="buy", pattern="^(buy|sell)$")
    gross_edge_bps: float | None = Field(default=None, ge=-10_000.0, le=10_000.0)
    reject_if_edge_below_costs: bool = False
    walk_forward_validate: bool = False
    walk_forward_splits: int = Field(default=4, ge=2, le=10)
    walk_forward_train_ratio: float = Field(default=0.7, gt=0.5, lt=0.9)
    min_walk_forward_score: float = Field(default=0.45, ge=0.0, le=1.0)
    max_walk_forward_overfit_risk: float = Field(default=0.55, ge=0.0, le=1.0)
    reject_if_walk_forward_fails: bool = False


class BacktestResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    interval: str
    rows: int
    start: str
    end: str
    strategy: StrategyConfig
    signals: StrategySignals
    metrics: PerformanceMetrics
    data_quality: DataQualityResult | None = None
    transaction_costs: TransactionCostEstimate | None = None
    walk_forward: WalkForwardValidationResult | None = None


class BacktestRunner:
    def __init__(
        self,
        *,
        data_loader: BinanceHistoricalDataLoader | None = None,
        engine: BacktestEngine | None = None,
        metrics: MetricsCalculator | None = None,
        quality_engine: DataQualityEngine | None = None,
        cost_engine: TransactionCostEngine | None = None,
        walk_forward_engine: WalkForwardValidationEngine | None = None,
    ) -> None:
        self.data_loader = data_loader or BinanceHistoricalDataLoader(
            base_url=os.getenv("BINANCE_REST_BASE_URL", "https://api.binance.com")
        )
        self.engine = engine or BacktestEngine()
        self.metrics = metrics or MetricsCalculator()
        self.quality_engine = quality_engine or DataQualityEngine()
        self.cost_engine = cost_engine or TransactionCostEngine()
        self.walk_forward_engine = walk_forward_engine or WalkForwardValidationEngine()

    async def run(self, request: BacktestRequest) -> BacktestResult:
        ohlcv = await self.data_loader.download_ohlcv(
            symbol=request.symbol,
            interval=request.interval,
            start=parse_utc_datetime(request.start),
            end=parse_utc_datetime(request.end),
            limit=request.limit,
        )
        required_lookback = self.engine.required_lookback(request.strategy)
        if len(ohlcv) < required_lookback + 3:
            raise ValueError("not enough OHLCV rows for selected strategy lookback")

        quality_result: DataQualityResult | None = None
        if request.validate_data_quality:
            quality_request = DataQualityRequest(
                exchange="binance",
                symbol=request.symbol,
                interval=request.interval,
                limit=request.limit,
                compare_cross_exchange=False,
                min_quality_score=request.min_quality_score,
            )
            quality_result = self.quality_engine.evaluate_frame(request=quality_request, frame=ohlcv)
            if not quality_result.usable_for_backtest:
                issue_codes = ", ".join(issue.code for issue in quality_result.issues) or "quality_score_below_threshold"
                raise ValueError(f"data quality check failed before backtest: {issue_codes}")

        transaction_costs: TransactionCostEstimate | None = None
        if request.estimate_transaction_costs:
            transaction_costs = await self.cost_engine.estimate(
                TransactionCostRequest(
                    exchange="binance",
                    symbol=request.symbol,
                    side=request.transaction_cost_side,
                    order_notional=request.transaction_cost_order_notional,
                    gross_edge_bps=request.gross_edge_bps,
                    reject_if_edge_below_costs=request.reject_if_edge_below_costs,
                )
            )
            if request.reject_if_edge_below_costs and not transaction_costs.execution_feasibility:
                issue_codes = ", ".join(transaction_costs.issues) or "edge_below_transaction_costs"
                raise ValueError(f"transaction cost check failed before backtest: {issue_codes}")

        walk_forward_result: WalkForwardValidationResult | None = None
        if request.walk_forward_validate:
            walk_forward_request = WalkForwardRequest(
                exchange="binance",
                symbol=request.symbol,
                interval=request.interval,
                limit=request.limit,
                strategy=request.strategy,
                splits=request.walk_forward_splits,
                train_ratio=request.walk_forward_train_ratio,
                min_walk_forward_score=request.min_walk_forward_score,
                max_overfit_risk=request.max_walk_forward_overfit_risk,
            )
            walk_forward_result = self.walk_forward_engine.validate_frame(
                request=walk_forward_request,
                ohlcv=ohlcv,
            )
            if request.reject_if_walk_forward_fails and not walk_forward_result.accepted:
                issue_codes = ", ".join(walk_forward_result.rejection_reasons) or "walk_forward_validation_failed"
                raise ValueError(f"walk-forward validation failed before backtest: {issue_codes}")

        portfolio, signals = self.engine.run(ohlcv, request.strategy)
        metrics = self.metrics.calculate(portfolio)

        return BacktestResult(
            symbol=request.symbol.upper(),
            interval=request.interval,
            rows=len(ohlcv),
            start=ohlcv.index[0].isoformat(),
            end=ohlcv.index[-1].isoformat(),
            strategy=request.strategy,
            signals=signals,
            metrics=metrics,
            data_quality=quality_result,
            transaction_costs=transaction_costs,
            walk_forward=walk_forward_result,
        )
