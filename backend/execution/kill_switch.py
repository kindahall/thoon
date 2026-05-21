from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

KillSwitchReason = Literal[
    "manual",
    "drawdown_limit",
    "api_error_spike",
    "price_incoherence",
    "latency_excessive",
    "abnormal_strategy_behavior",
]


class KillSwitchStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active: bool
    reason: KillSwitchReason | None = None
    detail: str | None = None
    triggered_at: datetime | None = None
    api_error_count: int
    latency_threshold_ms: float
    api_error_spike_threshold: int


class KillSwitchCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["trigger", "reset", "status"] = "trigger"
    reason: KillSwitchReason = "manual"
    detail: str | None = None


class KillSwitch:
    def __init__(
        self,
        *,
        api_error_spike_threshold: int = 5,
        api_error_window_seconds: int = 60,
        latency_threshold_ms: float = 2500.0,
    ) -> None:
        self.api_error_spike_threshold = api_error_spike_threshold
        self.api_error_window_seconds = api_error_window_seconds
        self.latency_threshold_ms = latency_threshold_ms
        self._active = False
        self._reason: KillSwitchReason | None = None
        self._detail: str | None = None
        self._triggered_at: datetime | None = None
        self._api_errors: list[datetime] = []

    def trigger(self, reason: KillSwitchReason, detail: str | None = None) -> KillSwitchStatus:
        self._active = True
        self._reason = reason
        self._detail = detail
        self._triggered_at = datetime.now(UTC)
        return self.status()

    def reset(self) -> KillSwitchStatus:
        self._active = False
        self._reason = None
        self._detail = None
        self._triggered_at = None
        self._api_errors.clear()
        return self.status()

    def ensure_not_active(self) -> None:
        if self._active:
            raise KillSwitchActiveError(self.status())

    def record_api_error(self, detail: str) -> KillSwitchStatus:
        now = datetime.now(UTC)
        cutoff = now - timedelta(seconds=self.api_error_window_seconds)
        self._api_errors = [timestamp for timestamp in self._api_errors if timestamp >= cutoff]
        self._api_errors.append(now)
        if len(self._api_errors) >= self.api_error_spike_threshold:
            return self.trigger("api_error_spike", detail)
        return self.status()

    def record_latency(self, latency_ms: float, detail: str) -> KillSwitchStatus:
        if latency_ms > self.latency_threshold_ms:
            return self.trigger("latency_excessive", f"{detail}; latency_ms={latency_ms:.2f}")
        return self.status()

    def status(self) -> KillSwitchStatus:
        return KillSwitchStatus(
            active=self._active,
            reason=self._reason,
            detail=self._detail,
            triggered_at=self._triggered_at,
            api_error_count=len(self._api_errors),
            latency_threshold_ms=self.latency_threshold_ms,
            api_error_spike_threshold=self.api_error_spike_threshold,
        )


class KillSwitchActiveError(RuntimeError):
    def __init__(self, status: KillSwitchStatus) -> None:
        self.status = status
        super().__init__(f"kill switch active: {status.reason}: {status.detail}")
