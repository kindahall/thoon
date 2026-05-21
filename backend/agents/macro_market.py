from __future__ import annotations

import asyncio
import math
import os
import statistics
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field

from gateway.llm_gateway import LLMGatewayService
from services.binance import BinanceClient
from services.schemas import Candle, Price, Ticker24h


Regime = Literal["risk_on", "risk_off", "neutral"]


class MacroSignal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    value: float | str
    direction: Literal["bullish", "bearish", "neutral"]
    weight: float = Field(ge=0.0, le=1.0)


class MacroAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    regime: Regime
    confidence: float = Field(ge=0.0, le=1.0)
    signals: list[MacroSignal]
    explanation: str


class MacroAnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    interval: str = "1h"
    limit: int = Field(default=168, ge=30, le=1000)
    include_fred: bool = True
    llm_model: str | None = None


class AssetMetrics(BaseModel):
    symbol: str
    price: float
    trend_percent: float
    realized_volatility_percent: float
    change_24h_percent: float
    quote_volume_24h: float


class FredObservation(BaseModel):
    series_id: str
    value: float
    previous_value: float | None = None
    change: float | None = None
    date: str


class MacroMarketSnapshot(BaseModel):
    assets: list[AssetMetrics]
    btc_eth_quote_volume_dominance: float
    fred: list[FredObservation]
    fred_status: Literal["available", "missing_api_key", "unavailable"]
    deterministic_regime: Regime
    deterministic_confidence: float
    deterministic_signals: list[MacroSignal]


