import type { NextRequest } from 'next/server';

import { getBudResearchEvaluations, getBudResearchRuns, getBudResearchStrategies, normalizeBudSymbol, runBudResearch } from '../../../../server/bud-backend-client';
import { boolFromBody, budRouteError, budRouteResponse, normalizeBudInterval, numberFromBody, readOptionalJson, stringFromBody } from '../../../../server/bud-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const limit = Math.round(Math.max(1, Math.min(100, Number(request.nextUrl.searchParams.get('limit') ?? 25))));
    const [runs, strategies, evaluations] = await Promise.all([getBudResearchRuns(limit, request.signal), getBudResearchStrategies(limit, request.signal), getBudResearchEvaluations(limit, request.signal)]);

    return budRouteResponse({ evaluations, runs, strategies });
  } catch (error) {
    return budRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readOptionalJson(request);
    const result = await runBudResearch(
      {
        exchange: stringFromBody(body, 'exchange', 'binance'),
        force_new_generation: boolFromBody(body, 'force_new_generation', boolFromBody(body, 'forceNewGeneration', false)),
        interval: normalizeBudInterval(body.interval, '1h'),
        limit: Math.round(numberFromBody(body, 'limit', 500, 220, 1000)),
        max_candidates: Math.round(numberFromBody(body, 'max_candidates', numberFromBody(body, 'maxCandidates', 10, 3, 40), 3, 40)),
        symbol: normalizeBudSymbol(stringFromBody(body, 'symbol', 'BTCUSDT')),
        top_n: Math.round(numberFromBody(body, 'top_n', numberFromBody(body, 'topN', 5, 1, 20), 1, 20)),
      },
      request.signal,
    );

    return budRouteResponse(result);
  } catch (error) {
    return budRouteError(error);
  }
}
