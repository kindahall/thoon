import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const thoonSessionCookieName = 'thoon_session';
const defaultSessionSecret = 'dev-local-session-secret-change-before-prod';

export async function proxy(request: NextRequest) {
  if (!isAuthRequiredAtEdge()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (isAuthorizedCronRequest(request)) {
    return NextResponse.next();
  }

  const hasValidSession = await verifySessionCookie(request.cookies.get(thoonSessionCookieName)?.value);

  if (hasValidSession && (await verifyStoredSession(request))) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', `${pathname}${request.nextUrl.search}`);

  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

function isPublicPath(pathname: string) {
  return pathname === '/login' || pathname.startsWith('/api/auth') || pathname.startsWith('/_next') || pathname === '/favicon.ico' || pathname === '/thoon-mark.svg';
}

function isAuthorizedCronRequest(request: NextRequest) {
  return (
    isAgentCronPath(request.nextUrl.pathname) &&
    Boolean(process.env.THOON_CRON_SECRET) &&
    request.headers.get('authorization') === `Bearer ${process.env.THOON_CRON_SECRET}`
  );
}

function isAgentCronPath(pathname: string) {
  return pathname === '/api/agent/cron' || pathname === '/api/agent/progress';
}

function isAuthRequiredAtEdge() {
  if (process.env.THOON_AUTH_MODE === 'local-required') {
    return true;
  }

  if (process.env.THOON_AUTH_MODE === 'local-disabled') {
    return false;
  }

  return process.env.NODE_ENV === 'production';
}

async function verifyStoredSession(request: NextRequest) {
  try {
    const url = request.nextUrl.clone();
    url.pathname = '/api/auth/session';
    url.search = '';

    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        cookie: request.headers.get('cookie') ?? '',
        'x-thoon-proxy-session-check': '1',
      },
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function verifySessionCookie(value?: string) {
  if (!value) {
    return false;
  }

  const parts = value.split('.');

  if (parts.length !== 2) {
    return false;
  }

  const [payload, signature] = parts;

  if (!payload || !signature || !constantTimeEqual(signature, await signSessionPayload(payload))) {
    return false;
  }

  try {
    const session = JSON.parse(base64UrlDecode(payload)) as Partial<{
      email: string;
      expiresAt: string;
      issuedAt: string;
      role: string;
      sessionId: string;
    }>;

    return Boolean(
      session.email &&
        session.expiresAt &&
        session.issuedAt &&
        session.sessionId &&
        session.role === 'owner' &&
        new Date(session.expiresAt).getTime() > Date.now(),
    );
  } catch {
    return false;
  }
}

async function signSessionPayload(payload: string) {
  const encoder = new TextEncoder();
  const secret = process.env.THOON_AUTH_SESSION_SECRET ?? defaultSessionSecret;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { hash: 'SHA-256', name: 'HMAC' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));

  return base64UrlEncode(signature);
}

function constantTimeEqual(left: string, right: string) {
  let diff = left.length ^ right.length;
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return diff === 0;
}

function base64UrlEncode(value: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(value);

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');

  return decodeURIComponent(
    Array.from(atob(padded))
      .map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join(''),
  );
}
