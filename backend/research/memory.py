from __future__ import annotations

import json
import os
from pathlib import Path

from research.schemas import PerformanceEvolutionPoint, ResearchRunRecord, ResearchStrategyResult


class ResearchMemoryStore:
    def __init__(self, store_path: str | None = None) -> None:
        default_path = Path(".agent-trader-runtime") / "research-lab.json"
        self.store_path = Path(store_path or os.getenv("RESEARCH_LAB_STORE_PATH", str(default_path))).resolve()
        self.store_path.parent.mkdir(parents=True, exist_ok=True)

    def append_run(self, record: ResearchRunRecord) -> ResearchRunRecord:
        state = self._read_state()
        state["runs"].append(record.run.model_dump(mode="json"))
        state["strategies"].extend([strategy.model_dump(mode="json") for strategy in record.strategies])
        state["insights"].append(record.research_insights)
        self._write_state(state)
        return record

    def list_runs(self, limit: int = 50) -> list[PerformanceEvolutionPoint]:
        state = self._read_state()
        records = [PerformanceEvolutionPoint.model_validate(item) for item in state["runs"]]
        return records[-max(1, limit) :]

    def list_strategies(self, status: str | None = None, limit: int = 100) -> list[ResearchStrategyResult]:
        state = self._read_state()
        records = [ResearchStrategyResult.model_validate(item) for item in state["strategies"]]
        if status:
            records = [record for record in records if record.status == status]
        return records[-max(1, limit) :]

    def best_strategies(self, limit: int = 5) -> list[ResearchStrategyResult]:
        selected = self.list_strategies(status="selected", limit=500)
        selected.sort(key=lambda item: item.selection_score, reverse=True)
        return selected[:limit]

    def recent_insights(self, limit: int = 5) -> list[str]:
        state = self._read_state()
        return [str(item) for item in state["insights"][-max(1, limit) :]]

    def _read_state(self) -> dict:
        if not self.store_path.exists():
            return {"runs": [], "strategies": [], "insights": []}
        with self.store_path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        return {
            "runs": payload.get("runs", []),
            "strategies": payload.get("strategies", []),
            "insights": payload.get("insights", []),
        }

    def _write_state(self, state: dict) -> None:
        temporary_path = self.store_path.with_suffix(".tmp")
        with temporary_path.open("w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False, indent=2)
        temporary_path.replace(self.store_path)
