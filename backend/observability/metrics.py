from __future__ import annotations

from typing import Any

from prometheus_client import Counter, Gauge, Histogram

API_REQUESTS_TOTAL = Counter(
    "bud_ai_api_requests_total",
    "Total API requests by method, path, and status code.",
    ["method", "path", "status_code"],
)
API_ERRORS_TOTAL = Counter(
    "bud_ai_api_errors_total",
    "Total API errors by method, path, and status code.",
    ["method", "path", "status_code"],
)
API_LATENCY_SECONDS = Histogram(
    "bud_ai_api_latency_seconds",
    "API request latency in seconds.",
    ["method", "path"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120),
)

LLM_REQUESTS_TOTAL = Counter(
    "bud_ai_llm_requests_total",
    "LLM gateway requests.",
    ["provider", "model", "operation", "status"],
)
LLM_LATENCY_SECONDS = Histogram(
    "bud_ai_llm_latency_seconds",
    "LLM gateway latency in seconds.",
    ["provider", "model", "operation"],
    buckets=(0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300),
)
LLM_ESTIMATED_COST_USD_TOTAL = Counter(
    "bud_ai_llm_estimated_cost_usd_total",
    "Estimated LLM cost in USD when pricing is available.",
    ["provider", "model", "operation"],
)
LLM_ESTIMATED_TOKENS_TOTAL = Counter(
    "bud_ai_llm_estimated_tokens_total",
    "Estimated LLM tokens.",
    ["provider", "model", "operation", "direction"],
)

TRADES_TOTAL = Counter(
    "bud_ai_trades_total",
    "Trades submitted through execution or paper systems.",
    ["exchange", "mode", "symbol", "side", "status"],
)
TRADE_NOTIONAL_TOTAL = Counter(
    "bud_ai_trade_notional_total",
    "Total trade notional.",
    ["exchange", "mode", "symbol"],
)
PNL_CURRENT = Gauge(
    "bud_ai_pnl_current",
    "Current PnL by exchange, mode, and symbol.",
    ["exchange", "mode", "symbol", "type"],
)
DRAWDOWN_FRACTION = Gauge(
    "bud_ai_drawdown_fraction",
    "Current drawdown fraction by exchange, mode, and symbol.",
    ["exchange", "mode", "symbol"],
)
WIN_RATE = Gauge(
    "bud_ai_win_rate",
    "Win rate by source and symbol.",
    ["source", "symbol"],
)
RISK_EXPOSURE = Gauge(
    "bud_ai_risk_exposure",
    "Risk exposure notional by exchange, mode, and symbol.",
    ["exchange", "mode", "symbol"],
)
RISK_REJECTIONS_TOTAL = Counter(
    "bud_ai_risk_rejections_total",
    "Risk engine rejections.",
    ["reason"],
)
KILL_SWITCH_ACTIVE = Gauge(
    "bud_ai_kill_switch_active",
    "Kill switch active status, 1 active and 0 inactive.",
    ["reason"],
)
KILL_SWITCH_TRIGGERS_TOTAL = Counter(
    "bud_ai_kill_switch_triggers_total",
    "Kill switch trigger count by reason.",
    ["reason"],
)
AGENT_ACTIONS_TOTAL = Counter(
    "bud_ai_agent_actions_total",
    "Agent node actions.",
    ["agent", "node", "status"],
)
AGENT_LATENCY_SECONDS = Histogram(
    "bud_ai_agent_latency_seconds",
    "Agent node latency in seconds.",
    ["agent", "node"],
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120),
)


def record_http_request(*, method: str, path: str, status_code: int, latency_seconds: float) -> None:
    status = str(status_code)
    API_REQUESTS_TOTAL.labels(method, path, status).inc()
    API_LATENCY_SECONDS.labels(method, path).observe(latency_seconds)
    if status_code >= 400:
        API_ERRORS_TOTAL.labels(method, path, status).inc()


