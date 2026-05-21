import type { NextRequest } from 'next/server';

import { getBudExecutionCapabilities, getBudPositions } from '../../../../server/bud-backend-client';
import { budRouteError, budRouteResponse } from '../../../../server/bud-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams;
    const params = new URLSearchParams();
    const exchange = search.get('exchange');
    const symbol = search.get('symbol');
    const mode = search.get('mode') === 'live' ? 'live' : 'paper';

    params.set('mode', mode);

    if (exchange) {
      params.set('exchange', exchange);
    }

    if (symbol) {
      params.set('symbol', symbol);
    }

    const [capabilities, positions] = await Promise.all([getBudExecutionCapabilities(request.signal), getBudPositions(params.toString(), request.signal)]);

    return budRouteResponse({ capabilities, positions });
  } catch (error) {
    return budRouteError(error);
  }
}
