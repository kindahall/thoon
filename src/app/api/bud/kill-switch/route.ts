import { NextResponse, type NextRequest } from 'next/server';

import { commandBudKillSwitch } from '../../../../server/bud-backend-client';
import { budRouteError, budRouteResponse, readOptionalJson, stringFromBody } from '../../../../server/bud-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const result = await commandBudKillSwitch({ action: 'status' }, request.signal);

    return budRouteResponse(result);
  } catch (error) {
    return budRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readOptionalJson(request);
    const action = stringFromBody(body, 'action', 'trigger').toLowerCase();

    if (action === 'reset' && body.confirmation !== 'RESET_KILL_SWITCH') {
      return NextResponse.json({ detail: 'Kill switch reset requires confirmation', source: 'thoon_bud_backend' }, { status: 428 });
    }

    if (action !== 'trigger' && action !== 'reset' && action !== 'status') {
      return NextResponse.json({ detail: 'Unsupported kill switch action', source: 'thoon_bud_backend' }, { status: 400 });
    }

    const result = await commandBudKillSwitch(
      {
        action,
        detail: stringFromBody(body, 'detail', action === 'trigger' ? 'manual Thoon/Bud kill switch trigger' : ''),
        reason: stringFromBody(body, 'reason', 'manual'),
      },
      request.signal,
    );

    return budRouteResponse(result);
  } catch (error) {
    return budRouteError(error);
  }
}
