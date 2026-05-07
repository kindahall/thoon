import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const migrations = readdirSync(join(process.cwd(), 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => {
    const sql = readFileSync(join(process.cwd(), 'migrations', file), 'utf8');

    return {
      id: file,
      checksum: createHash('sha256').update(sql).digest('hex'),
      sql,
    };
  });

const client = await pool.connect();

try {
  await client.query('begin');
  await client.query(`
    create table if not exists thoon_migrations (
      id text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);

  for (const migration of migrations) {
    const applied = await client.query('select checksum from thoon_migrations where id = $1', [migration.id]);

    if (applied.rows[0]?.checksum === migration.checksum) {
      console.log(`SKIP ${migration.id}`);
      continue;
    }

    if (applied.rows[0]) {
      throw new Error(`Migration checksum changed: ${migration.id}`);
    }

    await client.query(migration.sql);
    await client.query('insert into thoon_migrations (id, checksum) values ($1, $2)', [migration.id, migration.checksum]);
    console.log(`OK ${migration.id}`);
  }

  await client.query('commit');
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}
