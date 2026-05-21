import type { NextRequest } from 'next/server';

import { checkBudLiveReadiness } from '../../../../server/bud-backend-client';
import { boolFromBody, budRouteError, budRouteResponse, normalizeBudSymbols, numberFromBody, readOptionalJson, stringFromBody } from '../../../../server/bud-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return runReadiness(request, {});
}

export async function POST(request: NextRequest) {
  return runReadiness(request, await readOptionalJson(request));
}

async function runReadiness(request: NextRequest, body: Record<string, unknown>) {
  try {
    const result = await checkBudLiveReadiness(
      {
        category: stringFromBody(body, 'category', 'spot'),
        check_api_permissions: boolFromBody(body, 'check_api_permissions', boolFromBody(body, 'checkApiPermissions', true)),
        check_live_positions: boolFromBody(body, 'check_live_positions', boolFromBody(body, 'checkLivePositions', true)),
        exchanges: normalizeExchanges(body.exchanges),
        max_allowed_live_positions: Math.round(numberFromBody(body, 'max_allowed_live_positions', numberFromBody(body, 'maxAllowedLivePositions', 0, 0, 100), 0, 100)),
        min_paper_trades: Math.round(numberFromBody(body, 'min_paper_trades', numberFromBody(body, 'minPaperTrades', 1, 0, 1000), 0, 1000)),
        min_safety_score: numberFromBody(body, 'min_safety_score', numberFromBody(body, 'minSafetyScore', 0.85, 0, 1), 0, 1),
        paper_symbol: stringFromBody(body, 'paper_symbol', stringFromBody(body, 'paperSymbol', 'BTCUSDT')),
        require_audit_trail: boolFromBody(body, 'require_audit_trail', boolFromBody(body, 'requireAuditTrail', true)),
        require_paper_promotion_evidence: boolFromBody(body, 'require_paper_promotion_evidence', boolFromBody(body, 'requirePaperPromotionEvidence', true)),
        symbols: normalizeBudSymbols(body.symbols, ['BTCUSDT']),
      },
      request.signal,
    );

    return budRouteResponse(result);
  } catch (error) {
    return budRouteError(error);
  }
}

function normalizeExchanges(value: unknown) {
  const allowed = new Set(['binance', 'bybit', 'bitget', 'hyperliquid', 'dydx']);
  const raw = Array.isArray(value) ? value : ['binance', 'bybit', 'bitget', 'hyperliquid', 'dydx'];
  const normalized = raw
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => allowed.has(item));

  return normalized.length ? Array.from(new Set(normalized)) : ['binance'];
}
