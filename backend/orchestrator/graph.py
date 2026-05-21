from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from gateway.llm_gateway import LLMGatewayService
from observability.metrics import record_agent_action
from orchestrator.nodes import StrategyOrchestrationNodes
from orchestrator.schemas import (
    DataIngestionOutput,
    MarketAnalysisOutput,
    OrchestrationRequest,
    RiskProfile,
    StrategyCandidate,
    StrategyCritique,
    StrategyOrchestrationResult,
)


class LangGraphStrategyState(TypedDict, total=False):
    request: OrchestrationRequest
    ingestion: DataIngestionOutput
    market_analysis: MarketAnalysisOutput
    macro_analysis: Any
    strategy_candidate: StrategyCandidate
    critique: StrategyCritique
    risk_profile: RiskProfile
    final_decision: StrategyOrchestrationResult


class StrategyOrchestrator:
    def __init__(
        self,
        *,
        nodes: StrategyOrchestrationNodes | None = None,
        gateway: LLMGatewayService | None = None,
    ) -> None:
        self.nodes = nodes or StrategyOrchestrationNodes(gateway=gateway)
        self.graph = self._build_graph()

    async def run(self, request: OrchestrationRequest) -> StrategyOrchestrationResult:
        state = await self.graph.ainvoke({"request": request})
        final_decision = state.get("final_decision")
        if final_decision is None:
            raise RuntimeError("orchestration graph did not produce final_decision")
        return StrategyOrchestrationResult.model_validate(final_decision)

    def _build_graph(self) -> Any:
        builder = StateGraph(LangGraphStrategyState)
        builder.add_node("data_ingestion", self._data_ingestion_node)
        builder.add_node("market_analysis", self._market_analysis_node)
        builder.add_node("macro_agent", self._macro_agent_node)
        builder.add_node("strategy_agent", self._strategy_agent_node)
        builder.add_node("critic_agent", self._critic_agent_node)
        builder.add_node("risk_agent", self._risk_agent_node)
        builder.add_node("final_decision", self._final_decision_node)

        builder.add_edge(START, "data_ingestion")
        builder.add_edge("data_ingestion", "market_analysis")
        builder.add_edge("market_analysis", "macro_agent")
        builder.add_edge("macro_agent", "strategy_agent")
        builder.add_edge("strategy_agent", "critic_agent")
        builder.add_edge("critic_agent", "risk_agent")
        builder.add_edge("risk_agent", "final_decision")
        builder.add_edge("final_decision", END)
        return builder.compile()

    async def _data_ingestion_node(self, state: LangGraphStrategyState) -> dict[str, Any]:
        request = state["request"]
        ingestion = await self._run_node("data_ingestion", lambda: self.nodes.data_ingestion(request))
        return {"ingestion": ingestion}

    async def _market_analysis_node(self, state: LangGraphStrategyState) -> dict[str, Any]:
        market_analysis = await self._run_node("market_analysis", lambda: self.nodes.market_analysis(state["ingestion"]))
        return {"market_analysis": market_analysis}

    async def _macro_agent_node(self, state: LangGraphStrategyState) -> dict[str, Any]:
        macro_analysis = await self._run_node(
            "macro_agent",
            lambda: self.nodes.macro_agent_node(state["request"], state["ingestion"], state["market_analysis"]),
        )
        return {"macro_analysis": macro_analysis}

    async def _strategy_agent_node(self, state: LangGraphStrategyState) -> dict[str, Any]:
        strategy = await self._run_node(
            "strategy_agent",
            lambda: self.nodes.strategy_agent_node(
                state["request"],
                state["ingestion"],
                state["market_analysis"],
                state["macro_analysis"],
            ),
        )
        return {"strategy_candidate": strategy}

    async def _critic_agent_node(self, state: LangGraphStrategyState) -> dict[str, Any]:
        critique = await self._run_node(
            "critic_agent",
            lambda: self.nodes.critic_agent_node(
                state["request"],
                state["market_analysis"],
                state["macro_analysis"],
                state["strategy_candidate"],
            ),
        )
        return {"critique": critique}

    async def _risk_agent_node(self, state: LangGraphStrategyState) -> dict[str, Any]:
        risk_profile = await self._run_node(
            "risk_agent",
            lambda: self.nodes.risk_agent_node(
                state["ingestion"],
                state["market_analysis"],
                state["strategy_candidate"],
            ),
        )
        return {"risk_profile": risk_profile}

    async def _final_decision_node(self, state: LangGraphStrategyState) -> dict[str, Any]:
        final_decision = await self._run_node(
            "final_decision",
            lambda: self.nodes.final_decision_node(
                state["macro_analysis"],
                state["strategy_candidate"],
                state["critique"],
                state["risk_profile"],
            ),
        )
        return {"final_decision": final_decision}

    async def _run_node(self, node: str, operation: Callable[[], Awaitable[Any]]) -> Any:
        start = time.perf_counter()
        try:
            result = await operation()
            record_agent_action("strategy_orchestrator", node, "ok", time.perf_counter() - start)
            return result
        except Exception:
            record_agent_action("strategy_orchestrator", node, "error", time.perf_counter() - start)
            raise
