import { NextResponse, type NextRequest } from 'next/server';

import { readOptionalJson, stringFromBody } from '../../../../server/bud-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const { getBudBackendProcessStatus } = await import('../../../../server/bud-process-control');

  return NextResponse.json({
    payload: await getBudBackendProcessStatus(),
    receivedAt: new Date().toISOString(),
    source: 'thoon_bud_process',
  });
}

export async function POST(request: NextRequest) {
  try {
    const { getBudBackendProcessStatus, startBudBackendProcess, stopBudBackendProcess } = await import('../../../../server/bud-process-control');
    const body = await readOptionalJson(request);
    const action = stringFromBody(body, 'action', 'status');

    if (action === 'start') {
      return processResponse(await startBudBackendProcess());
    }

    if (action === 'stop') {
      if (body.confirmation !== 'STOP_BUD_BACKEND') {
        return NextResponse.json({ detail: 'Backend stop requires confirmation', source: 'thoon_bud_process' }, { status: 428 });
      }

      return processResponse(await stopBudBackendProcess());
    }

    if (action === 'status') {
      return processResponse(await getBudBackendProcessStatus());
    }

    return NextResponse.json({ detail: 'Unsupported backend process action', source: 'thoon_bud_process' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : 'Backend process action failed', source: 'thoon_bud_process' }, { status: 500 });
  }
}

function processResponse(payload: unknown) {
  return NextResponse.json({
    payload,
    receivedAt: new Date().toISOString(),
    source: 'thoon_bud_process',
  });
}
