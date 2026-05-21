from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


LLMProvider = Literal["codex_cli", "openclaw_responses"]


class TokenUsage(BaseModel):
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None


class CostEstimate(BaseModel):
    provider: LLMProvider
    estimated_input_tokens: int
    estimated_output_tokens: int | None = None
    estimated_cost_usd: float | None = None
    pricing_source: str


class GatewayTrace(BaseModel):
    request_id: str = Field(default_factory=lambda: str(uuid4()))
    provider: LLMProvider
    model: str
    operation: str
    prompt: str
    response: str | None = None
    latency_ms: float | None = None
    usage: TokenUsage | None = None
    cost: CostEstimate | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class LLMTextResponse(BaseModel):
    request_id: str
    provider: LLMProvider
    model: str
    text: str
    latency_ms: float
    usage: TokenUsage | None = None
    cost: CostEstimate


class StructuredLLMResponse(BaseModel):
    request_id: str
    provider: LLMProvider
    model: str
    data: dict[str, Any]
    latency_ms: float
    usage: TokenUsage | None = None
    cost: CostEstimate


class ToolDefinition(BaseModel):
    name: str = Field(..., pattern=r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")
    description: str
    parameters_schema: dict[str, Any]


class ToolCall(BaseModel):
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolCallPlan(BaseModel):
    tool_calls: list[ToolCall]


class ToolResult(BaseModel):
    name: str
    ok: bool
    result: Any | None = None
    error: str | None = None


class GatewayInvokeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str
    system_prompt: str | None = None
    model: str | None = None
    max_retries: int = Field(default=2, ge=0, le=5)
