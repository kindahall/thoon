import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { BudBackendError, normalizeBudSymbol } from './bud-backend-client';

export type JsonRecord = Record<string, unknown>;

export async function readOptionalJson(request: NextRequest): Promise<JsonRecord> {
  if (request.headers.get('content-length') === '0') {
    return {};
  }

  try {
    const payload: unknown = await request.json();

    return isRecord(payload) ? payload : {};
  } catch {
    return {};
  }
}

export function budRouteResponse<T>(payload: T, status = 200) {
  return NextResponse.json(
    {
      receivedAt: new Date().toISOString(),
      source: 'thoon_bud_backend',
      payload,
    },
    { status },
  );
}

export function budRouteError(error: unknown) {
  if (error instanceof BudBackendError) {
    return NextResponse.json(
      {
        detail: error.message,
        receivedAt: new Date().toISOString(),
        source: 'thoon_bud_backend',
        status: error.status,
      },
      { status: error.status },
    );
  }

  return NextResponse.json(
    {
      detail: error instanceof Error ? error.message : 'Bud backend route failed',
      receivedAt: new Date().toISOString(),
      source: 'thoon_bud_backend',
      status: 500,
    },
    { status: 500 },
  );
}

export function boolFromBody(body: JsonRecord, key: string, fallback: boolean) {
  return typeof body[key] === 'boolean' ? Boolean(body[key]) : fallback;
}

export function numberFromBody(body: JsonRecord, key: string, fallback: number, min: number, max: number) {
  const value = typeof body[key] === 'number' ? body[key] : typeof body[key] === 'string' ? Number(body[key]) : fallback;

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, value));
}

export function stringFromBody(body: JsonRecord, key: string, fallback: string) {
  const value = body[key];

  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function normalizeBudSymbols(value: unknown, fallback: string[]) {
  const rawSymbols = Array.isArray(value) ? value : fallback;
  const symbols = rawSymbols
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => normalizeBudSymbol(item));

  return Array.from(new Set(symbols));
}

export function normalizeBudInterval(value: unknown, fallback = '1h') {
  const interval = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  const allowed = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']);

  return allowed.has(interval) ? interval : fallback;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
