from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from gateway.llm_gateway import LLMGatewayService
from observability.metrics import record_agent_action
from research.nodes import ResearchLabNodes
from research.schemas import ResearchLabOutput, ResearchLabRequest


class ResearchLabState(TypedDict, total=False):
    request: ResearchLabRequest
    ingestion: dict[str, Any]
    generation: dict[str, Any]
    backtests: dict[str, Any]
    selection: dict[str, Any]
    memory: dict[str, Any]
    final: ResearchLabOutput


class AutonomousResearchLab:
    def __init__(
        self,
        *,
        nodes: ResearchLabNodes | None = None,
        gateway: LLMGatewayService | None = None,
    ) -> None:
        self.nodes = nodes or ResearchLabNodes(gateway=gateway)
        self.graph = self._build_graph()

    async def run(self, request: ResearchLabRequest) -> ResearchLabOutput:
        state = await self.graph.ainvoke({"request": request})
        final = state.get("final")
        if final is None:
            raise RuntimeError("research graph did not produce final output")
        return ResearchLabOutput.model_validate(final)

    def _build_graph(self) -> Any:
        builder = StateGraph(ResearchLabState)
        builder.add_node("data_ingestion", self._data_ingestion_node)
        builder.add_node("strategy_generator", self._strategy_generator_node)
        builder.add_node("backtesting_engine", self._backtesting_engine_node)
        builder.add_node("selector", self._selector_node)
        builder.add_node("memory_store", self._memory_store_node)
        builder.add_node("final_output", self._final_output_node)

        builder.add_edge(START, "data_ingestion")
        builder.add_edge("data_ingestion", "strategy_generator")
        builder.add_edge("strategy_generator", "backtesting_engine")
        builder.add_edge("backtesting_engine", "selector")
        builder.add_edge("selector", "memory_store")
        builder.add_edge("memory_store", "final_output")
        builder.add_edge("final_output", END)
        return builder.compile()

    async def _data_ingestion_node(self, state: ResearchLabState) -> dict[str, Any]:
        ingestion = await self._run_node("data_ingestion", lambda: self.nodes.data_ingestion(state["request"]))
        return {"ingestion": ingestion}

    async def _strategy_generator_node(self, state: ResearchLabState) -> dict[str, Any]:
        generation = await self._run_node(
            "strategy_generator",
            lambda: self.nodes.strategy_generator(state["request"], state["ingestion"]),
        )
        return {"generation": generation}

    async def _backtesting_engine_node(self, state: ResearchLabState) -> dict[str, Any]:
        backtests = await self._run_node(
            "backtesting_engine",
            lambda: self.nodes.backtesting_engine(state["request"], state["ingestion"], state["generation"]),
        )
        return {"backtests": backtests}

    async def _selector_node(self, state: ResearchLabState) -> dict[str, Any]:
        selection = await self._run_node("selector", lambda: self.nodes.selector(state["request"], state["backtests"]))
        return {"selection": selection}

    async def _memory_store_node(self, state: ResearchLabState) -> dict[str, Any]:
        memory = await self._run_node(
            "memory_store",
            lambda: self.nodes.memory_store(state["selection"], state["generation"]["generator_insight"]),
        )
        return {"memory": memory}

    async def _final_output_node(self, state: ResearchLabState) -> dict[str, Any]:
        final = ResearchLabOutput(
            best_strategies=state["selection"]["best_strategies"],
            rejected_strategies=state["selection"]["rejected_strategies"],
            performance_evolution=state["memory"]["performance_evolution"],
            research_insights=state["generation"]["generator_insight"],
        )
        return {"final": final}

    async def _run_node(self, node: str, operation: Callable[[], Awaitable[Any]]) -> Any:
        start = time.perf_counter()
        try:
            result = await operation()
            record_agent_action("autonomous_research_lab", node, "ok", time.perf_counter() - start)
            return result
        except Exception:
            record_agent_action("autonomous_research_lab", node, "error", time.perf_counter() - start)
            raise
