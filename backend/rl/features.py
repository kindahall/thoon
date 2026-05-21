from __future__ import annotations

import numpy as np
import pandas as pd


class RLFeatureBuilder:
    FEATURE_COLUMNS = [
        "log_return",
        "range_return",
        "close_open_return",
        "volume_zscore",
        "volatility_10",
        "volatility_30",
        "sma_10_ratio",
        "sma_30_ratio",
        "momentum_10",
        "momentum_30",
    ]

    def build(self, ohlcv: pd.DataFrame) -> pd.DataFrame:
        required_columns = {"open", "high", "low", "close", "volume"}
        missing = required_columns - set(ohlcv.columns)
        if missing:
            raise ValueError(f"OHLCV missing required columns: {', '.join(sorted(missing))}")
        if len(ohlcv) < 60:
            raise ValueError("at least 60 real OHLCV rows are required for RL features")

        close = ohlcv["close"].astype(float)
        open_ = ohlcv["open"].astype(float)
        high = ohlcv["high"].astype(float)
        low = ohlcv["low"].astype(float)
        volume = ohlcv["volume"].astype(float)
        log_return = np.log(close / close.shift(1))
        volume_mean = volume.rolling(30, min_periods=10).mean()
        volume_std = volume.rolling(30, min_periods=10).std(ddof=1)

        features = pd.DataFrame(index=ohlcv.index)
        features["log_return"] = log_return
        features["range_return"] = (high - low) / close
        features["close_open_return"] = (close - open_) / open_
        features["volume_zscore"] = (volume - volume_mean) / volume_std.replace(0.0, np.nan)
        features["volatility_10"] = log_return.rolling(10, min_periods=5).std(ddof=1)
        features["volatility_30"] = log_return.rolling(30, min_periods=10).std(ddof=1)
        features["sma_10_ratio"] = (close / close.rolling(10, min_periods=5).mean()) - 1.0
        features["sma_30_ratio"] = (close / close.rolling(30, min_periods=10).mean()) - 1.0
        features["momentum_10"] = close.pct_change(10)
        features["momentum_30"] = close.pct_change(30)
        features = features.replace([np.inf, -np.inf], np.nan).dropna(how="any")
        if len(features) < 30:
            raise ValueError("not enough usable real OHLCV rows after RL feature engineering")
        return features[self.FEATURE_COLUMNS].astype("float32")

    def aligned(self, ohlcv: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
        features = self.build(ohlcv)
        aligned_ohlcv = ohlcv.loc[features.index].copy()
        return aligned_ohlcv, features
