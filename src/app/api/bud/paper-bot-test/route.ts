import { NextResponse, type NextRequest } from 'next/server';

import { finalizeBudPaperBotTest, getBudPaperBotTests, startBudPaperBotTest } from '../../../../server/paper-bot-runner';
import { readOptionalJson } from '../../../../server/bud-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({
      payload: await getBudPaperBotTests(request.signal),
      receivedAt: new Date().toISOString(),
      source: 'thoon_paper_bot_runner',
    });
  } catch (error) {
    return paperBotError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readOptionalJson(request);
    const action = typeof body.action === 'string' ? body.action : 'start';

    if (action === 'finalize') {
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
      const result = await finalizeBudPaperBotTest(sessionId, request.signal);

      return NextResponse.json({
        payload: result,
        receivedAt: new Date().toISOString(),
        source: 'thoon_paper_bot_runner',
      });
    }

    const result = await startBudPaperBotTest(
      {
        durationMinutes: typeof body.durationMinutes === 'number' ? body.durationMinutes : typeof body.duration_minutes === 'number' ? body.duration_minutes : 120,
        quantity: typeof body.quantity === 'number' ? body.quantity : 0.001,
        strategyId: typeof body.strategyId === 'string' ? body.strategyId : typeof body.strategy_id === 'string' ? body.strategy_id : undefined,
        symbol: typeof body.symbol === 'string' ? body.symbol : 'BTCUSDT',
      },
      request.signal,
    );

    return NextResponse.json({
      payload: result,
      receivedAt: new Date().toISOString(),
      source: 'thoon_paper_bot_runner',
    });
  } catch (error) {
    return paperBotError(error);
  }
}

function paperBotError(error: unknown) {
  return NextResponse.json(
    {
      detail: error instanceof Error ? error.message : 'Paper bot runner failed',
      receivedAt: new Date().toISOString(),
      source: 'thoon_paper_bot_runner',
    },
    { status: 500 },
  );
}
