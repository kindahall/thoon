import { readFileSync } from 'node:fs';
import process from 'node:process';

import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const dataFile = process.env.THOON_DATA_FILE ?? '.thoon-data/thoon-db.json';

if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const payload = readFileSync(dataFile, 'utf8');
const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  await pool.query(
    `
      insert into thoon_app_state (id, payload, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (id)
      do update set payload = excluded.payload, updated_at = now()
    `,
    ['default', payload],
  );
  console.log(`Pushed ${dataFile} to Postgres thoon_app_state/default.`);
} finally {
  await pool.end();
}
