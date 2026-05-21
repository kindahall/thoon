from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import gymnasium as gym
from gymnasium import spaces

from rl.schemas import ACTION_NAMES


class TradingEnvironment(gym.Env):
    metadata = {"render_modes": []}

    def __init__(
        self,
        *,
        ohlcv: pd.DataFrame,
        features: pd.DataFrame,
        initial_cash: float,
        fee_rate: float,
        drawdown_penalty: float,
        volatility_penalty: float,
    ) -> None:
        self.action_space = spaces.Discrete(3)
        self.observation_space = spaces.Box(
            low=-10.0,
            high=10.0,
            shape=(features.shape[1] + 3,),
            dtype=np.float32,
        )
        self.ohlcv = ohlcv
        self.features = features.astype("float32")
        self.close = ohlcv["close"].astype(float).to_numpy()
        self.initial_cash = float(initial_cash)
        self.fee_rate = float(fee_rate)
        self.drawdown_penalty = float(drawdown_penalty)
        self.volatility_penalty = float(volatility_penalty)
        self.reset()

    def reset(self, *, seed: int | None = None, options: dict[str, Any] | None = None):
        if seed is not None:
            np.random.seed(seed)
        self.step_index = 0
        self.cash = self.initial_cash
        self.quantity = 0.0
        self.entry_equity = 0.0
        self.peak_equity = self.initial_cash
        self.realized_trade_pnls: list[float] = []
        self.equity_curve: list[float] = [self.initial_cash]
        return self._observation(), {}

    def step(self, action: int):
        action = int(action)
        current_price = float(self.close[self.step_index])
        previous_equity = self._equity(current_price)
        self._execute(action, current_price)

        self.step_index += 1
        terminated = self.step_index >= len(self.close) - 1
        next_price = float(self.close[self.step_index])
        if terminated and self.quantity > 0:
            self._execute(2, next_price)

        equity = self._equity(next_price)
        self.peak_equity = max(self.peak_equity, equity)
        drawdown = min(0.0, (equity / self.peak_equity) - 1.0) if self.peak_equity > 0 else 0.0
        volatility = float(abs(self.features.iloc[self.step_index].get("volatility_30", 0.0)))
        exposure = abs(self.quantity * next_price) / max(equity, 1e-12)
        pnl_reward = (equity - previous_equity) / self.initial_cash
        reward = pnl_reward - self.drawdown_penalty * abs(drawdown) - self.volatility_penalty * volatility * exposure
        self.equity_curve.append(equity)
        return self._observation(), float(reward), terminated, False, self._info(equity, drawdown, action)

    def _execute(self, action: int, price: float) -> None:
        if price <= 0:
            return
        if action == 1 and self.quantity <= 0 and self.cash > 0:
            self.entry_equity = self.cash
            fee = self.cash * self.fee_rate
            self.quantity = (self.cash - fee) / price
            self.cash = 0.0
            return
        if action == 2 and self.quantity > 0:
            gross_value = self.quantity * price
            fee = gross_value * self.fee_rate
            self.cash = gross_value - fee
            self.realized_trade_pnls.append(self.cash - self.entry_equity)
            self.quantity = 0.0
            self.entry_equity = 0.0

    def _observation(self) -> np.ndarray:
        row = self.features.iloc[min(self.step_index, len(self.features) - 1)].to_numpy(dtype=np.float32)
        price = float(self.close[min(self.step_index, len(self.close) - 1)])
        equity = self._equity(price)
        exposure = (self.quantity * price) / max(equity, 1e-12)
        cash_ratio = self.cash / max(equity, 1e-12)
        drawdown = min(0.0, (equity / self.peak_equity) - 1.0) if self.peak_equity > 0 else 0.0
        return np.concatenate([row, np.array([exposure, cash_ratio, drawdown], dtype=np.float32)]).astype(np.float32)

    def _equity(self, price: float) -> float:
        return float(self.cash + self.quantity * price)

    def _info(self, equity: float, drawdown: float, action: int) -> dict[str, Any]:
        return {
            "equity": equity,
            "drawdown": drawdown,
            "position_quantity": self.quantity,
            "action": ACTION_NAMES.get(action, "hold"),
            "realized_trades": len(self.realized_trade_pnls),
        }