class MacroMarketAgent:
    def __init__(
        self,
        *,
        binance_client: BinanceClient | None = None,
        gateway: LLMGatewayService | None = None,
    ) -> None:
        self.binance_client = binance_client or BinanceClient()
        self.gateway = gateway or LLMGatewayService()
        self.fred_base_url = os.getenv("FRED_BASE_URL", "https://api.stlouisfed.org/fred")
        self.fred_api_key = os.getenv("FRED_API_KEY")

    async def analyze(self, request: MacroAnalyzeRequest) -> MacroAnalysis:
        snapshot = await self.collect_snapshot(request)
        prompt = self._build_llm_prompt(snapshot)
        system_prompt = (
            "You are the Macro Market Agent inside a quant trading system. "
            "Use only the provided real market snapshot. "
            "Do not invent data. Keep the regime conservative when evidence conflicts."
        )
        return await self.gateway.invoke_structured(
            prompt=prompt,
            output_model=MacroAnalysis,
            system_prompt=system_prompt,
            model=request.llm_model,
            max_retries=2,
        )

    async def collect_snapshot(self, request: MacroAnalyzeRequest) -> MacroMarketSnapshot:
        btc_price, eth_price, btc_ticker, eth_ticker, btc_candles, eth_candles = await asyncio.gather(
            self.binance_client.get_price("BTCUSDT"),
            self.binance_client.get_price("ETHUSDT"),
            self.binance_client.get_24h_ticker("BTCUSDT"),
            self.binance_client.get_24h_ticker("ETHUSDT"),
            self.binance_client.get_candles("BTCUSDT", interval=request.interval, limit=request.limit),
            self.binance_client.get_candles("ETHUSDT", interval=request.interval, limit=request.limit),
        )

        assets = [
            self._asset_metrics("BTCUSDT", btc_price, btc_ticker, btc_candles),
            self._asset_metrics("ETHUSDT", eth_price, eth_ticker, eth_candles),
        ]
        dominance = self._btc_eth_quote_volume_dominance(btc_ticker, eth_ticker)
        fred, fred_status = await self._collect_fred() if request.include_fred else ([], "unavailable")
        regime, confidence, signals = self._deterministic_regime(assets, dominance, fred)

        return MacroMarketSnapshot(
            assets=assets,
            btc_eth_quote_volume_dominance=dominance,
            fred=fred,
            fred_status=fred_status,
            deterministic_regime=regime,
            deterministic_confidence=confidence,
            deterministic_signals=signals,
        )

    def _asset_metrics(
        self,
        symbol: str,
        price: Price,
        ticker: Ticker24h,
        candles: list[Candle],
    ) -> AssetMetrics:
        closes = [candle.close for candle in candles]
        if len(closes) < 30:
            raise ValueError(f"not enough candles for {symbol}")

        lookback = min(20, len(closes))
        sma = statistics.fmean(closes[-lookback:])
        trend_percent = ((closes[-1] - sma) / sma) * 100 if sma else 0.0
        volatility_percent = self._realized_volatility_percent(closes)

        return AssetMetrics(
            symbol=symbol,
            price=price.price,
            trend_percent=round(trend_percent, 4),
            realized_volatility_percent=round(volatility_percent, 4),
            change_24h_percent=ticker.price_change_percent,
            quote_volume_24h=ticker.quote_volume,
        )

    def _realized_volatility_percent(self, closes: list[float]) -> float:
        returns = [
            math.log(closes[index] / closes[index - 1])
            for index in range(1, len(closes))
            if closes[index - 1] > 0 and closes[index] > 0
        ]
        if len(returns) < 2:
            return 0.0
        return statistics.stdev(returns) * math.sqrt(365 * 24) * 100

    def _btc_eth_quote_volume_dominance(self, btc_ticker: Ticker24h, eth_ticker: Ticker24h) -> float:
        total = btc_ticker.quote_volume + eth_ticker.quote_volume
        if total <= 0:
            return 0.0
        return round(btc_ticker.quote_volume / total, 6)

    async def _collect_fred(self) -> tuple[list[FredObservation], Literal["available", "missing_api_key", "unavailable"]]:
        if not self.fred_api_key:
            return [], "missing_api_key"

        observations: list[FredObservation] = []
        for series_id in ("VIXCLS", "DGS10"):
            try:
                observation = await self._fetch_fred_observation(series_id)
                if observation:
                    observations.append(observation)
            except httpx.HTTPError:
                return observations, "unavailable"

        return observations, "available" if observations else "unavailable"

    async def _fetch_fred_observation(self, series_id: str) -> FredObservation | None:
        params = {
            "series_id": series_id,
            "api_key": self.fred_api_key,
            "file_type": "json",
            "sort_order": "desc",
            "limit": 10,
        }
        async with httpx.AsyncClient(base_url=self.fred_base_url, timeout=10) as client:
            response = await client.get("/series/observations", params=params)
            response.raise_for_status()
            payload = response.json()

        numeric: list[tuple[str, float]] = []
        for item in payload.get("observations", []):
            raw_value = item.get("value")
            if raw_value in (None, "."):
                continue
            numeric.append((item["date"], float(raw_value)))
            if len(numeric) == 2:
                break

        if not numeric:
            return None

        date, value = numeric[0]
        previous_value = numeric[1][1] if len(numeric) > 1 else None
        return FredObservation(
            series_id=series_id,
            value=value,
            previous_value=previous_value,
            change=round(value - previous_value, 6) if previous_value is not None else None,
            date=date,
        )

    def _deterministic_regime(
        self,
        assets: list[AssetMetrics],
        dominance: float,
        fred: list[FredObservation],
    ) -> tuple[Regime, float, list[MacroSignal]]:
        score = 0.0
        signals: list[MacroSignal] = []

        btc = next(asset for asset in assets if asset.symbol == "BTCUSDT")
        eth = next(asset for asset in assets if asset.symbol == "ETHUSDT")

        crypto_trend = (btc.trend_percent + eth.trend_percent) / 2
        if crypto_trend > 0.15:
            score += 0.35
            trend_direction: Literal["bullish", "bearish", "neutral"] = "bullish"
        elif crypto_trend < -0.15:
            score -= 0.35
            trend_direction = "bearish"
        else:
            trend_direction = "neutral"
        signals.append(MacroSignal(name="crypto_trend_percent", value=round(crypto_trend, 4), direction=trend_direction, weight=0.35))

        average_24h = (btc.change_24h_percent + eth.change_24h_percent) / 2
        if average_24h > 1.0:
            score += 0.25
            change_direction: Literal["bullish", "bearish", "neutral"] = "bullish"
        elif average_24h < -1.0:
            score -= 0.25
            change_direction = "bearish"
        else:
            change_direction = "neutral"
        signals.append(MacroSignal(name="crypto_24h_change_percent", value=round(average_24h, 4), direction=change_direction, weight=0.25))

        volatility = btc.realized_volatility_percent
        if volatility > 85 and crypto_trend < 0:
            score -= 0.2
            volatility_direction: Literal["bullish", "bearish", "neutral"] = "bearish"
        elif volatility < 55 and crypto_trend > 0:
            score += 0.1
            volatility_direction = "bullish"
        else:
            volatility_direction = "neutral"
        signals.append(MacroSignal(name="btc_realized_volatility_percent", value=round(volatility, 4), direction=volatility_direction, weight=0.2))

        if dominance > 0.62 and eth.trend_percent < btc.trend_percent:
            score -= 0.1
            dominance_direction: Literal["bullish", "bearish", "neutral"] = "bearish"
        elif dominance < 0.55 and eth.trend_percent > btc.trend_percent:
            score += 0.1
            dominance_direction = "bullish"
        else:
            dominance_direction = "neutral"
        signals.append(MacroSignal(name="btc_eth_quote_volume_dominance", value=dominance, direction=dominance_direction, weight=0.1))

        for observation in fred:
            if observation.series_id == "VIXCLS":
                if observation.value >= 25:
                    score -= 0.25
                    direction: Literal["bullish", "bearish", "neutral"] = "bearish"
                elif observation.value <= 18:
                    score += 0.15
                    direction = "bullish"
                else:
                    direction = "neutral"
                signals.append(MacroSignal(name="fred_vix", value=observation.value, direction=direction, weight=0.25))
            if observation.series_id == "DGS10" and observation.change is not None:
                if observation.change > 0.08:
                    score -= 0.08
                    direction = "bearish"
                elif observation.change < -0.08:
                    score += 0.05
                    direction = "bullish"
                else:
                    direction = "neutral"
                signals.append(MacroSignal(name="fred_10y_yield_change", value=observation.change, direction=direction, weight=0.08))

        if score >= 0.25:
            regime: Regime = "risk_on"
        elif score <= -0.25:
            regime = "risk_off"
        else:
            regime = "neutral"

        confidence = min(0.95, max(0.35, abs(score) + 0.4))
        return regime, round(confidence, 4), signals

    def _build_llm_prompt(self, snapshot: MacroMarketSnapshot) -> str:
        return (
            "Analyze the real macro/crypto snapshot and return the final structured regime.\n"
            "Rules:\n"
            "- Use regime values only: risk_on, risk_off, neutral.\n"
            "- Confidence must be 0.0 to 1.0.\n"
            "- Keep signals grounded in snapshot fields.\n"
            "- If FRED status is missing_api_key or unavailable, do not invent macro values.\n\n"
            f"SNAPSHOT_JSON:\n{snapshot.model_dump_json()}"
        )
