import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const ownerEmail = (process.env.THOON_ADMIN_EMAIL ?? 'owner@thoon.local').toLowerCase();
const ownerPasswordHash = process.env.THOON_ADMIN_PASSWORD_HASH;
const dataFile = process.env.THOON_DATA_FILE ?? '.thoon-data/thoon-db.json';

if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

if (!ownerPasswordHash) {
  console.error('THOON_ADMIN_PASSWORD_HASH is required to bootstrap the SaaS owner workspace.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const ownerUserId = stableId('user', ownerEmail);
const workspaceId = stableId('workspace', `${ownerEmail}:owner`);
const subscriptionId = stableId('subscription', workspaceId);

const client = await pool.connect();

try {
  await client.query('begin');
  await client.query(`
    create table if not exists thoon_app_state_backups (
      id text primary key,
      source text not null,
      payload jsonb not null,
      created_at timestamptz not null default now()
    )
  `);

  const snapshot = await client.query('select payload from thoon_app_state where id = $1', ['default']).catch(() => ({ rows: [] }));
  const payload = snapshot.rows[0]?.payload ? JSON.stringify(snapshot.rows[0].payload) : readLocalPayload();

  await client.query('insert into thoon_app_state_backups (id, source, payload) values ($1, $2, $3::jsonb)', [`saas-bootstrap-${Date.now()}`, snapshot.rows[0]?.payload ? 'thoon_app_state/default' : dataFile, payload]);
  await client.query(
    `
      insert into users (id, email, password_hash, role, status)
      values ($1, $2, $3, 'owner', 'active')
      on conflict (email)
      do update set password_hash = excluded.password_hash, role = 'owner', status = 'active', updated_at = now()
    `,
    [ownerUserId, ownerEmail, ownerPasswordHash],
  );
  await client.query(
    `
      insert into workspaces (id, owner_user_id, name, plan_id, live_access_status)
      values ($1, $2, 'Thoon Owner Workspace', 'elite', 'approved')
      on conflict (id)
      do update set owner_user_id = excluded.owner_user_id, plan_id = 'elite', live_access_status = 'approved', updated_at = now()
    `,
    [workspaceId, ownerUserId],
  );
  await client.query(
    `
      insert into workspace_members (workspace_id, user_id, role)
      values ($1, $2, 'owner')
      on conflict (workspace_id, user_id)
      do update set role = 'owner'
    `,
    [workspaceId, ownerUserId],
  );
  await client.query(
    `
      insert into subscriptions (id, workspace_id, plan_id, billing_period, status)
      values ($1, $2, 'elite', 'yearly', 'active')
      on conflict (workspace_id)
      do update set plan_id = 'elite', billing_period = 'yearly', status = 'active', updated_at = now()
    `,
    [subscriptionId, workspaceId],
  );
  await client.query(
    `
      insert into workspace_state (workspace_id, payload)
      values ($1, $2::jsonb)
      on conflict (workspace_id) do nothing
    `,
    [workspaceId, payload],
  );
  await client.query('commit');
  console.log(`Bootstrapped SaaS owner workspace ${workspaceId} for ${ownerEmail}.`);
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}

function readLocalPayload() {
  if (!existsSync(dataFile)) {
    throw new Error(`No thoon_app_state/default snapshot and no local data file found at ${dataFile}.`);
  }

  return readFileSync(dataFile, 'utf8');
}

function stableId(prefix, value) {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 18)}`;
}