def record_llm_trace(trace: Any) -> None:
    status = "error" if getattr(trace, "error", None) else "ok"
    latency_ms = getattr(trace, "latency_ms", None) or 0
    provider = str(getattr(trace, "provider", "unknown"))
    model = str(getattr(trace, "model", "unknown"))
    operation = str(getattr(trace, "operation", "unknown"))
    LLM_REQUESTS_TOTAL.labels(provider, model, operation, status).inc()
    if latency_ms > 0:
        LLM_LATENCY_SECONDS.labels(provider, model, operation).observe(latency_ms / 1000)
    cost = getattr(trace, "cost", None)
    if cost is not None:
        input_tokens = getattr(cost, "estimated_input_tokens", None)
        output_tokens = getattr(cost, "estimated_output_tokens", None)
        estimated_cost = getattr(cost, "estimated_cost_usd", None)
        if input_tokens is not None:
            LLM_ESTIMATED_TOKENS_TOTAL.labels(provider, model, operation, "input").inc(float(input_tokens))
        if output_tokens is not None:
            LLM_ESTIMATED_TOKENS_TOTAL.labels(provider, model, operation, "output").inc(float(output_tokens))
        if estimated_cost is not None:
            LLM_ESTIMATED_COST_USD_TOTAL.labels(provider, model, operation).inc(float(estimated_cost))


def record_trade(order: Any) -> None:
    exchange = str(getattr(order, "exchange", "unknown"))
    mode = str(getattr(order, "mode", "unknown"))
    symbol = str(getattr(order, "symbol", "unknown"))
    side = str(getattr(order, "side", "unknown"))
    status = str(getattr(order, "status", "unknown"))
    TRADES_TOTAL.labels(exchange, mode, symbol, side, status).inc()
    notional = getattr(order, "notional", None)
    if notional is not None:
        TRADE_NOTIONAL_TOTAL.labels(exchange, mode, symbol).inc(float(notional))


def record_position(position: Any) -> None:
    exchange = str(getattr(position, "exchange", "unknown"))
    mode = str(getattr(position, "mode", "unknown"))
    symbol = str(getattr(position, "symbol", "unknown"))
    notional = getattr(position, "notional", None)
    if notional is not None:
        RISK_EXPOSURE.labels(exchange, mode, symbol).set(float(notional))
    unrealized = getattr(position, "unrealized_pnl", None)
    realized = getattr(position, "realized_pnl", None)
    if unrealized is not None:
        PNL_CURRENT.labels(exchange, mode, symbol, "unrealized").set(float(unrealized))
    if realized is not None:
        PNL_CURRENT.labels(exchange, mode, symbol, "realized").set(float(realized))


def record_zero_position(exchange: str, mode: str, symbol: str) -> None:
    RISK_EXPOSURE.labels(exchange, mode, symbol).set(0.0)
    PNL_CURRENT.labels(exchange, mode, symbol, "unrealized").set(0.0)


def record_paper_state(state: Any) -> None:
    position = getattr(state, "position", None)
    if position is None:
        return
    symbol = str(getattr(position, "symbol", "unknown"))
    PNL_CURRENT.labels("binance", "paper", symbol, "realized").set(float(getattr(position, "realized_pnl", 0.0)))
    PNL_CURRENT.labels("binance", "paper", symbol, "unrealized").set(float(getattr(position, "unrealized_pnl", 0.0)))
    RISK_EXPOSURE.labels("binance", "paper", symbol).set(abs(float(getattr(position, "market_value", 0.0))))


def record_win_rate(source: str, symbol: str, value: float | None) -> None:
    if value is not None:
        WIN_RATE.labels(source, symbol).set(float(value))


def record_drawdown(exchange: str, mode: str, symbol: str, drawdown_fraction: float) -> None:
    DRAWDOWN_FRACTION.labels(exchange, mode, symbol).set(abs(float(drawdown_fraction)))


def record_kill_switch(status: Any, *, triggered: bool = False) -> None:
    reason = str(getattr(status, "reason", None) or "none")
    KILL_SWITCH_ACTIVE.labels(reason).set(1.0 if getattr(status, "active", False) else 0.0)
    if triggered:
        KILL_SWITCH_TRIGGERS_TOTAL.labels(reason).inc()


def record_risk_rejection(violations: list[str]) -> None:
    for violation in violations:
        RISK_REJECTIONS_TOTAL.labels(violation).inc()


def record_agent_action(agent: str, node: str, status: str, latency_seconds: float | None = None) -> None:
    AGENT_ACTIONS_TOTAL.labels(agent, node, status).inc()
    if latency_seconds is not None:
        AGENT_LATENCY_SECONDS.labels(agent, node).observe(latency_seconds)
