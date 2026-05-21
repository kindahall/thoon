import { NextResponse, type NextRequest } from 'next/server';

import { getDeterministicStrategyAgentsStatus, runDeterministicStrategyAgents } from '../../../../server/deterministic-strategy-agents';
import { readOptionalJson } from '../../../../server/bud-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    payload: getDeterministicStrategyAgentsStatus(),
    source: 'thoon_deterministic_strategy_agents',
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await readOptionalJson(request);
    const result = await runDeterministicStrategyAgents({
      agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
      limit: typeof body.limit === 'number' ? body.limit : undefined,
      queryLimit: typeof body.queryLimit === 'number' ? body.queryLimit : undefined,
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      payload: result,
      source: 'thoon_deterministic_strategy_agents',
    });
  } catch (error) {
    return NextResponse.json(
      {
        detail: error instanceof Error ? error.message : 'Deterministic strategy agents failed',
        generatedAt: new Date().toISOString(),
        source: 'thoon_deterministic_strategy_agents',
      },
      { status: 500 },
    );
  }
}
