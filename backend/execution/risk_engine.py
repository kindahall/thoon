from __future__ import annotations

import os
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class RiskSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_order_notional: float = Field(default=1_000.0, gt=0)
    max_position_notional: float = Field(default=5_000.0, gt=0)
    max_total_exposure: float = Field(default=10_000.0, gt=0)
    max_leverage: float = Field(default=1.0, ge=1.0)
    max_drawdown_fraction: float = Field(default=0.05, gt=0, lt=1)
    price_incoherence_bps: float = Field(default=50.0, gt=0)
    min_live_strategy_confidence: float = Field(default=0.55, ge=0.0, le=1.0)
    allow_short: bool = False

    @classmethod
    def from_env(cls) -> "RiskSettings":
        return cls(
            max_order_notional=float(os.getenv("EXECUTION_MAX_ORDER_NOTIONAL", "1000")),
            max_position_notional=float(os.getenv("EXECUTION_MAX_POSITION_NOTIONAL", "5000")),
            max_total_exposure=float(os.getenv("EXECUTION_MAX_TOTAL_EXPOSURE", "10000")),
            max_leverage=float(os.getenv("EXECUTION_MAX_LEVERAGE", "1")),
            max_drawdown_fraction=float(os.getenv("EXECUTION_MAX_DRAWDOWN_FRACTION", "0.05")),
            price_incoherence_bps=float(os.getenv("EXECUTION_PRICE_INCOHERENCE_BPS", "50")),
            min_live_strategy_confidence=float(os.getenv("EXECUTION_MIN_LIVE_STRATEGY_CONFIDENCE", "0.55")),
            allow_short=os.getenv("EXECUTION_ALLOW_SHORT", "false").lower() == "true",
        )


class RiskCheckResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepted: bool
    violations: list[str]
    notional: float
    projected_exposure: float


class RiskEngine:
    def __init__(self, settings: RiskSettings | None = None) -> None:
        self.settings = settings or RiskSettings.from_env()

    def validate_order(
        self,
        *,
        request: Any,
        market_price: float,
        current_position_quantity: float,
        current_position_notional: float,
        total_exposure: float,
        live: bool,
    ) -> RiskCheckResult:
        notional = request.quantity * market_price
        projected_position = abs(current_position_notional) + notional
        projected_total = abs(total_exposure) + notional
        violations: list[str] = []

        if notional > self.settings.max_order_notional:
            violations.append("max_order_notional")
        if projected_position > self.settings.max_position_notional:
            violations.append("max_position_notional")
        if projected_total > self.settings.max_total_exposure:
            violations.append("max_total_exposure")
        if request.leverage > self.settings.max_leverage:
            violations.append("max_leverage")
        projected_quantity = current_position_quantity + (request.quantity if request.side == "buy" else -request.quantity)
        if not self.settings.allow_short and projected_quantity < -1e-12:
            violations.append("short_not_allowed")
        if live and request.strategy_confidence is not None and request.strategy_confidence < self.settings.min_live_strategy_confidence:
            violations.append("abnormal_strategy_confidence")

        return RiskCheckResult(
            accepted=not violations,
            violations=violations,
            notional=round(notional, 8),
            projected_exposure=round(projected_total, 8),
        )

    def price_incoherence_breached(self, first_price: float, second_price: float, threshold_bps: float | None = None) -> bool:
        if first_price <= 0 or second_price <= 0:
            return True
        bps = abs(second_price - first_price) / first_price * 10_000
        return bps > (threshold_bps or self.settings.price_incoherence_bps)

    def reference_price_breached(self, reference_price: float, market_price: float, max_slippage_bps: float) -> bool:
        if reference_price <= 0 or market_price <= 0:
            return True
        bps = abs(market_price - reference_price) / reference_price * 10_000
        return bps > max_slippage_bps

    def drawdown_breached(self, *, peak_equity: float, current_equity: float) -> bool:
        if peak_equity <= 0:
            return False
        drawdown = (peak_equity - current_equity) / peak_equity
        return drawdown > self.settings.max_drawdown_fraction
