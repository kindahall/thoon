import type { NextRequest } from 'next/server';

import { budRouteError, budRouteResponse } from '../../../../server/bud-route';
import { getHedgeFundReadiness } from '../../../../server/hedge-fund-readiness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    return budRouteResponse(await getHedgeFundReadiness(request.signal));
  } catch (error) {
    return budRouteError(error);
  }
}
