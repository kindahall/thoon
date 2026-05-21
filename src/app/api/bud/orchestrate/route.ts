import type { NextRequest } from 'next/server';

import { normalizeBudSymbol, runBudStrategyOrchestration } from '../../../../server/bud-backend-client';
import { boolFromBody, budRouteError, budRouteResponse, normalizeBudInterval, numberFromBody, readOptionalJson, stringFromBody } from '../../../../server/bud-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await readOptionalJson(request);
    const result = await runBudStrategyOrchestration(
      {
        include_fred: boolFromBody(body, 'include_fred', boolFromBody(body, 'includeFred', true)),
        interval: normalizeBudInterval(body.interval, '1h'),
        limit: Math.round(numberFromBody(body, 'limit', 120, 60, 500)),
        max_llm_retries: Math.round(numberFromBody(body, 'max_llm_retries', numberFromBody(body, 'maxLlmRetries', 1, 0, 5), 0, 5)),
        symbol: normalizeBudSymbol(stringFromBody(body, 'symbol', 'BTCUSDT')),
      },
      request.signal,
    );

    return budRouteResponse(result);
  } catch (error) {
    return budRouteError(error);
  }
}
