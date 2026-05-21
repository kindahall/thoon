from __future__ import annotations

from typing import Any, Literal

import pandas as pd
from pydantic import BaseModel, ConfigDict, Field


StrategyName = Literal[
    "sma_cross",
    "ema_trend",
    "donchian_breakout",
    "rsi_mean_reversion",
    "bollinger_reversion",
    "momentum_volatility",
    "volume_breakout",
]


class StrategyConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: StrategyName = "sma_cross"
    fast_window: int = Field(default=20, ge=2, le=500)
    slow_window: int = Field(default=50, ge=3, le=1000)
    rsi_window: int = Field(default=14, ge=2, le=200)
    rsi_lower: float = Field(default=30.0, ge=1.0, le=60.0)
    rsi_upper: float = Field(default=55.0, ge=40.0, le=99.0)
    donchian_window: int = Field(default=55, ge=3, le=500)
    donchian_exit_window: int = Field(default=20, ge=2, le=500)
    bollinger_window: int = Field(default=20, ge=3, le=500)
    bollinger_std: float = Field(default=2.0, ge=0.5, le=5.0)
    momentum_window: int = Field(default=24, ge=2, le=500)
    volatility_window: int = Field(default=48, ge=3, le=500)
    min_momentum: float = Field(default=0.01, ge=-1.0, le=1.0)
    max_volatility: float = Field(default=0.025, gt=0.0, le=1.0)
    volume_window: int = Field(default=20, ge=2, le=500)
    volume_multiplier: float = Field(default=1.35, ge=0.1, le=10.0)
    initial_cash: float = Field(default=10_000.0, gt=0)
    fees: float = Field(default=0.001, ge=0.0, le=0.1)


class StrategySignals(BaseModel):
    entries_count: int
    exits_count: int


class BacktestEngine:
    def run(self, ohlcv: pd.DataFrame, config: StrategyConfig) -> tuple[Any, StrategySignals]:
        self._validate_config(config)
        close = ohlcv["close"].astype(float)
        entries, exits = self._signals(ohlcv=ohlcv, config=config)
        entries = entries.reindex(close.index, fill_value=False).fillna(False).astype(bool)
        exits = exits.reindex(close.index, fill_value=False).fillna(False).astype(bool)
        entries = entries & ~exits

        try:
            import vectorbt as vbt

            portfolio = vbt.Portfolio.from_signals(
                close=close,
                entries=entries.fillna(False),
                exits=exits.fillna(False),
                init_cash=config.initial_cash,
                fees=config.fees,
                freq=self._infer_freq(ohlcv),
            )
        except ImportError:
            portfolio = SimpleSignalPortfolio.from_signals(
                close=close,
                entries=entries.fillna(False),
                exits=exits.fillna(False),
                initial_cash=config.initial_cash,
                fees=config.fees,
            )
        return portfolio, StrategySignals(entries_count=int(entries.sum()), exits_count=int(exits.sum()))

    def required_lookback(self, config: StrategyConfig) -> int:
        if config.name in {"sma_cross", "ema_trend"}:
            return max(config.fast_window, config.slow_window)
        if config.name == "donchian_breakout":
            return max(config.donchian_window, config.donchian_exit_window)
        if config.name == "rsi_mean_reversion":
            return config.rsi_window
        if config.name == "bollinger_reversion":
            return config.bollinger_window
        if config.name == "momentum_volatility":
            return max(config.momentum_window, config.volatility_window)
        if config.name == "volume_breakout":
            return max(config.fast_window, config.slow_window, config.volume_window)
        return max(config.fast_window, config.slow_window)

    def _signals(self, *, ohlcv: pd.DataFrame, config: StrategyConfig) -> tuple[pd.Series, pd.Series]:
        close = ohlcv["close"].astype(float)

        if config.name == "sma_cross":
            fast_ma = close.rolling(config.fast_window, min_periods=config.fast_window).mean()
            slow_ma = close.rolling(config.slow_window, min_periods=config.slow_window).mean()
            return self._crosses_above(fast_ma, slow_ma), self._crosses_below(fast_ma, slow_ma)

        if config.name == "ema_trend":
            fast_ema = close.ewm(span=config.fast_window, adjust=False, min_periods=config.fast_window).mean()
            slow_ema = close.ewm(span=config.slow_window, adjust=False, min_periods=config.slow_window).mean()
            entries = self._crosses_above(fast_ema, slow_ema) & (close > slow_ema)
            exits = self._crosses_below(fast_ema, slow_ema) | (close < slow_ema)
            return entries, exits

        if config.name == "donchian_breakout":
            upper = ohlcv["high"].astype(float).rolling(config.donchian_window, min_periods=config.donchian_window).max().shift(1)
            lower = ohlcv["low"].astype(float).rolling(config.donchian_exit_window, min_periods=config.donchian_exit_window).min().shift(1)
            return close > upper, close < lower

        if config.name == "rsi_mean_reversion":
            rsi = self._rsi(close, config.rsi_window)
            entries = rsi <= config.rsi_lower
            exits = rsi >= config.rsi_upper
            return entries, exits

        if config.name == "bollinger_reversion":
            middle = close.rolling(config.bollinger_window, min_periods=config.bollinger_window).mean()
            deviation = close.rolling(config.bollinger_window, min_periods=config.bollinger_window).std(ddof=0)
            lower = middle - (config.bollinger_std * deviation)
            return close < lower, close >= middle

        if config.name == "momentum_volatility":
            momentum = close.pct_change(config.momentum_window)
            volatility = close.pct_change().rolling(config.volatility_window, min_periods=config.volatility_window).std(ddof=0)
            entries = (momentum >= config.min_momentum) & (volatility <= config.max_volatility)
            exits = (momentum <= 0) | (volatility > config.max_volatility * 1.5)
            return entries, exits

        if config.name == "volume_breakout":
            previous_high = ohlcv["high"].astype(float).rolling(config.fast_window, min_periods=config.fast_window).max().shift(1)
            slow_ma = close.rolling(config.slow_window, min_periods=config.slow_window).mean()
            average_volume = ohlcv["volume"].astype(float).rolling(config.volume_window, min_periods=config.volume_window).mean()
            volume_confirmed = ohlcv["volume"].astype(float) >= average_volume * config.volume_multiplier
            entries = (close > previous_high) & (close > slow_ma) & volume_confirmed
            exits = close < slow_ma
            return entries, exits

        raise ValueError(f"unsupported strategy: {config.name}")

    def _validate_config(self, config: StrategyConfig) -> None:
        if config.name in {"sma_cross", "ema_trend", "volume_breakout"} and config.fast_window >= config.slow_window:
            raise ValueError("fast_window must be lower than slow_window")
        if config.name == "rsi_mean_reversion" and config.rsi_lower >= config.rsi_upper:
            raise ValueError("rsi_lower must be lower than rsi_upper")

    def _crosses_above(self, left: pd.Series, right: pd.Series) -> pd.Series:
        return (left > right) & (left.shift(1) <= right.shift(1))

    def _crosses_below(self, left: pd.Series, right: pd.Series) -> pd.Series:
        return (left < right) & (left.shift(1) >= right.shift(1))

    def _rsi(self, close: pd.Series, window: int) -> pd.Series:
        delta = close.diff()
        gains = delta.clip(lower=0.0)
        losses = -delta.clip(upper=0.0)
        average_gain = gains.ewm(alpha=1 / window, adjust=False, min_periods=window).mean()
        average_loss = losses.ewm(alpha=1 / window, adjust=False, min_periods=window).mean()
        relative_strength = average_gain / average_loss.replace(0.0, float("nan"))
        return 100.0 - (100.0 / (1.0 + relative_strength))

    def _infer_freq(self, ohlcv: pd.DataFrame) -> str | None:
        if len(ohlcv.index) < 2:
            return None
        delta = ohlcv.index.to_series().diff().dropna().median()
        seconds = int(delta.total_seconds())
        if seconds <= 0:
            return None
        if seconds % 86400 == 0:
            return f"{seconds // 86400}D"
        if seconds % 3600 == 0:
            return f"{seconds // 3600}H"
        if seconds % 60 == 0:
            return f"{seconds // 60}T"
        return f"{seconds}S"


