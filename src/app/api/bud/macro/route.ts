import type { NextRequest } from 'next/server';

import { analyzeBudMacro } from '../../../../server/bud-backend-client';
import { budRouteError, budRouteResponse, normalizeBudInterval, normalizeBudSymbols, numberFromBody, readOptionalJson, stringFromBody } from '../../../../server/bud-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await readOptionalJson(request);
    const result = await analyzeBudMacro(
      {
        breakdown_threshold: numberFromBody(body, 'breakdown_threshold', numberFromBody(body, 'breakdownThreshold', 0.35, 0.05, 1), 0.05, 1),
        correlation_window: Math.round(numberFromBody(body, 'correlation_window', numberFromBody(body, 'correlationWindow', 60, 20, 240), 20, 240)),
        crypto_exchange: stringFromBody(body, 'crypto_exchange', stringFromBody(body, 'cryptoExchange', 'binance')),
        crypto_lookback: Math.round(numberFromBody(body, 'crypto_lookback', numberFromBody(body, 'cryptoLookback', 720, 240, 1000), 240, 1000)),
        interval: normalizeBudInterval(body.interval, '1h'),
        macro_lookback_days: Math.round(numberFromBody(body, 'macro_lookback_days', numberFromBody(body, 'macroLookbackDays', 540, 120, 2500), 120, 2500)),
        symbols: normalizeBudSymbols(body.symbols, ['BTCUSDT', 'ETHUSDT']),
      },
      request.signal,
    );

    return budRouteResponse(result);
  } catch (error) {
    return budRouteError(error);
  }
}
