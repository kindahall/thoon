import { NextResponse } from 'next/server';

import { getLiveConnectorReadiness } from '../../../../server/live-connector-readiness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    payload: getLiveConnectorReadiness(),
    source: 'thoon_live_connector_readiness',
  });
}
