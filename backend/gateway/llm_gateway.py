from __future__ import annotations

import asyncio
import copy
import json
import os
import shutil
import tempfile
import time
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from gateway.retry import retry_on_invalid
from gateway.schemas import (
    CostEstimate,
    GatewayTrace,
    LLMProvider,
    LLMTextResponse,
    StructuredLLMResponse,
    TokenUsage,
    ToolCallPlan,
    ToolDefinition,
    ToolResult,
)
from gateway.tracer import GatewayTracer


OutputModel = TypeVar("OutputModel", bound=BaseModel)
ToolHandler = Callable[[dict[str, Any]], Any]


class LLMGatewayError(RuntimeError):
    pass


class LLMGatewayService:
    def __init__(self, *, tracer: GatewayTracer | None = None) -> None:
        self.provider: LLMProvider = os.getenv("LLM_GATEWAY_PROVIDER", "codex_cli")  # type: ignore[assignment]
        self.model = os.getenv("LLM_GATEWAY_MODEL", "gpt-5.2")
        self.workspace = Path(os.getenv("LLM_GATEWAY_WORKSPACE", str(Path.cwd()))).resolve()
        self.timeout_seconds = float(os.getenv("LLM_GATEWAY_TIMEOUT_SECONDS", "120"))
        self.tracer = tracer or GatewayTracer()
        self._tools: dict[str, ToolHandler] = {}

    def register_tool(self, name: str, handler: ToolHandler) -> None:
        if name in self._tools:
            raise LLMGatewayError(f"tool already registered: {name}")
        self._tools[name] = handler

    async def invoke(
        self,
        *,
        prompt: str,
        system_prompt: str | None = None,
        model: str | None = None,
    ) -> LLMTextResponse:
        request_id = self._new_request_id()
        selected_model = model or self.model
        full_prompt = self._build_prompt(prompt=prompt, system_prompt=system_prompt)
        start = time.perf_counter()
        trace = GatewayTrace(
            request_id=request_id,
            provider=self.provider,
            model=selected_model,
            operation="invoke",
            prompt=full_prompt,
        )

        try:
            text = await self._call_provider_text(full_prompt, selected_model)
            latency_ms = self._latency_ms(start)
            cost = self.estimate_cost(full_prompt, text)
            trace.response = text
            trace.latency_ms = latency_ms
            trace.cost = cost
            return LLMTextResponse(
                request_id=request_id,
                provider=self.provider,
                model=selected_model,
                text=text,
                latency_ms=latency_ms,
                usage=None,
                cost=cost,
            )
        except Exception as error:
            trace.error = str(error)
            trace.latency_ms = self._latency_ms(start)
            raise
        finally:
            self.trace_request(trace)

    async def invoke_structured(
        self,
        *,
        prompt: str,
        output_model: type[OutputModel],
        system_prompt: str | None = None,
        model: str | None = None,
        max_retries: int = 2,
    ) -> OutputModel:
        request_id = self._new_request_id()
        selected_model = model or self.model
        full_prompt = self._build_structured_prompt(prompt=prompt, output_model=output_model, system_prompt=system_prompt)
        start = time.perf_counter()
        trace = GatewayTrace(
            request_id=request_id,
            provider=self.provider,
            model=selected_model,
            operation="invoke_structured",
            prompt=full_prompt,
        )

        async def operation(attempt: int, previous_error: str | None) -> OutputModel:
            retry_prompt = full_prompt
            if previous_error:
                retry_prompt = (
                    f"{full_prompt}\n\nPrevious output failed validation: {previous_error}\n"
                    "Return only a valid JSON object matching the schema."
                )
            raw = await self._call_provider_structured(retry_prompt, selected_model, output_model)
            return self.validate_output(raw, output_model)

        try:
            parsed = await retry_on_invalid(operation, max_retries=max_retries)
            latency_ms = self._latency_ms(start)
            raw_response = json.dumps(parsed.model_dump(), ensure_ascii=False)
            cost = self.estimate_cost(full_prompt, raw_response)
            trace.response = raw_response
            trace.latency_ms = latency_ms
            trace.cost = cost
            return parsed
        except Exception as error:
            trace.error = str(error)
            trace.latency_ms = self._latency_ms(start)
            raise
        finally:
            self.trace_request(trace)

    async def invoke_tools(
        self,
        *,
        prompt: str,
        tools: list[ToolDefinition],
        system_prompt: str | None = None,
        model: str | None = None,
        max_retries: int = 2,
    ) -> list[ToolResult]:
        tool_names = {tool.name for tool in tools}
        missing_handlers = sorted(tool_names - set(self._tools))
        if missing_handlers:
            raise LLMGatewayError(f"missing backend tool handler(s): {', '.join(missing_handlers)}")

        tool_prompt = (
            f"{prompt}\n\nAvailable backend tools:\n"
            f"{json.dumps([tool.model_dump() for tool in tools], ensure_ascii=False)}\n"
            "Select tool calls only when needed."
        )
        plan = await self.invoke_structured(
            prompt=tool_prompt,
            output_model=ToolCallPlan,
            system_prompt=system_prompt,
            model=model,
            max_retries=max_retries,
        )

        results: list[ToolResult] = []
        for call in plan.tool_calls:
            if call.name not in tool_names:
                results.append(ToolResult(name=call.name, ok=False, error="tool not allowed"))
                continue
            try:
                result = self._tools[call.name](call.arguments)
                results.append(ToolResult(name=call.name, ok=True, result=result))
            except Exception as error:
                results.append(ToolResult(name=call.name, ok=False, error=str(error)))
        return results

    async def stream(
        self,
        *,
        prompt: str,
        system_prompt: str | None = None,
        model: str | None = None,
    ) -> AsyncIterator[str]:
        selected_model = model or self.model
        full_prompt = self._build_prompt(prompt=prompt, system_prompt=system_prompt)

        if self.provider == "codex_cli":
            async for event_line in self._stream_codex_json(full_prompt, selected_model):
                yield event_line
            return

        text = await self._call_openclaw_responses(full_prompt, selected_model, schema=None)
        yield text

    def validate_output(self, raw_output: str | dict[str, Any], output_model: type[OutputModel]) -> OutputModel:
        try:
            if isinstance(raw_output, str):
                payload = self._extract_json_object(raw_output)
            else:
                payload = raw_output
            return output_model.model_validate(payload)
        except (json.JSONDecodeError, ValidationError, TypeError) as error:
            raise ValueError(str(error)) from error

    def retry_on_invalid(self, *args: Any, **kwargs: Any) -> Any:
        return retry_on_invalid(*args, **kwargs)

    def trace_request(self, trace: GatewayTrace) -> None:
        self.tracer.trace_request(trace)

    def estimate_cost(self, prompt: str, response: str | None = None) -> CostEstimate:
        estimated_input_tokens = max(1, len(prompt) // 4)
        estimated_output_tokens = max(1, len(response) // 4) if response else None
        return CostEstimate(
            provider=self.provider,
            estimated_input_tokens=estimated_input_tokens,
            estimated_output_tokens=estimated_output_tokens,
            estimated_cost_usd=None,
            pricing_source="unavailable_for_codex_cli_or_openclaw_gateway",
        )

    async def _call_provider_text(self, prompt: str, model: str) -> str:
        if self.provider == "codex_cli":
            return await self._call_codex(prompt, model, output_schema=None)
        if self.provider == "openclaw_responses":
            return await self._call_openclaw_responses(prompt, model, schema=None)
        raise LLMGatewayError(f"unsupported LLM gateway provider: {self.provider}")

    async def _call_provider_structured(self, prompt: str, model: str, output_model: type[BaseModel]) -> str:
        schema = self._strict_json_schema(output_model)
        if self.provider == "codex_cli":
            return await self._call_codex(prompt, model, output_schema=schema)
        if self.provider == "openclaw_responses":
            return await self._call_openclaw_responses(prompt, model, schema=schema)
        raise LLMGatewayError(f"unsupported LLM gateway provider: {self.provider}")

    async def _call_codex(self, prompt: str, model: str, output_schema: dict[str, Any] | None) -> str:
        codex_path = os.getenv("CODEX_BIN") or shutil.which("codex") or "/Applications/Codex.app/Contents/Resources/codex"
        if not Path(codex_path).exists():
            raise LLMGatewayError("codex CLI not found")

        with tempfile.TemporaryDirectory(prefix="bud-ai-gateway-") as tmp_dir:
            tmp_path = Path(tmp_dir)
            output_path = tmp_path / "last-message.txt"
            args = [
                codex_path,
                "exec",
                "--skip-git-repo-check",
                "--ephemeral",
                "--sandbox",
                "read-only",
                "--cd",
                str(self.workspace),
                "--model",
                model,
                "--output-last-message",
                str(output_path),
            ]

            if output_schema is not None:
                schema_path = tmp_path / "schema.json"
                schema_path.write_text(json.dumps(output_schema, ensure_ascii=False), encoding="utf-8")
                args.extend(["--output-schema", str(schema_path)])

            args.append("-")
            process = await asyncio.create_subprocess_exec(
                *args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(prompt.encode("utf-8")),
                    timeout=self.timeout_seconds,
                )
            except asyncio.TimeoutError as error:
                process.kill()
                await process.communicate()
                raise LLMGatewayError("codex CLI request timed out") from error

            if process.returncode != 0:
                message = stderr.decode("utf-8", errors="replace") or stdout.decode("utf-8", errors="replace")
                raise LLMGatewayError(f"codex CLI request failed: {message.strip()}")

            if output_path.exists():
                return output_path.read_text(encoding="utf-8").strip()
            return stdout.decode("utf-8", errors="replace").strip()

    async def _stream_codex_json(self, prompt: str, model: str) -> AsyncIterator[str]:
        codex_path = os.getenv("CODEX_BIN") or shutil.which("codex") or "/Applications/Codex.app/Contents/Resources/codex"
        process = await asyncio.create_subprocess_exec(
            codex_path,
            "exec",
            "--skip-git-repo-check",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--cd",
            str(self.workspace),
            "--model",
            model,
            "--json",
            "-",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        if process.stdin is not None:
            process.stdin.write(prompt.encode("utf-8"))
            await process.stdin.drain()
            process.stdin.close()

        if process.stdout is not None:
            async for line in process.stdout:
                yield line.decode("utf-8", errors="replace").strip()

        await process.wait()
        if process.returncode != 0:
            stderr = await process.stderr.read() if process.stderr else b""
            raise LLMGatewayError(f"codex stream failed: {stderr.decode('utf-8', errors='replace').strip()}")

    async def _call_openclaw_responses(self, prompt: str, model: str, schema: dict[str, Any] | None) -> str:
        base_url = os.getenv("OPENCLAW_RESPONSES_URL", "http://127.0.0.1:18789/v1/responses")
        token = os.getenv("OPENCLAW_GATEWAY_TOKEN")
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        payload: dict[str, Any] = {
            "model": model if model.startswith("openclaw") else "openclaw/default",
            "input": prompt,
        }
        if schema is not None:
            payload["text"] = {
                "format": {
                    "type": "json_schema",
                    "name": schema.get("title", "structured_output"),
                    "schema": schema,
                    "strict": True,
                }
            }

        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(base_url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()

        output_text = data.get("output_text")
        if isinstance(output_text, str):
            return output_text

        output = data.get("output")
        if isinstance(output, list):
            for item in output:
                content = item.get("content") if isinstance(item, dict) else None
                if isinstance(content, list):
                    for content_item in content:
                        text = content_item.get("text") if isinstance(content_item, dict) else None
                        if isinstance(text, str):
                            return text

        raise LLMGatewayError("OpenClaw responses payload did not include text output")

    def _build_prompt(self, *, prompt: str, system_prompt: str | None) -> str:
        if not system_prompt:
            return prompt
        return f"System:\n{system_prompt}\n\nUser:\n{prompt}"

    def _build_structured_prompt(
        self,
        *,
        prompt: str,
        output_model: type[BaseModel],
        system_prompt: str | None,
    ) -> str:
        schema = self._strict_json_schema(output_model)
        base = self._build_prompt(prompt=prompt, system_prompt=system_prompt)
        return (
            f"{base}\n\n"
            "Return only a JSON object matching this JSON Schema. "
            "Do not include markdown fences or extra commentary.\n"
            f"{json.dumps(schema, ensure_ascii=False)}"
        )

    def _strict_json_schema(self, output_model: type[BaseModel]) -> dict[str, Any]:
        schema = copy.deepcopy(output_model.model_json_schema())
        defs = schema.pop("$defs", {})

        def resolve(node: Any) -> Any:
            if isinstance(node, dict):
                ref = node.get("$ref")
                if isinstance(ref, str) and ref.startswith("#/$defs/"):
                    name = ref.rsplit("/", 1)[-1]
                    if name not in defs:
                        raise LLMGatewayError(f"unresolved schema ref: {ref}")
                    resolved = resolve(copy.deepcopy(defs[name]))
                    extra = {key: value for key, value in node.items() if key != "$ref"}
                    if extra and isinstance(resolved, dict):
                        resolved.update(resolve(extra))
                    return resolved

                if node.get("type") == "object" or "properties" in node:
                    node["additionalProperties"] = False

                return {key: resolve(value) for key, value in node.items()}

            if isinstance(node, list):
                return [resolve(item) for item in node]

            return node

        resolved_schema = resolve(schema)
        if not isinstance(resolved_schema, dict):
            raise LLMGatewayError("schema generation failed")
        return resolved_schema

    def _extract_json_object(self, raw_output: str) -> dict[str, Any]:
        stripped = raw_output.strip()
        if stripped.startswith("```"):
            stripped = stripped.strip("`")
            stripped = stripped.removeprefix("json").strip()
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            start = stripped.find("{")
            end = stripped.rfind("}")
            if start == -1 or end == -1 or end <= start:
                raise
            parsed = json.loads(stripped[start : end + 1])
        if not isinstance(parsed, dict):
            raise TypeError("structured output must be a JSON object")
        return parsed

    def _new_request_id(self) -> str:
        from uuid import uuid4

        return str(uuid4())

    def _latency_ms(self, start: float) -> float:
        return round((time.perf_counter() - start) * 1000, 2)
