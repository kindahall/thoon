from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any

from feature_store.schemas import FeatureSetRecord, FeatureStoreRequest


class PostgresFeatureStoreError(RuntimeError):
    pass


class PostgresFeatureStore:
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
                    CREATE SCHEMA IF NOT EXISTS feature_store;

                    CREATE TABLE IF NOT EXISTS feature_store.feature_sets (
                      feature_set_id TEXT PRIMARY KEY,
                      feature_set_key TEXT NOT NULL,
                      version INTEGER NOT NULL,
                      feature_schema_version TEXT NOT NULL,
                      exchange TEXT NOT NULL,
                      symbols JSONB NOT NULL,
                      interval TEXT NOT NULL,
                      lookback INTEGER NOT NULL,
                      rows_by_symbol JSONB NOT NULL,
                      data_start TIMESTAMPTZ NOT NULL,
                      data_end TIMESTAMPTZ NOT NULL,
                      data_sources JSONB NOT NULL,
                      request JSONB NOT NULL,
                      features JSONB NOT NULL,
                      content_hash TEXT NOT NULL,
                      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                      UNIQUE (feature_set_key, version)
                    );

                    CREATE INDEX IF NOT EXISTS feature_sets_key_created_idx
                      ON feature_store.feature_sets (feature_set_key, created_at DESC);
                    CREATE INDEX IF NOT EXISTS feature_sets_market_idx
                      ON feature_store.feature_sets (exchange, interval, created_at DESC);
                    CREATE INDEX IF NOT EXISTS feature_sets_content_hash_idx
                      ON feature_store.feature_sets (content_hash);
                    """
                )
        self._schema_ready = True

    def next_version(self, feature_set_key: str) -> int:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT COALESCE(MAX(version), 0) + 1 AS next_version "
                    "FROM feature_store.feature_sets WHERE feature_set_key = %s",
                    (feature_set_key,),
                )
                row = cursor.fetchone()
        return int(row["next_version"])

    def insert_feature_set(self, record: FeatureSetRecord, request: FeatureStoreRequest) -> FeatureSetRecord:
        self.ensure_schema()
        jsonb = self._jsonb()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO feature_store.feature_sets (
                      feature_set_id, feature_set_key, version, feature_schema_version,
                      exchange, symbols, interval, lookback, rows_by_symbol, data_start,
                      data_end, data_sources, request, features, content_hash, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        record.feature_set_id,
                        record.feature_set_key,
                        record.version,
                        record.feature_schema_version,
                        record.exchange,
                        jsonb(record.symbols),
                        record.interval,
                        record.lookback,
                        jsonb(record.rows_by_symbol),
                        record.data_start,
                        record.data_end,
                        jsonb(record.data_sources),
                        jsonb(request.model_dump(mode="json")),
                        jsonb(record.features),
                        record.content_hash,
                        record.created_at,
                    ),
                )
        return record

    def get_feature_set(self, feature_set_id: str) -> FeatureSetRecord:
        self.ensure_schema()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT * FROM feature_store.feature_sets WHERE feature_set_id = %s",
                    (feature_set_id,),
                )
                row = cursor.fetchone()
        if row is None:
            raise PostgresFeatureStoreError(f"feature_set_id not found: {feature_set_id}")
        return self._record_from_row(row)

    def latest(
        self,
        *,
        feature_set_key: str | None = None,
        exchange: str | None = None,
        interval: str | None = None,
    ) -> FeatureSetRecord:
        self.ensure_schema()
        clauses: list[str] = []
        params: list[Any] = []
        if feature_set_key:
            clauses.append("feature_set_key = %s")
            params.append(feature_set_key)
        if exchange:
            clauses.append("exchange = %s")
            params.append(exchange)
        if interval:
            clauses.append("interval = %s")
            params.append(interval)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"SELECT * FROM feature_store.feature_sets {where} ORDER BY created_at DESC LIMIT 1",
                    params,
                )
                row = cursor.fetchone()
        if row is None:
            raise PostgresFeatureStoreError("no feature set found for query")
        return self._record_from_row(row)

    def list_feature_sets(self, *, limit: int = 50, exchange: str | None = None) -> list[FeatureSetRecord]:
        self.ensure_schema()
        params: list[Any] = []
        where = ""
        if exchange:
            where = "WHERE exchange = %s"
            params.append(exchange)
        params.append(limit)
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"SELECT * FROM feature_store.feature_sets {where} ORDER BY created_at DESC LIMIT %s",
                    params,
                )
                rows = cursor.fetchall()
        return [self._record_from_row(row) for row in rows]

    def _connect(self):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as error:
            raise PostgresFeatureStoreError("psycopg is required for PostgreSQL feature storage") from error
        try:
            return psycopg.connect(self.database_url, autocommit=True, row_factory=dict_row)
        except Exception as error:
            raise PostgresFeatureStoreError(f"PostgreSQL unavailable for feature store: {error}") from error

    def _jsonb(self):
        from psycopg.types.json import Jsonb

        return Jsonb

    def _record_from_row(self, row: dict[str, Any]) -> FeatureSetRecord:
        return FeatureSetRecord(
            feature_set_id=row["feature_set_id"],
            feature_set_key=row["feature_set_key"],
            version=int(row["version"]),
            feature_schema_version=row["feature_schema_version"],
            exchange=row["exchange"],
            symbols=row["symbols"],
            interval=row["interval"],
            lookback=int(row["lookback"]),
            rows_by_symbol={key: int(value) for key, value in row["rows_by_symbol"].items()},
            data_start=self._utc(row["data_start"]),
            data_end=self._utc(row["data_end"]),
            data_sources=row["data_sources"],
            features=row["features"],
            content_hash=row["content_hash"],
            persisted=True,
            created_at=self._utc(row["created_at"]),
        )

    def _utc(self, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
