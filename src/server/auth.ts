import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { NextRequest } from 'next/server';

import { getThoonServerEnv, hasProductionEncryptionKey } from './env';
import { createPasswordHash, verifyPassword } from './password';
import { readThoonDb } from './thoon-db';

export const thoonSessionCookieName = 'thoon_session';
export { createPasswordHash, verifyPassword };

type SessionPayload = {
  email: string;
  expiresAt: string;
  issuedAt: string;
  role: SessionRole;
  sessionId: string;
  userId?: string;
  workspaceId?: string;
};

export type SessionRole = 'admin' | 'member' | 'owner';

export type AuthSession = {
  email: string;
  expiresAt: string;
  mode: 'disabled' | 'authenticated';
  role: SessionRole;
  sessionId?: string;
  userId?: string;
  workspaceId?: string;
};

export type StoredSession = {
  createdAt: string;
  email: string;
  expiresAt: string;
  id: string;
  ipAddress: string;
  lastSeenAt: string;
  revokedAt?: string;
  role: SessionRole;
  userAgent: string;
};

export function isAuthRequired() {
  return getThoonServerEnv().authMode === 'local-required';
}

export function getDisabledAuthSession(): AuthSession {
  return {
    email: getThoonServerEnv().thoonAdminEmail,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    mode: 'disabled',
    role: 'owner',
  };
}

export function createSessionCookieValue(session: SessionPayload) {
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  const signature = signSessionPayload(payload);

  return `${payload}.${signature}`;
}

export function parseSessionCookieValue(value?: string): SessionPayload | undefined {
  if (!value) {
    return undefined;
  }

  const [payload, signature] = value.split('.');

  if (!payload || !signature || !constantTimeStringEqual(signSessionPayload(payload), signature)) {
    return undefined;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<SessionPayload>;

    if (!session.email || !session.expiresAt || !session.issuedAt || !session.sessionId || !isSessionRole(session.role)) {
      return undefined;
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      return undefined;
    }

    return session as SessionPayload;
  } catch {
    return undefined;
  }
}

export function createLoginSession(email: string, options: { role?: SessionRole; userId?: string; workspaceId?: string } = {}) {
  const env = getThoonServerEnv();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.authSessionDays * 24 * 60 * 60 * 1000);
  const payload: SessionPayload = {
    email,
    expiresAt: expiresAt.toISOString(),
    issuedAt: now.toISOString(),
    role: options.role ?? 'owner',
    sessionId: `sess-${randomBytes(18).toString('base64url')}`,
    userId: options.userId,
    workspaceId: options.workspaceId,
  };

  return {
    cookie: createSessionCookieValue(payload),
    payload,
  };
}

export function getSessionFromRequest(request: NextRequest): AuthSession | undefined {
  if (!isAuthRequired()) {
    return getDisabledAuthSession();
  }

  const payload = parseSessionCookieValue(request.cookies.get(thoonSessionCookieName)?.value);

  if (!payload) {
    return undefined;
  }

  if (!isStoredSessionActive(payload)) {
    return undefined;
  }

  return {
    email: payload.email,
    expiresAt: payload.expiresAt,
    mode: 'authenticated',
    role: payload.role,
    sessionId: payload.sessionId,
    userId: payload.userId,
    workspaceId: payload.workspaceId,
  };
}

export function sessionCookieOptions(expiresAt: string) {
  const env = getThoonServerEnv();

  return {
    expires: new Date(expiresAt),
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    secure: env.authCookieSecure,
  };
}

export function clearedSessionCookieOptions() {
  const env = getThoonServerEnv();

  return {
    expires: new Date(0),
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    secure: env.authCookieSecure,
  };
}

export function getAuthProductionStatus() {
  const env = getThoonServerEnv();

  return {
    hasAdminPasswordHash: Boolean(env.thoonAdminPasswordHash),
    hasProductionEncryptionKey: hasProductionEncryptionKey(env.encryptionKey),
    hasProductionSessionSecret:
      env.authSessionSecret.length >= 32 &&
      env.authSessionSecret !== 'dev-local-session-secret-change-before-prod' &&
      env.authSessionSecret !== 'replace-with-a-long-random-session-secret',
    mode: env.authMode,
  };
}

function signSessionPayload(payload: string) {
  return createHmac('sha256', getThoonServerEnv().authSessionSecret).update(payload).digest('base64url');
}

function isSessionRole(value: unknown): value is SessionRole {
  return value === 'owner' || value === 'admin' || value === 'member';
}

function constantTimeStringEqual(left: string, right: string) {
  const leftValue = Buffer.from(left);
  const rightValue = Buffer.from(right);

  return leftValue.length === rightValue.length && timingSafeEqual(leftValue, rightValue);
}

function isStoredSessionActive(payload: SessionPayload) {
  try {
    const record = readThoonDb().sessionRecords.find((session) => session.id === payload.sessionId);

    return Boolean(
      record &&
        !record.revokedAt &&
        record.email === payload.email &&
        record.role === payload.role &&
        record.expiresAt === payload.expiresAt &&
        new Date(record.expiresAt).getTime() > Date.now(),
    );
  } catch {
    return false;
  }
}
