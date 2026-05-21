import type { NextRequest } from 'next/server';

import { normalizeBudSymbol, runBudBacktest } from '../../../../server/bud-backend-client';
import { boolFromBody, budRouteError, budRouteResponse, isRecord, normalizeBudInterval, numberFromBody, readOptionalJson, stringFromBody } from '../../../../server/bud-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await readOptionalJson(request);
    const result = await runBudBacktest(
      {
        estimate_transaction_costs: boolFromBody(body, 'estimate_transaction_costs', boolFromBody(body, 'estimateTransactionCosts', true)),
        interval: normalizeBudInterval(body.interval, '1h'),
        limit: Math.round(numberFromBody(body, 'limit', 500, 60, 1000)),
        reject_if_edge_below_costs: boolFromBody(body, 'reject_if_edge_below_costs', boolFromBody(body, 'rejectIfEdgeBelowCosts', false)),
        strategy: isRecord(body.strategy) ? body.strategy : undefined,
        symbol: normalizeBudSymbol(stringFromBody(body, 'symbol', 'BTCUSDT')),
        validate_data_quality: boolFromBody(body, 'validate_data_quality', boolFromBody(body, 'validateDataQuality', true)),
        walk_forward_validate: boolFromBody(body, 'walk_forward_validate', boolFromBody(body, 'walkForwardValidate', true)),
      },
      request.signal,
    );

    return budRouteResponse(result);
  } catch (error) {
    return budRouteError(error);
  }
}
