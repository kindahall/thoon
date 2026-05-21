from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any

from experiment_tracker.schemas import ExperimentRecord


class PostgresExperimentStoreError(RuntimeError):
    pass


class PostgresExperimentStore:
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
                    CREATE SCHEMA IF NOT EXISTS experiment_tracker;

                    CREATE TABLE IF NOT EXISTS experiment_tracker.experiments (
                      experiment_id TEXT PRIMARY KEY,
                      status TEXT NOT NULL,
                      reproducible BOOLEAN NOT NULL,
                      strategy_version TEXT NOT NULL,
                      strategy_content_hash TEXT NOT NULL,
                      config_hash TEXT NOT NULL UNIQUE,
                      exchange TEXT NOT NULL,
                      symbol TEXT NOT NULL,
                      interval TEXT NOT NULL,
                      row_count INTEGER NOT NULL,
                      data_start TIMESTAMPTZ NOT NULL,
                      data_end TIMESTAMPTZ NOT NULL,
                      request JSONB NOT NULL,
                      dataset JSONB NOT NULL,
                      results JSONB NOT NULL,
                      decision JSONB NOT NULL,
                      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    );

                    CREATE INDEX IF NOT EXISTS experiments_status_idx
                      ON experiment_tracker.experiments (status);
                    CREATE INDEX IF NOT EXISTS experiments_market_idx
                      ON experiment_tracker.experiments (exchange, symbol, interval);
                    CREATE INDEX IF NOT EXISTS experiments_strategy_version_idx
                      ON experiment_tracker.experiments (strategy_version);
                    CREATE INDEX IF NOT EXISTS experiments_created_at_idx
                      ON experiment_tracker.experiments (created_at DESC);
                    """
                )
        self._schema_ready = True

    def upsert_experiment(self, record: ExperimentRecord) -> ExperimentRecord:
        self.ensure_schema()
        jsonb = self._jsonb()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO experiment_tracker.experiments (
                      experiment_id, status, reproducible, strategy_version,
                      strategy_content_hash, config_hash, exchange, symbol, interval,
                      row_count, data_start, data_end, request, dataset, results,
                      decision, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (config_hash) DO UPDATE SET
                      status = EXCLUDED.status,
                      reproducible = EXCLUDED.reproducible,
                      results = EXCLUDED.results,
                      decision = EXCLUDED.decision
                    RETURNING *
                    """,
                    (
                        record.experiment_id,
                        record.status,
                        record.reproducible,
                        record.strategy_version,
                        record.strategy_content_hash,
                        record.config_hash,
                        record.dataset.exchange,
                        record.dataset.symbol,
                        record.dataset.interval,
                        record.dataset.rows,
                        record.dataset.data_start,
                        record.dataset.data_end,
                        jsonb(record.request.model_dump(mode="json")),
                        jsonb(record.dataset.model_dump(mode="json")),
                        jsonb(record.results.model_dump(mode="json")),
                        jsonb(record.decision.model_dump(mode="json")),
                        record.created_at,
                    ),
                )
                row = cursor.fetchone()
        return self._record_from_row(row)

    def get_experiment(self, experiment_id: str) -> ExperimentRecord:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT * FROM experiment_tracker.experiments WHERE experiment_id = %s",
                    (experiment_id,),
                )
                row = cursor.fetchone()
        if row is None:
            raise PostgresExperimentStoreError(f"experiment_id not found: {experiment_id}")
        return self._record_from_row(row)

    def list_experiments(
        self,
        *,
        limit: int = 100,
        status: str | None = None,
        symbol: str | None = None,
    ) -> list[ExperimentRecord]:
        self.ensure_schema()
        clauses: list[str] = []
        params: list[Any] = []
        if status is not None:
            clauses.append("status = %s")
            params.append(status)
        if symbol is not None:
            clauses.append("symbol = %s")
            params.append(symbol)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"SELECT * FROM experiment_tracker.experiments {where} ORDER BY created_at DESC LIMIT %s",
                    params,
                )
                rows = cursor.fetchall()
        return [self._record_from_row(row) for row in rows]

    def _connect(self):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as error:
            raise PostgresExperimentStoreError("psycopg is required for PostgreSQL experiment tracking") from error
        try:
            return psycopg.connect(self.database_url, autocommit=True, row_factory=dict_row)
        except Exception as error:
            raise PostgresExperimentStoreError(f"PostgreSQL unavailable for experiment tracker: {error}") from error

    def _jsonb(self):
        from psycopg.types.json import Jsonb

        return Jsonb

    def _record_from_row(self, row: dict[str, Any]) -> ExperimentRecord:
        record = ExperimentRecord(
            experiment_id=row["experiment_id"],
            status=row["status"],
            reproducible=bool(row["reproducible"]),
            strategy_version=row["strategy_version"],
            strategy_content_hash=row["strategy_content_hash"],
            config_hash=row["config_hash"],
            request=row["request"],
            dataset=row["dataset"],
            results=row["results"],
            decision=row["decision"],
            persisted=True,
            created_at=self._utc(row["created_at"]),
        )
        return record

    def _utc(self, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
