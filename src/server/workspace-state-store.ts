import { getPostgresPool } from './postgres-store';
import type { ThoonDb } from './thoon-db';

export async function readWorkspaceState(workspaceId: string, seedDb: ThoonDb) {
  const pool = getPostgresPool();
  const state = await pool.query<{ payload: ThoonDb }>('select payload from workspace_state where workspace_id = $1', [workspaceId]);

  if (state.rows[0]?.payload) {
    return state.rows[0].payload;
  }

  await writeWorkspaceState(workspaceId, seedDb);

  return seedDb;
}

export async function writeWorkspaceState(workspaceId: string, db: ThoonDb) {
  await getPostgresPool().query(
    `
      insert into workspace_state (workspace_id, payload, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (workspace_id)
      do update set payload = excluded.payload, updated_at = now()
    `,
    [workspaceId, JSON.stringify(db)],
  );
}
