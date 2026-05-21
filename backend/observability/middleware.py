from __future__ import annotations

import logging
import time
from uuid import uuid4

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from observability.context import strategy_id_var, trace_id_var
from observability.metrics import record_http_request

logger = logging.getLogger("bud_ai.api")


class ObservabilityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        trace_id = request.headers.get("x-trace-id") or str(uuid4())
        strategy_id = request.headers.get("x-strategy-id")
        trace_token = trace_id_var.set(trace_id)
        strategy_token = strategy_id_var.set(strategy_id)
        start = time.perf_counter()
        status_code = 500
        path = request.scope.get("route").path if request.scope.get("route") else request.url.path

        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers["x-trace-id"] = trace_id
            return response
        except Exception:
            logger.exception(
                "api_request_exception",
                extra={"method": request.method, "path": path, "status_code": status_code},
            )
            raise
        finally:
            latency_seconds = time.perf_counter() - start
            record_http_request(
                method=request.method,
                path=path,
                status_code=status_code,
                latency_seconds=latency_seconds,
            )
            logger.info(
                "api_request",
                extra={
                    "method": request.method,
                    "path": path,
                    "status_code": status_code,
                    "latency_ms": round(latency_seconds * 1000, 2),
                },
            )
            trace_id_var.reset(trace_token)
            strategy_id_var.reset(strategy_token)
