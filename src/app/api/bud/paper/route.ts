import { NextResponse, type NextRequest } from 'next/server';

import { getBudPaperRiskLimits, getBudPaperState, getBudPaperTrades, normalizeBudSymbol, placeBudPaperOrder } from '../../../../server/bud-backend-client';
import { budRouteError, budRouteResponse, numberFromBody, readOptionalJson, stringFromBody } from '../../../../server/bud-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const symbol = normalizeBudSymbol(request.nextUrl.searchParams.get('symbol') ?? 'BTCUSDT');
    const limit = Math.round(Math.max(1, Math.min(250, Number(request.nextUrl.searchParams.get('limit') ?? 50))));
    const [state, trades, riskLimits] = await Promise.all([getBudPaperState(symbol, request.signal), getBudPaperTrades(symbol, limit, request.signal), getBudPaperRiskLimits(request.signal)]);

    return budRouteResponse({ riskLimits, state, trades });
  } catch (error) {
    return budRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readOptionalJson(request);
    const side = stringFromBody(body, 'side', 'buy').toLowerCase();

    if (side !== 'buy' && side !== 'sell') {
      return NextResponse.json({ detail: 'Paper order side must be buy or sell', source: 'thoon_bud_backend' }, { status: 400 });
    }

    if (body.live_trading === true || body.liveTrading === true || body.paper_trading === false || body.paperTrading === false) {
      return NextResponse.json({ detail: 'This route only allows paper trading orders', source: 'thoon_bud_backend' }, { status: 403 });
    }

    const result = await placeBudPaperOrder(
      {
        client_order_id: typeof body.client_order_id === 'string' ? body.client_order_id : typeof body.clientOrderId === 'string' ? body.clientOrderId : undefined,
        quantity: numberFromBody(body, 'quantity', 0, 0, 1_000_000),
        side,
        symbol: normalizeBudSymbol(stringFromBody(body, 'symbol', 'BTCUSDT')),
      },
      request.signal,
    );

    return budRouteResponse(result);
  } catch (error) {
    return budRouteError(error);
  }
}
