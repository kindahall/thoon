import { createHash, randomBytes } from 'node:crypto';

import type { NextRequest } from 'next/server';

import type { BillingPlanId } from '../types/trading';
import type { AuthSession, SessionRole } from './auth';
import { createLoginSession } from './auth';
import { getThoonServerEnv } from './env';
import { createPasswordHash, verifyPassword } from './password';
import { getPostgresPool } from './postgres-store';
import type { ThoonDb } from './thoon-db';
import type { ThoonRequestContext } from './thoon-request-context';
import { readWorkspaceState } from './workspace-state-store';

export type PlanLimits = {
  agentCredits: number;
  botSlots: number;
  exchangeConnections: number;
  liveTrading: boolean;
};

export const planLimits: Record<BillingPlanId, PlanLimits> = {
  elite: { agentCredits: 10000, botSlots: 50, exchangeConnections: 12, liveTrading: true },
  free: { agentCredits: 10, botSlots: 1, exchangeConnections: 1, liveTrading: false },
  pro: { agentCredits: 1000, botSlots: 10, exchangeConnections: 3, liveTrading: false },
};

type SaasSessionRecord = {
  billing_period?: 'monthly' | 'yearly';
  email: string;
  live_access_status: 'approved' | 'not_requested' | 'pending' | 'rejected';
  membership_role: SessionRole;
  owner_user_id: string;
  plan_id: BillingPlanId;
  session_id: string;
  status: 'active' | 'disabled';
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  subscription_plan_id?: BillingPlanId;
  subscription_status?: string;
  user_id: string;
  user_role: SessionRole;
  workspace_id: string;
  workspace_name: string;
};

export function isSaasMode() {
  const env = getThoonServerEnv();
  return env.saasMode && env.databaseProvider === 'postgres';
}

export function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export async function ensureOwnerWorkspace(seedDb: ThoonDb) {
  const env = getThoonServerEnv();

  if (!isSaasMode()) {
    return undefined;
  }

  if (!env.thoonAdminPasswordHash) {
    throw new Error('THOON_ADMIN_PASSWORD_HASH is required before THOON_SAAS_MODE=enabled can bootstrap the owner workspace.');
  }

  const pool = getPostgresPool();
  const ownerEmail = env.thoonAdminEmail.toLowerCase();
  const ownerUserId = stableId('user', ownerEmail);
  const workspaceId = stableId('workspace', `${ownerEmail}:owner`);
  const subscriptionId = stableId('subscription', workspaceId);
  const existingSnapshot = await pool.query<{ payload: ThoonDb }>('select payload from thoon_app_state where id = $1', ['default']).catch(() => ({ rows: [] }));
  const payload = existingSnapshot.rows[0]?.payload ?? seedDb;

  await pool.query(
    `
      insert into users (id, email, password_hash, role, status)
      values ($1, $2, $3, 'owner', 'active')
      on conflict (email)
      do update set password_hash = excluded.password_hash, role = 'owner', status = 'active', updated_at = now()
    `,
    [ownerUserId, ownerEmail, env.thoonAdminPasswordHash],
  );
  await pool.query(
    `
      insert into workspaces (id, owner_user_id, name, plan_id, live_access_status)
      values ($1, $2, 'Thoon Owner Workspace', 'elite', 'approved')
      on conflict (id)
      do update set owner_user_id = excluded.owner_user_id, plan_id = 'elite', live_access_status = 'approved', updated_at = now()
    `,
    [workspaceId, ownerUserId],
  );
  await pool.query(
    `
      insert into workspace_members (workspace_id, user_id, role)
      values ($1, $2, 'owner')
      on conflict (workspace_id, user_id)
      do update set role = 'owner'
    `,
    [workspaceId, ownerUserId],
  );
  await pool.query(
    `
      insert into subscriptions (id, workspace_id, plan_id, billing_period, status)
      values ($1, $2, 'elite', 'yearly', 'active')
      on conflict (id)
      do update set plan_id = 'elite', billing_period = 'yearly', status = 'active', updated_at = now()
    `,
    [subscriptionId, workspaceId],
  );
  await pool.query(
    `
      insert into workspace_state (workspace_id, payload)
      values ($1, $2::jsonb)
      on conflict (workspace_id) do nothing
    `,
    [workspaceId, JSON.stringify(payload)],
  );

  return workspaceId;
}

