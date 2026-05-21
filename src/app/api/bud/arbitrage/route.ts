import type { NextRequest } from 'next/server';

import { scanBudArbitrage } from '../../../../server/bud-backend-client';
import { boolFromBody, budRouteError, budRouteResponse, normalizeBudSymbols, numberFromBody, readOptionalJson } from '../../../../server/bud-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await readOptionalJson(request);
    const result = await scanBudArbitrage(
      {
        allow_rest_fallback: boolFromBody(body, 'allow_rest_fallback', boolFromBody(body, 'allowRestFallback', true)),
        max_latency_ms: numberFromBody(body, 'max_latency_ms', numberFromBody(body, 'maxLatencyMs', 1500, 1, 10_000), 1, 10_000),
        max_opportunities: Math.round(numberFromBody(body, 'max_opportunities', numberFromBody(body, 'maxOpportunities', 10, 1, 50), 1, 50)),
        min_liquidity_usdt: numberFromBody(body, 'min_liquidity_usdt', numberFromBody(body, 'minLiquidityUsdt', 500, 0, 10_000_000), 0, 10_000_000),
        min_net_spread_bps: numberFromBody(body, 'min_net_spread_bps', numberFromBody(body, 'minNetSpreadBps', 2, 0, 500), 0, 500),
        symbols: normalizeBudSymbols(body.symbols, ['BTCUSDT', 'ETHUSDT']),
        target_notional: numberFromBody(body, 'target_notional', numberFromBody(body, 'targetNotional', 250, 10, 100_000), 10, 100_000),
      },
      request.signal,
    );

    return budRouteResponse(result);
  } catch (error) {
    return budRouteError(error);
  }
}