class SimpleSignalPortfolio:
    def __init__(self, value_series: pd.Series, trades: pd.DataFrame) -> None:
        self._value_series = value_series
        self.trades = SimpleTradeRecords(trades)

    @classmethod
    def from_signals(
        cls,
        *,
        close: pd.Series,
        entries: pd.Series,
        exits: pd.Series,
        initial_cash: float,
        fees: float,
    ) -> "SimpleSignalPortfolio":
        cash = float(initial_cash)
        position_quantity = 0.0
        entry_equity = float(initial_cash)
        entry_time = None
        values: list[float] = []
        records: list[dict[str, float | str]] = []

        for timestamp, price_value in close.items():
            price = float(price_value)
            if price <= 0:
                values.append(cash + position_quantity * price)
                continue

            if position_quantity == 0 and bool(entries.loc[timestamp]):
                entry_equity = cash
                fee = cash * fees
                position_quantity = (cash - fee) / price
                cash = 0.0
                entry_time = timestamp
            elif position_quantity > 0 and bool(exits.loc[timestamp]):
                gross = position_quantity * price
                fee = gross * fees
                cash = gross - fee
                pnl = cash - entry_equity
                records.append(
                    {
                        "Entry Timestamp": str(entry_time),
                        "Exit Timestamp": str(timestamp),
                        "PnL": pnl,
                        "Return": pnl / entry_equity if entry_equity else 0.0,
                    }
                )
                position_quantity = 0.0
                entry_time = None

            values.append(cash + position_quantity * price)

        return cls(pd.Series(values, index=close.index, dtype=float), pd.DataFrame.from_records(records))

    def value(self) -> pd.Series:
        return self._value_series


class SimpleTradeRecords:
    def __init__(self, records: pd.DataFrame) -> None:
        self.records_readable = records

    def count(self) -> int:
        return int(len(self.records_readable))
