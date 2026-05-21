from __future__ import annotations

import os
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

from research_platform.schemas import (
    PaperResultRecord,
    PerformanceMatrixEntry,
    QuantResearchRequest,
    RegimePerformance,
    ResearchRunRecord,
    StrategyEvaluationRecord,
    StrategyRegistryRecord,
)


class PostgresResearchStoreError(RuntimeError):
    pass


class PostgresResearchStore:
    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url or os.getenv(
            "DATABASE_URL",
            "postgresql://bud_ai:bud_ai_local_only_change_me@localhost:5432/bud_ai",
        )
        self._schema_ready = False

    def ensure_schema(self) -> None:
        if self._schema_ready:
            return
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    CREATE SCHEMA IF NOT EXISTS research_platform;

                    CREATE TABLE IF NOT EXISTS research_platform.strategies (
                      strategy_id TEXT NOT NULL,
                      version_id TEXT PRIMARY KEY,
                      content_hash TEXT UNIQUE NOT NULL,
                      version INTEGER NOT NULL,
                      name TEXT NOT NULL,
                      strategy_type TEXT NOT NULL,
                      params JSONB NOT NULL,
                      conditions JSONB NOT NULL,
                      regime_tags JSONB NOT NULL,
                      metadata JSONB NOT NULL,
                      parent_strategy_id TEXT,
                      status TEXT NOT NULL,
                      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    );

                    CREATE INDEX IF NOT EXISTS strategies_strategy_id_idx
                      ON research_platform.strategies (strategy_id);
                    CREATE INDEX IF NOT EXISTS strategies_status_idx
                      ON research_platform.strategies (status);
                    CREATE INDEX IF NOT EXISTS strategies_created_at_idx
                      ON research_platform.strategies (created_at DESC);

                    CREATE TABLE IF NOT EXISTS research_platform.evaluations (
                      evaluation_id TEXT PRIMARY KEY,
                      strategy_id TEXT NOT NULL,
                      version_id TEXT NOT NULL REFERENCES research_platform.strategies(version_id),
                      exchange TEXT NOT NULL,
                      symbol TEXT NOT NULL,
                      interval TEXT NOT NULL,
                      row_count INTEGER NOT NULL,
                      data_start TIMESTAMPTZ NOT NULL,
                      data_end TIMESTAMPTZ NOT NULL,
                      train_metrics JSONB NOT NULL,
                      validation_metrics JSONB NOT NULL,
                      test_metrics JSONB NOT NULL,
                      full_metrics JSONB NOT NULL,
                      regime_breakdown JSONB NOT NULL,
                      overfit_score DOUBLE PRECISION NOT NULL,
                      ranking_score DOUBLE PRECISION NOT NULL,
                      selection_status TEXT NOT NULL,
                      rejection_reasons JSONB NOT NULL,
                      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    );

                    CREATE INDEX IF NOT EXISTS evaluations_strategy_id_idx
                      ON research_platform.evaluations (strategy_id);
                    CREATE INDEX IF NOT EXISTS evaluations_version_id_idx
                      ON research_platform.evaluations (version_id);
                    CREATE INDEX IF NOT EXISTS evaluations_market_idx
                      ON research_platform.evaluations (exchange, symbol, interval);
                    CREATE INDEX IF NOT EXISTS evaluations_ranking_idx
                      ON research_platform.evaluations (ranking_score DESC);
                    CREATE INDEX IF NOT EXISTS evaluations_created_at_idx
                      ON research_platform.evaluations (created_at DESC);

                    CREATE TABLE IF NOT EXISTS research_platform.runs (
                      run_id TEXT PRIMARY KEY,
                      request JSONB NOT NULL,
                      best_strategy_ids JSONB NOT NULL,
                      rejected_strategy_ids JSONB NOT NULL,
                      performance_matrix JSONB NOT NULL,
                      regime_breakdown JSONB NOT NULL,
                      system_health_score DOUBLE PRECISION NOT NULL,
                      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    );

                    CREATE INDEX IF NOT EXISTS runs_created_at_idx
                      ON research_platform.runs (created_at DESC);

                    CREATE TABLE IF NOT EXISTS research_platform.paper_results (
                      paper_result_id TEXT PRIMARY KEY,
                      strategy_id TEXT NOT NULL,
                      symbol TEXT NOT NULL,
                      trade_count INTEGER NOT NULL,
                      realized_pnl DOUBLE PRECISION NOT NULL,
                      total_notional DOUBLE PRECISION NOT NULL,
                      win_rate DOUBLE PRECISION,
                      source TEXT NOT NULL,
                      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    );

                    CREATE INDEX IF NOT EXISTS paper_results_strategy_id_idx
                      ON research_platform.paper_results (strategy_id);
                    CREATE INDEX IF NOT EXISTS paper_results_created_at_idx
                      ON research_platform.paper_results (created_at DESC);

                    CREATE TABLE IF NOT EXISTS research_platform.errors (
                      id BIGSERIAL PRIMARY KEY,
                      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                      component TEXT NOT NULL,
                      strategy_id TEXT,
                      payload JSONB NOT NULL
                    );
                    """
                )
        self._schema_ready = True

    def next_strategy_version(self, strategy_id: str) -> int:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT COALESCE(MAX(version), 0) + 1 AS next_version "
                    "FROM research_platform.strategies WHERE strategy_id = %s",
                    (strategy_id,),
                )
                row = cursor.fetchone()
        return int(row["next_version"])

    def upsert_strategy(self, record: StrategyRegistryRecord) -> StrategyRegistryRecord:
        self.ensure_schema()
        jsonb = self._jsonb()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO research_platform.strategies (
                      strategy_id, version_id, content_hash, version, name, strategy_type,
                      params, conditions, regime_tags, metadata, parent_strategy_id, status, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (content_hash) DO NOTHING
                    """,
                    (
                        record.strategy_id,
                        record.version_id,
                        record.content_hash,
                        record.version,
                        record.name,
                        record.strategy_type,
                        jsonb(record.params),
                        jsonb(record.conditions),
                        jsonb(record.regime_tags),
                        jsonb(record.metadata),
                        record.parent_strategy_id,
                        record.status,
                        record.created_at,
                    ),
                )
                cursor.execute(
                    "SELECT * FROM research_platform.strategies WHERE content_hash = %s",
                    (record.content_hash,),
                )
                row = cursor.fetchone()
        return self._strategy_from_row(row)

    def list_strategies(self, *, limit: int = 100, status: str | None = None) -> list[StrategyRegistryRecord]:
        self.ensure_schema()
        params: list[Any] = []
        where = ""
        if status is not None:
            where = "WHERE status = %s"
            params.append(status)
        params.append(limit)
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"SELECT * FROM research_platform.strategies {where} ORDER BY created_at DESC LIMIT %s",
                    params,
                )
                rows = cursor.fetchall()
        return [self._strategy_from_row(row) for row in rows]

    def insert_evaluation(self, record: StrategyEvaluationRecord) -> StrategyEvaluationRecord:
        self.ensure_schema()
        jsonb = self._jsonb()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO research_platform.evaluations (
                      evaluation_id, strategy_id, version_id, exchange, symbol, interval, row_count,
                      data_start, data_end, train_metrics, validation_metrics, test_metrics,
                      full_metrics, regime_breakdown, overfit_score, ranking_score,
                      selection_status, rejection_reasons, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (evaluation_id) DO UPDATE SET
                      overfit_score = EXCLUDED.overfit_score,
                      ranking_score = EXCLUDED.ranking_score,
                      selection_status = EXCLUDED.selection_status,
                      rejection_reasons = EXCLUDED.rejection_reasons
                    """,
                    (
                        record.evaluation_id,
                        record.strategy_id,
                        record.version_id,
                        record.exchange,
                        record.symbol,
                        record.interval,
                        record.rows,
                        record.data_start,
                        record.data_end,
                        jsonb(record.train.model_dump(mode="json")),
                        jsonb(record.validation.model_dump(mode="json")),
                        jsonb(record.test.model_dump(mode="json")),
                        jsonb(record.full.model_dump(mode="json")),
                        jsonb({key: value.model_dump(mode="json") for key, value in record.regime_breakdown.items()}),
                        record.overfit_score,
                        record.ranking_score,
                        record.selection_status,
                        jsonb(record.rejection_reasons),
                        record.created_at,
                    ),
                )
        return record

    def list_evaluations(
        self,
        *,
        limit: int = 100,
        strategy_id: str | None = None,
        selection_status: str | None = None,
    ) -> list[StrategyEvaluationRecord]:
        self.ensure_schema()
        clauses: list[str] = []
        params: list[Any] = []
        if strategy_id:
            clauses.append("strategy_id = %s")
            params.append(strategy_id)
        if selection_status:
            clauses.append("selection_status = %s")
            params.append(selection_status)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"SELECT * FROM research_platform.evaluations {where} ORDER BY created_at DESC LIMIT %s",
                    params,
                )
                rows = cursor.fetchall()
        return [self._evaluation_from_row(row) for row in rows]

    def top_evaluations(self, *, limit: int = 20) -> list[StrategyEvaluationRecord]:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT * FROM research_platform.evaluations
                    WHERE selection_status = 'selected'
                    ORDER BY ranking_score DESC, created_at DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                rows = cursor.fetchall()
        return [self._evaluation_from_row(row) for row in rows]

    def insert_run(self, record: ResearchRunRecord) -> ResearchRunRecord:
        self.ensure_schema()
        jsonb = self._jsonb()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO research_platform.runs (
                      run_id, request, best_strategy_ids, rejected_strategy_ids,
                      performance_matrix, regime_breakdown, system_health_score, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (run_id) DO NOTHING
                    """,
                    (
                        record.run_id,
                        jsonb(record.request.model_dump(mode="json")),
                        jsonb(record.best_strategy_ids),
                        jsonb(record.rejected_strategy_ids),
                        jsonb({key: value.model_dump(mode="json") for key, value in record.performance_matrix.items()}),
                        jsonb(
                            {
                                key: [item.model_dump(mode="json") for item in values]
                                for key, values in record.regime_breakdown.items()
                            }
                        ),
                        record.system_health_score,
                        record.created_at,
                    ),
                )
        return record

    def list_runs(self, *, limit: int = 50) -> list[ResearchRunRecord]:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT * FROM research_platform.runs ORDER BY created_at DESC LIMIT %s",
                    (limit,),
                )
                rows = cursor.fetchall()
        return [self._run_from_row(row) for row in rows]

    def insert_paper_result(self, record: PaperResultRecord) -> PaperResultRecord:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO research_platform.paper_results (
                      paper_result_id, strategy_id, symbol, trade_count, realized_pnl,
                      total_notional, win_rate, source, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (paper_result_id) DO NOTHING
                    """,
                    (
                        record.paper_result_id,
                        record.strategy_id,
                        record.symbol,
                        record.trade_count,
                        record.realized_pnl,
                        record.total_notional,
                        record.win_rate,
                        record.source,
                        record.created_at,
                    ),
                )
        return record

    def record_error(self, *, component: str, payload: dict[str, Any], strategy_id: str | None = None) -> None:
        self.ensure_schema()
        jsonb = self._jsonb()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO research_platform.errors (component, strategy_id, payload)
                    VALUES (%s, %s, %s)
                    """,
                    (component, strategy_id, jsonb(payload)),
                )

    def _connect(self):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as error:
            raise PostgresResearchStoreError("psycopg is required for PostgreSQL research storage") from error
        try:
            return psycopg.connect(self.database_url, autocommit=True, row_factory=dict_row)
        except Exception as error:
            raise PostgresResearchStoreError(f"PostgreSQL unavailable for research platform: {error}") from error

    def _jsonb(self):
        from psycopg.types.json import Jsonb

        return Jsonb

    def _strategy_from_row(self, row: dict[str, Any]) -> StrategyRegistryRecord:
        return StrategyRegistryRecord(
            strategy_id=row["strategy_id"],
            version_id=row["version_id"],
            content_hash=row["content_hash"],
            version=int(row["version"]),
            name=row["name"],
            strategy_type=row["strategy_type"],
            params=row["params"],
            conditions=row["conditions"],
            regime_tags=row["regime_tags"],
            metadata=row["metadata"],
            parent_strategy_id=row["parent_strategy_id"],
            status=row["status"],
            created_at=self._utc(row["created_at"]),
        )

    def _evaluation_from_row(self, row: dict[str, Any]) -> StrategyEvaluationRecord:
        return StrategyEvaluationRecord(
            evaluation_id=row["evaluation_id"],
            strategy_id=row["strategy_id"],
            version_id=row["version_id"],
            exchange=row["exchange"],
            symbol=row["symbol"],
            interval=row["interval"],
            rows=int(row["row_count"]),
            data_start=self._utc(row["data_start"]),
            data_end=self._utc(row["data_end"]),
            train=row["train_metrics"],
            validation=row["validation_metrics"],
            test=row["test_metrics"],
            full=row["full_metrics"],
            regime_breakdown=row["regime_breakdown"],
            overfit_score=float(row["overfit_score"]),
            ranking_score=float(row["ranking_score"]),
            selection_status=row["selection_status"],
            rejection_reasons=row["rejection_reasons"],
            created_at=self._utc(row["created_at"]),
        )

    def _run_from_row(self, row: dict[str, Any]) -> ResearchRunRecord:
        return ResearchRunRecord(
            run_id=row["run_id"],
            request=QuantResearchRequest.model_validate(row["request"]),
            best_strategy_ids=row["best_strategy_ids"],
            rejected_strategy_ids=row["rejected_strategy_ids"],
            performance_matrix={
                key: PerformanceMatrixEntry.model_validate(value)
                for key, value in row["performance_matrix"].items()
            },
            regime_breakdown={
                key: [RegimePerformance.model_validate(item) for item in values]
                for key, values in row["regime_breakdown"].items()
            },
            system_health_score=float(row["system_health_score"]),
            created_at=self._utc(row["created_at"]),
        )

    def _utc(self, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


def strategy_ids(records: Iterable[StrategyEvaluationRecord]) -> list[str]:
    return [record.strategy_id for record in records]
