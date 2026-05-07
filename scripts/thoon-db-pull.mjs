import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';

import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const dataFile = process.env.THOON_DATA_FILE ?? '.thoon-data/thoon-db.json';

if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  const response = await pool.query('select payload from thoon_app_state where id = $1', ['default']);
  const payload = response.rows[0]?.payload;

  if (!payload) {
    console.error('No thoon_app_state/default snapshot found.');
    process.exit(1);
  }

  mkdirSync(dirname(dataFile), { recursive: true });
  writeFileSync(dataFile, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Pulled Postgres thoon_app_state/default to ${dataFile}.`);
} finally {
  await pool.end();
}
