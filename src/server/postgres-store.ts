import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Pool } from 'pg';

import { getThoonServerEnv } from './env';
import type { ThoonDb } from './thoon-db';

let pool: Pool | undefined;

export type PostgresReadiness = {
  configured: boolean;
  error?: string;
  lastSnapshotAt?: string;
  migrationCount: number;
  ok: boolean;
  provider: 'json' | 'postgres';
};

export async function mirrorThoonDbToPostgres(db: ThoonDb) {
  const env = getThoonServerEnv();

  if (env.databaseProvider !== 'postgres' || !env.databaseUrl) {
    return;
  }

  const client = await getPool().connect();

  try {
    await client.query(
      `
        INSERT INTO thoon_app_state (id, payload, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (id)
        DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
      `,
      ['default', JSON.stringify(db)],
    );
  } finally {
    client.release();
  }
}

export async function checkPostgresReadiness(): Promise<PostgresReadiness> {
  const env = getThoonServerEnv();

  if (env.databaseProvider !== 'postgres') {
    return {
      configured: false,
      migrationCount: 0,
      ok: true,
      provider: env.databaseProvider,
    };
  }

  if (!env.databaseUrl) {
    return {
      configured: false,
      error: 'DATABASE_URL is required when THOON_DATABASE_PROVIDER=postgres.',
      migrationCount: 0,
      ok: false,
      provider: env.databaseProvider,
    };
  }

  try {
    const client = await getPool().connect();

    try {
      const migrations = await client.query<{ count: string }>('select count(*)::text as count from thoon_migrations');
      const snapshot = await client.query<{ updated_at: Date }>('select updated_at from thoon_app_state where id = $1', ['default']);
      const migrationCount = Number(migrations.rows[0]?.count ?? 0);
      const lastSnapshotAt = snapshot.rows[0]?.updated_at?.toISOString();

      return {
        configured: true,
        error: migrationCount > 0 && lastSnapshotAt ? undefined : 'Postgres migrations and thoon_app_state/default snapshot are required.',
        lastSnapshotAt,
        migrationCount,
        ok: migrationCount > 0 && Boolean(lastSnapshotAt),
        provider: env.databaseProvider,
      };
    } finally {
      client.release();
    }
  } catch (error) {
    return {
      configured: true,
      error: error instanceof Error ? error.message : 'Unknown Postgres readiness error.',
      migrationCount: 0,
      ok: false,
      provider: env.databaseProvider,
    };
  }
}

export function listMigrationFiles(root = process.cwd()) {
  const migrationsDir = join(root, 'migrations');

  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');

      return {
        id: file,
        checksum: createHash('sha256').update(sql).digest('hex'),
        sql,
      };
    });
}

function getPool() {
  const env = getThoonServerEnv();

  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL is missing.');
  }

  pool ??= new Pool({
    connectionString: env.databaseUrl,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    max: 3,
    ssl: env.nodeEnv === 'production' && !env.databaseUrl.includes('sslmode=disable') ? { rejectUnauthorized: true } : undefined,
  });

  return pool;
}