export async function createBetaInvite(email: string) {
  const env = getThoonServerEnv();
  const token = randomBytes(24).toString('base64url');
  const id = `invite-${randomBytes(12).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + env.betaInviteDays * 24 * 60 * 60 * 1000);

  await getPostgresPool().query(
    `
      insert into beta_invites (id, email, token_hash, expires_at)
      values ($1, $2, $3, $4)
    `,
    [id, email.toLowerCase(), hashToken(token), expiresAt],
  );

  return { email: email.toLowerCase(), expiresAt: expiresAt.toISOString(), token };
}

export async function signupWithInvite({
  email,
  inviteToken,
  ipAddress,
  password,
  seedDb,
  userAgent,
}: {
  email: string;
  inviteToken: string;
  ipAddress: string;
  password: string;
  seedDb: ThoonDb;
  userAgent: string;
}) {
  const normalizedEmail = email.toLowerCase();
  const tokenHash = hashToken(inviteToken);
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('begin');
    const invite = await client.query<{ id: string }>(
      `
        select id
        from beta_invites
        where lower(email) = lower($1)
          and token_hash = $2
          and status = 'pending'
          and expires_at > now()
        for update
      `,
      [normalizedEmail, tokenHash],
    );

    if (!invite.rows[0]) {
      throw new Error('Invalid or expired beta invite.');
    }

    const userId = `user-${randomBytes(12).toString('base64url')}`;
    const workspaceId = `workspace-${randomBytes(12).toString('base64url')}`;
    const session = createLoginSession(normalizedEmail, { role: 'owner', userId, workspaceId });
    await client.query('insert into users (id, email, password_hash, role, status) values ($1, $2, $3, $4, $5)', [userId, normalizedEmail, createPasswordHash(password), 'member', 'active']);
    await client.query('insert into workspaces (id, owner_user_id, name, plan_id, live_access_status) values ($1, $2, $3, $4, $5)', [workspaceId, userId, `${normalizedEmail.split('@')[0]} workspace`, 'free', 'not_requested']);
    await client.query('insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)', [workspaceId, userId, 'owner']);
    await client.query('insert into workspace_state (workspace_id, payload) values ($1, $2::jsonb)', [workspaceId, JSON.stringify(seedDb)]);
    await client.query('insert into subscriptions (id, workspace_id, plan_id, billing_period, status) values ($1, $2, $3, $4, $5)', [`sub-local-${workspaceId}`, workspaceId, 'free', undefined, 'active']);
    await client.query('insert into sessions (id, user_id, workspace_id, expires_at, ip_address, user_agent) values ($1, $2, $3, $4, $5, $6)', [session.payload.sessionId, userId, workspaceId, session.payload.expiresAt, ipAddress, userAgent]);
    await client.query('update beta_invites set status = $1, accepted_at = now(), accepted_user_id = $2 where id = $3', ['accepted', userId, invite.rows[0].id]);
    await client.query('commit');

    return session;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function loginSaas({ email, ipAddress, password, userAgent }: { email: string; ipAddress: string; password: string; userAgent: string }) {
  const normalizedEmail = email.toLowerCase();
  const pool = getPostgresPool();
  const user = await pool.query<{ email: string; id: string; password_hash: string; role: SessionRole; status: 'active' | 'disabled' }>('select id, email, password_hash, role, status from users where lower(email) = lower($1)', [normalizedEmail]);
  const row = user.rows[0];

  if (!row || row.status !== 'active' || !verifyPassword(password, row.password_hash)) {
    return undefined;
  }

  const workspace = await pool.query<{ id: string; role: SessionRole }>(
    `
      select wm.workspace_id as id, wm.role
      from workspace_members wm
      join workspaces w on w.id = wm.workspace_id
      where wm.user_id = $1
      order by case wm.role when 'owner' then 0 when 'admin' then 1 else 2 end, w.created_at asc
      limit 1
    `,
    [row.id],
  );
  const workspaceRow = workspace.rows[0];

  if (!workspaceRow) {
    throw new Error('No workspace is attached to this user.');
  }

  const session = createLoginSession(row.email, { role: workspaceRow.role, userId: row.id, workspaceId: workspaceRow.id });
  await pool.query('insert into sessions (id, user_id, workspace_id, expires_at, ip_address, user_agent) values ($1, $2, $3, $4, $5, $6)', [session.payload.sessionId, row.id, workspaceRow.id, session.payload.expiresAt, ipAddress, userAgent]);

  return session;
}

export async function logoutSaas(sessionId?: string) {
  if (!sessionId) {
    return;
  }

  await getPostgresPool().query('update sessions set revoked_at = now() where id = $1 and revoked_at is null', [sessionId]);
}

export async function resolveSaasRequestContext(session: AuthSession | undefined, seedDb: ThoonDb): Promise<ThoonRequestContext | undefined> {
  if (!isSaasMode()) {
    return undefined;
  }

  await ensureOwnerWorkspace(seedDb);

  if (!session?.sessionId) {
    return undefined;
  }

  const pool = getPostgresPool();
  const record = await pool.query<SaasSessionRecord>(
    `
      select
        s.id as session_id,
        u.id as user_id,
        u.email,
        u.role as user_role,
        u.status,
        w.id as workspace_id,
        w.owner_user_id,
        w.name as workspace_name,
        w.plan_id,
        w.live_access_status,
        wm.role as membership_role,
        sub.plan_id as subscription_plan_id,
        sub.billing_period,
        sub.status as subscription_status,
        sub.stripe_customer_id,
        sub.stripe_subscription_id
      from sessions s
      join users u on u.id = s.user_id
      join workspaces w on w.id = coalesce(s.workspace_id, $2)
      join workspace_members wm on wm.workspace_id = w.id and wm.user_id = u.id
      left join subscriptions sub on sub.workspace_id = w.id
      where s.id = $1
        and s.revoked_at is null
        and s.expires_at > now()
        and u.status = 'active'
      limit 1
    `,
    [session.sessionId, session.workspaceId ?? ''],
  );
  const row = record.rows[0];

  if (!row) {
    return undefined;
  }

  await pool.query('update sessions set last_seen_at = now() where id = $1', [row.session_id]);
  const db = await readWorkspaceState(row.workspace_id, seedDb);
  const subscriptionPlan = row.subscription_plan_id ?? row.plan_id;

  return {
    db,
    membership: { role: row.membership_role },
    mode: 'saas',
    sessionId: row.session_id,
    subscription: {
      billingPeriod: row.billing_period,
      planId: subscriptionPlan,
      status: row.subscription_status ?? 'active',
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
    },
    user: {
      email: row.email,
      id: row.user_id,
      role: row.user_role,
      status: row.status,
    },
    workspace: {
      id: row.workspace_id,
      liveAccessStatus: row.live_access_status,
      name: row.workspace_name,
      ownerUserId: row.owner_user_id,
      planId: subscriptionPlan,
    },
  };
}

export async function resolveOwnerSaasRequestContext(seedDb: ThoonDb): Promise<ThoonRequestContext | undefined> {
  if (!isSaasMode()) {
    return undefined;
  }

  const workspaceId = await ensureOwnerWorkspace(seedDb);

  if (!workspaceId) {
    return undefined;
  }

  const record = await getPostgresPool().query<SaasSessionRecord>(
    `
      select
        '' as session_id,
        u.id as user_id,
        u.email,
        u.role as user_role,
        u.status,
        w.id as workspace_id,
        w.owner_user_id,
        w.name as workspace_name,
        w.plan_id,
        w.live_access_status,
        wm.role as membership_role,
        sub.plan_id as subscription_plan_id,
        sub.billing_period,
        sub.status as subscription_status,
        sub.stripe_customer_id,
        sub.stripe_subscription_id
      from workspaces w
      join users u on u.id = w.owner_user_id
      join workspace_members wm on wm.workspace_id = w.id and wm.user_id = u.id
      left join subscriptions sub on sub.workspace_id = w.id
      where w.id = $1
        and u.status = 'active'
      limit 1
    `,
    [workspaceId],
  );
  const row = record.rows[0];

  if (!row) {
    return undefined;
  }

  const db = await readWorkspaceState(row.workspace_id, seedDb);
  const subscriptionPlan = row.subscription_plan_id ?? row.plan_id;

  return {
    db,
    membership: { role: row.membership_role },
    mode: 'saas',
    subscription: {
      billingPeriod: row.billing_period,
      planId: subscriptionPlan,
      status: row.subscription_status ?? 'active',
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
    },
    user: {
      email: row.email,
      id: row.user_id,
      role: row.user_role,
      status: row.status,
    },
    workspace: {
      id: row.workspace_id,
      liveAccessStatus: row.live_access_status,
      name: row.workspace_name,
      ownerUserId: row.owner_user_id,
      planId: subscriptionPlan,
    },
  };
}

export function currentPlanFromContext(context: ThoonRequestContext | undefined): BillingPlanId {
  if (context?.subscription) {
    return context.subscription.status === 'active' || context.subscription.status === 'trialing' ? context.subscription.planId : 'free';
  }

  return context?.workspace?.planId ?? 'free';
}

export function canUseLiveTrading(context: ThoonRequestContext | undefined) {
  const planId = currentPlanFromContext(context);

  return planId === 'elite' && context?.workspace?.liveAccessStatus === 'approved';
}

export function workspacePlanLimits(context: ThoonRequestContext | undefined) {
  return planLimits[currentPlanFromContext(context)];
}

export async function upsertStripeSubscription({
  billingPeriod,
  currentPeriodEnd,
  planId,
  status,
  stripeCustomerId,
  stripeSubscriptionId,
  workspaceId,
}: {
  billingPeriod?: 'monthly' | 'yearly';
  currentPeriodEnd?: string;
  planId: BillingPlanId;
  status: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  workspaceId: string;
}) {
  await getPostgresPool().query(
    `
      insert into subscriptions (id, workspace_id, stripe_customer_id, stripe_subscription_id, plan_id, billing_period, status, current_period_end, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, now())
      on conflict (workspace_id)
      do update set
        stripe_customer_id = coalesce(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
        stripe_subscription_id = coalesce(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
        plan_id = excluded.plan_id,
        billing_period = excluded.billing_period,
        status = excluded.status,
        current_period_end = excluded.current_period_end,
        updated_at = now()
    `,
    [`sub-local-${workspaceId}`, workspaceId, stripeCustomerId, stripeSubscriptionId, planId, billingPeriod, status, currentPeriodEnd],
  );
  await getPostgresPool().query('update workspaces set plan_id = $2, updated_at = now() where id = $1', [workspaceId, planId]);
}

export async function requestLiveAccessReview({ context, reason }: { context: ThoonRequestContext; reason?: string }) {
  if (!context.workspace || !context.user) {
    throw new Error('A workspace session is required.');
  }

  if (currentPlanFromContext(context) !== 'elite') {
    throw new Error('Live trading review is reserved for active Elite workspaces.');
  }

  const id = `live-review-${randomBytes(12).toString('base64url')}`;

  await getPostgresPool().query(
    `
      insert into live_access_reviews (id, workspace_id, requested_by_user_id, status, notes)
      values ($1, $2, $3, 'pending', $4)
    `,
    [id, context.workspace.id, context.user.id, reason?.slice(0, 2000)],
  );
  await getPostgresPool().query(
    `
      update workspaces
      set live_access_status = case when live_access_status = 'approved' then live_access_status else 'pending' end,
          updated_at = now()
      where id = $1
    `,
    [context.workspace.id],
  );

  return { id, status: 'pending' as const };
}

export async function updateLiveAccessReview({
  notes,
  reviewerUserId,
  status,
  workspaceId,
}: {
  notes?: string;
  reviewerUserId: string;
  status: 'approved' | 'rejected';
  workspaceId: string;
}) {
  const id = `live-review-${randomBytes(12).toString('base64url')}`;
  const pool = getPostgresPool();
  const workspace = await pool.query<{ owner_user_id: string }>(
    `
      update workspaces
      set live_access_status = $2,
          updated_at = now()
      where id = $1
      returning owner_user_id
    `,
    [workspaceId, status],
  );
  const requestedByUserId = workspace.rows[0]?.owner_user_id;

  if (!requestedByUserId) {
    throw new Error('Workspace not found for live access review.');
  }

  await pool.query(
    `
      insert into live_access_reviews (id, workspace_id, requested_by_user_id, reviewed_by_user_id, status, notes, reviewed_at)
      values ($1, $2, $3, $4, $5, $6, now())
    `,
    [id, workspaceId, requestedByUserId, reviewerUserId, status, notes?.slice(0, 2000)],
  );

  return { id, status, workspaceId };
}

export function requestIp(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 80) || request.headers.get('x-real-ip')?.trim().slice(0, 80) || 'local';
}

function stableId(prefix: string, value: string) {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 18)}`;
}
