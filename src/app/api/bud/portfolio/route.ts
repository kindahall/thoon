import type { NextRequest } from 'next/server';

import { constructBudPortfolio } from '../../../../server/bud-backend-client';
import { boolFromBody, budRouteError, budRouteResponse, normalizeBudInterval, normalizeBudSymbols, numberFromBody, readOptionalJson, stringFromBody } from '../../../../server/bud-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await readOptionalJson(request);
    const result = await constructBudPortfolio(
      {
        exchange: stringFromBody(body, 'exchange', 'binance'),
        include_advanced_risk: boolFromBody(body, 'include_advanced_risk', boolFromBody(body, 'includeAdvancedRisk', true)),
        include_liquidity_risk: boolFromBody(body, 'include_liquidity_risk', boolFromBody(body, 'includeLiquidityRisk', true)),
        include_macro_regime: boolFromBody(body, 'include_macro_regime', boolFromBody(body, 'includeMacroRegime', true)),
        interval: normalizeBudInterval(body.interval, '1h'),
        lookback: Math.round(numberFromBody(body, 'lookback', 500, 240, 1000)),
        max_gross_exposure: numberFromBody(body, 'max_gross_exposure', numberFromBody(body, 'maxGrossExposure', 1, 0.01, 2), 0.01, 2),
        max_weight_per_asset: numberFromBody(body, 'max_weight_per_asset', numberFromBody(body, 'maxWeightPerAsset', 0.5, 0.01, 1), 0.01, 1),
        method: stringFromBody(body, 'method', 'blend'),
        min_cash_weight: numberFromBody(body, 'min_cash_weight', numberFromBody(body, 'minCashWeight', 0.05, 0, 0.95), 0, 0.95),
        portfolio_value: numberFromBody(body, 'portfolio_value', numberFromBody(body, 'portfolioValue', 10_000, 1, 100_000_000), 1, 100_000_000),
        symbols: normalizeBudSymbols(body.symbols, ['BTCUSDT', 'ETHUSDT']),
      },
      request.signal,
    );

    return budRouteResponse(result);
  } catch (error) {
    return budRouteError(error);
  }
}
