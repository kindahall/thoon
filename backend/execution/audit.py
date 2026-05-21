from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4


class ExecutionAuditError(RuntimeError):
    pass


class ExecutionAuditTrail:
    def __init__(self, path: str | None = None) -> None:
        self.path = Path(path or os.getenv("EXECUTION_AUDIT_LOG_PATH", "data/execution_audit.jsonl"))

    def record(
        self,
        *,
        event_type: str,
        status: str,
        payload: dict[str, Any],
        exchange: str | None = None,
        symbol: str | None = None,
        mode: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        event = {
            "audit_id": str(uuid4()),
            "event_type": event_type,
            "status": status,
            "exchange": exchange,
            "symbol": symbol,
            "mode": mode,
            "idempotency_key": idempotency_key,
            "payload": payload,
            "timestamp": datetime.now(UTC).isoformat(),
        }
        self._append(event)
        return event

    def health_check(self) -> dict[str, Any]:
        event = self.record(
            event_type="audit_health_check",
            status="ok",
            payload={"path": str(self.path)},
        )
        return {
            "available": True,
            "path": str(self.path),
            "last_audit_id": event["audit_id"],
        }

    def _append(self, event: dict[str, Any]) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(event, sort_keys=True, separators=(",", ":"), default=self._json_default))
                handle.write("\n")
        except OSError as error:
            raise ExecutionAuditError(f"execution audit trail unavailable: {error}") from error

    def _json_default(self, value: Any) -> str:
        if isinstance(value, datetime):
            return value.astimezone(UTC).isoformat()
        if hasattr(value, "model_dump"):
            return value.model_dump(mode="json")
        return str(value)


audit_trail = ExecutionAuditTrail()
