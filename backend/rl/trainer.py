from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import numpy as np
from paper.engine import PaperTradingError
from paper.runtime import binance_client, paper_engine
from paper.schemas import PaperOrderRequest
from rl.data_loader import MarketDataError, RLMarketDataLoader
from rl.features import RLFeatureBuilder
from rl.metrics import RLMetricCalculator
from rl.schemas import (
    ACTION_NAMES,
    RLPaperValidationRequest,
    RLPaperValidationResult,
    RLTrainRequest,
    RLTrainResult,
)


class RLTrainingService:
    def __init__(
        self,
        *,
        data_loader: RLMarketDataLoader | None = None,
        feature_builder: RLFeatureBuilder | None = None,
        metric_calculator: RLMetricCalculator | None = None,
        model_dir: str | None = None,
    ) -> None:
        self.data_loader = data_loader or RLMarketDataLoader()
        self.feature_builder = feature_builder or RLFeatureBuilder()
        self.metric_calculator = metric_calculator or RLMetricCalculator()
        self.model_dir = Path(model_dir or os.getenv("RL_MODEL_DIR", ".agent-trader-runtime/rl-models")).resolve()
        self.model_dir.mkdir(parents=True, exist_ok=True)

    async def train(self, request: RLTrainRequest) -> RLTrainResult:
        from stable_baselines3 import PPO
        from stable_baselines3.common.vec_env import DummyVecEnv

        from rl.environment import TradingEnvironment

        raw_ohlcv = await self.data_loader.download_ohlcv(
            exchange=request.exchange,
            symbol=request.symbol,
            interval=request.interval,
            limit=request.limit,
        )
        ohlcv, features = self.feature_builder.aligned(raw_ohlcv)
        folds = self._walk_forward_folds(len(ohlcv), train_ratio=request.train_ratio, splits=request.walk_forward_splits)
        if not folds:
            raise ValueError("not enough real historical rows for walk-forward testing")

        best_model = None
        best_score = -float("inf")
        aggregate_equity: list[float] = []
        aggregate_trade_pnls: list[float] = []
        aggregate_test_rows = 0

        for fold_index, (train_end, test_start, test_end) in enumerate(folds):
            train_ohlcv = ohlcv.iloc[:train_end]
            train_features = features.iloc[:train_end]
            test_ohlcv = ohlcv.iloc[test_start:test_end]
            test_features = features.iloc[test_start:test_end]

            def make_train_env():
                return TradingEnvironment(
                    ohlcv=train_ohlcv,
                    features=train_features,
                    initial_cash=request.initial_cash,
                    fee_rate=request.fee_rate,
                    drawdown_penalty=request.drawdown_penalty,
                    volatility_penalty=request.volatility_penalty,
                )

            train_env = DummyVecEnv([make_train_env])
            n_steps = min(128, max(32, len(train_ohlcv) - 2))
            batch_size = self._ppo_batch_size(n_steps)
            model = PPO(
                "MlpPolicy",
                train_env,
                seed=request.seed + fold_index,
                verbose=0,
                n_steps=n_steps,
                batch_size=batch_size,
                gamma=0.99,
            )
            model.learn(total_timesteps=request.total_timesteps)

            test_env = TradingEnvironment(
                ohlcv=test_ohlcv,
                features=test_features,
                initial_cash=request.initial_cash,
                fee_rate=request.fee_rate,
                drawdown_penalty=request.drawdown_penalty,
                volatility_penalty=request.volatility_penalty,
            )
            equity, trade_pnls = self._evaluate_model(model, test_env)
            metrics = self.metric_calculator.calculate(
                equity_curve=equity,
                trade_pnls=trade_pnls,
                walk_forward_splits=1,
                test_rows=len(test_ohlcv),
            )
            score = self._selection_score(metrics)
            if score > best_score:
                best_score = score
                best_model = model
            if not aggregate_equity:
                aggregate_equity.extend(equity)
            else:
                scale = aggregate_equity[-1] / max(equity[0], 1e-12)
                aggregate_equity.extend([value * scale for value in equity[1:]])
            aggregate_trade_pnls.extend(trade_pnls)
            aggregate_test_rows += len(test_ohlcv)

        if best_model is None:
            raise ValueError("RL training produced no valid walk-forward model")

        model_path = self.model_dir / f"ppo_{request.exchange}_{request.symbol}_{datetime.now(UTC).strftime('%Y%m%dT%H%M%S')}_{uuid4().hex[:8]}.zip"
        best_model.save(str(model_path))
        performance = self.metric_calculator.calculate(
            equity_curve=aggregate_equity,
            trade_pnls=aggregate_trade_pnls,
            walk_forward_splits=len(folds),
            test_rows=aggregate_test_rows,
        )
        return RLTrainResult(
            trained_model=str(model_path),
            algorithm="ppo",
            performance_metrics=performance,
            sharpe_ratio=performance.sharpe_ratio,
            max_drawdown=performance.max_drawdown,
            stability_score=performance.stability_score,
        )

    def _evaluate_model(self, model, env) -> tuple[list[float], list[float]]:
        observation, _ = env.reset()
        terminated = False
        while not terminated:
            action, _ = model.predict(observation, deterministic=True)
            observation, _, terminated, _, _ = env.step(int(action))
        return env.equity_curve, env.realized_trade_pnls

    def _walk_forward_folds(self, length: int, *, train_ratio: float, splits: int) -> list[tuple[int, int, int]]:
        min_train = max(60, int(length * train_ratio))
        remaining = length - min_train
        if remaining < 12:
            return []
        test_size = max(12, remaining // splits)
        folds: list[tuple[int, int, int]] = []
        for fold in range(splits):
            train_end = min_train + fold * test_size
            test_start = train_end
            test_end = min(length, test_start + test_size)
            if train_end < 60 or test_end - test_start < 12:
                continue
            folds.append((train_end, test_start, test_end))
        return folds

    def _selection_score(self, metrics) -> float:
        sharpe = metrics.sharpe_ratio or 0.0
        return float(metrics.total_return + 0.15 * sharpe + 0.5 * metrics.max_drawdown + 0.25 * metrics.stability_score)

    def _ppo_batch_size(self, n_steps: int) -> int:
        for candidate in range(min(64, n_steps), 1, -1):
            if n_steps % candidate == 0:
                return candidate
        return n_steps


class RLPaperValidationService:
    def __init__(
        self,
        *,
        data_loader: RLMarketDataLoader | None = None,
        feature_builder: RLFeatureBuilder | None = None,
    ) -> None:
        self.data_loader = data_loader or RLMarketDataLoader()
        self.feature_builder = feature_builder or RLFeatureBuilder()

    async def validate(self, request: RLPaperValidationRequest) -> RLPaperValidationResult:
        from stable_baselines3 import PPO

        model_path = Path(request.trained_model).resolve()
        if not model_path.exists() or not model_path.is_file():
            raise ValueError("trained_model path is not a readable model file")

        raw_ohlcv = await self.data_loader.download_ohlcv(
            exchange=request.exchange,
            symbol=request.symbol,
            interval=request.interval,
            limit=request.lookback,
        )
        _, features = self.feature_builder.aligned(raw_ohlcv)
        latest_features = features.iloc[-1].to_numpy(dtype=np.float32)
        observation = np.concatenate([latest_features, np.array([0.0, 1.0, 0.0], dtype=np.float32)]).astype(np.float32)
        model = PPO.load(str(model_path))
        raw_action, _ = model.predict(observation, deterministic=True)
        action = ACTION_NAMES.get(int(raw_action), "hold")

        if request.exchange == "binance":
            live_price = await binance_client.get_price(request.symbol)
            market_symbol = live_price.symbol
            market_price = live_price.price
            paper_source = "rl_paper_validation_binance_rest"
        else:
            market_symbol, market_price = await self.data_loader.get_bybit_latest_price(request.symbol)
            paper_source = "rl_paper_validation_bybit_rest"

        paper_order_id: str | None = None
        if request.execute_trade and action in {"buy", "sell"}:
            try:
                order = await paper_engine.place_market_order(
                    PaperOrderRequest(symbol=market_symbol, side=action, quantity=request.quantity),
                    market_price=market_price,
                    source=paper_source,
                )
                paper_order_id = order.id
            except PaperTradingError:
                paper_order_id = None

        state = await paper_engine.mark_to_market(
            market_symbol,
            market_price=market_price,
            source=paper_source,
        )
        return RLPaperValidationResult(
            model=str(model_path),
            symbol=market_symbol,
            action=action,
            confidence=None,
            paper_order_id=paper_order_id,
            paper_state=state.model_dump(mode="json"),
            source=f"real_{request.exchange}_ohlcv_features_and_real_{request.exchange}_price_paper_validation",
        )
