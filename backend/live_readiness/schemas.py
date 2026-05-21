from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from execution.kill_switch import KillSwitchStatus
from execution.order_manager import ExchangeName, PositionRecord
from services.binance import normalize_symbol

ReadinessStatus = Literal["passed", "warning", "blocked", "failed"]
ReconciliationStatus = Literal["matched", "mismatch", "blocked", "skipped"]


class LiveReadinessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchanges: list[ExchangeName] = Field(default_factory=lambda: ["binance", "bybit", "bitget", "hyperliquid", "dydx"], min_length=1, max_length=5)
    symbols: list[str] = Field(default_factory=lambda: ["BTCUSDT"], min_length=1, max_length=10)
    category: Literal["spot", "linear", "inverse", "option"] = "spot"
    check_api_permissions: bool = True
    check_live_positions: bool = True
    max_allowed_live_positions: int = Field(default=0, ge=0, le=100)
    require_audit_trail: bool = True
    require_paper_promotion_evidence: bool = True
    paper_symbol: str = "BTCUSDT"
    min_paper_trades: int = Field(default=1, ge=0, le=1000)
    min_safety_score: float = Field(default=0.85, ge=0.0, le=1.0)

    @field_validator("symbols")
    @classmethod
    def normalize_symbols(cls, values: list[str]) -> list[str]:
        return [normalize_symbol(value) for value in values]

    @field_validator("paper_symbol")
    @classmethod
    def normalize_paper_symbol(cls, value: str) -> str:
        return normalize_symbol(value)


class ReadinessCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    status: ReadinessStatus
    score: float = Field(ge=0.0, le=1.0)
    blockers: list[str]
    details: dict[str, str | int | float | bool | None]


class ExchangeReadiness(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName
    public_market_data_ok: bool
    latest_prices: dict[str, float]
    credentials_present: bool
    live_trading_enabled: bool
    live_execution_supported: bool
    wallet_signer_required: bool
    permission_verified: bool
    can_trade: bool | None
    withdrawals_enabled: bool | None
    blockers: list[str]
    source: str


class PositionReconciliation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exchange: ExchangeName
    status: ReconciliationStatus
    exchange_positions: list[PositionRecord]
    system_positions: list[PositionRecord]
    mismatches: list[str]
    blockers: list[str]


class LiveReadinessResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    live_ready: bool
    blockers: list[str]
    safety_score: float = Field(ge=0.0, le=1.0)
    exchanges: list[ExchangeReadiness]
    position_reconciliation: list[PositionReconciliation]
    audit_trail: ReadinessCheck
    idempotency_keys: ReadinessCheck
    partial_fills: ReadinessCheck
    paper_to_live_promotion: ReadinessCheck
    risk_limits: ReadinessCheck
    emergency_shutdown: ReadinessCheck
    kill_switch: KillSwitchStatus
    generated_at: datetime


class EmergencyShutdownRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detail: str = Field(default="manual live-readiness emergency shutdown", min_length=1, max_length=500)
