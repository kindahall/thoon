from __future__ import annotations

from contextvars import ContextVar

trace_id_var: ContextVar[str | None] = ContextVar("trace_id", default=None)
strategy_id_var: ContextVar[str | None] = ContextVar("strategy_id", default=None)


def current_trace_id() -> str | None:
    return trace_id_var.get()


def current_strategy_id() -> str | None:
    return strategy_id_var.get()
