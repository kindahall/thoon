from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from gateway.schemas import GatewayTrace
from observability.metrics import record_llm_trace


logger = logging.getLogger("bud_ai.llm_gateway")


class GatewayTracer:
    def __init__(self, log_path: str | None = None) -> None:
        self.log_path = Path(log_path or os.getenv("LLM_GATEWAY_TRACE_PATH", ".agent-trader-runtime/llm-gateway.jsonl"))

    def trace_request(self, trace: GatewayTrace) -> None:
        record_llm_trace(trace)
        logger.info(
            "llm_gateway_trace",
            extra={
                "request_id": trace.request_id,
                "provider": trace.provider,
                "model": trace.model,
                "operation": trace.operation,
                "latency_ms": trace.latency_ms,
                "error": trace.error,
            },
        )
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(trace.model_dump(mode="json"), ensure_ascii=False) + "\n")
