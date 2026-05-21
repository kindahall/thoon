import { NextResponse } from 'next/server';

import { getThoonServerEnv } from '../../../../server/env';
import { getBudExecutionCapabilities, getBudHealth, getBudPaperRiskLimits, getBudPositions } from '../../../../server/bud-backend-client';
import { budRouteError } from '../../../../server/bud-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const env = getThoonServerEnv();
    const [health, capabilities, paperRiskLimits, paperPositions] = await Promise.allSettled([getBudHealth(), getBudExecutionCapabilities(), getBudPaperRiskLimits(), getBudPositions('mode=paper')]);

    return NextResponse.json({
      backendUrl: env.budBackendUrl,
      capabilities: settledValue(capabilities),
      health: settledValue(health),
      paperPositions: settledValue(paperPositions) ?? [],
      paperRiskLimits: settledValue(paperRiskLimits),
      receivedAt: new Date().toISOString(),
      source: 'thoon_bud_backend',
      status: health.status === 'fulfilled' ? 'online' : 'degraded',
      warnings: [settledWarning('health', health), settledWarning('capabilities', capabilities), settledWarning('paperRiskLimits', paperRiskLimits), settledWarning('paperPositions', paperPositions)].filter(Boolean),
    });
  } catch (error) {
    return budRouteError(error);
  }
}

function settledValue<T>(result: PromiseSettledResult<T>) {
  return result.status === 'fulfilled' ? result.value : null;
}

function settledWarning(label: string, result: PromiseSettledResult<unknown>) {
  return result.status === 'rejected' ? `${label}: ${result.reason instanceof Error ? result.reason.message : 'unavailable'}` : null;
}
