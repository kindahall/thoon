import type { NextRequest } from 'next/server';

import { registerBudResearchStrategy } from '../../../../../server/bud-backend-client';
import { budRouteError, budRouteResponse, isRecord, readOptionalJson, stringFromBody } from '../../../../../server/bud-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const strategyTypes = new Set(['sma_cross', 'ema_trend', 'donchian_breakout', 'rsi_mean_reversion', 'bollinger_reversion', 'momentum_volatility', 'volume_breakout']);
const strategyStatuses = new Set(['candidate', 'active', 'retired']);
const regimeNames = new Set(['bull_market', 'bear_market', 'high_volatility', 'low_liquidity']);

export async function POST(request: NextRequest) {
  try {
    const body = await readOptionalJson(request);
    const result = await registerBudResearchStrategy(
      {
        conditions: isRecord(body.conditions) ? body.conditions : {},
        metadata: {
          ...(isRecord(body.metadata) ? body.metadata : {}),
          thoon_edit_source: 'strategies_workspace',
          thoon_edited_at: new Date().toISOString(),
        },
        name: stringFromBody(body, 'name', 'Edited Bud strategy'),
        params: isRecord(body.params) ? body.params : {},
        parent_strategy_id: optionalString(body.parent_strategy_id ?? body.parentStrategyId),
        regime_tags: normalizeRegimeTags(body.regime_tags ?? body.regimeTags),
        status: normalizeStatus(stringFromBody(body, 'status', 'candidate')),
        strategy_type: normalizeStrategyType(stringFromBody(body, 'strategy_type', stringFromBody(body, 'strategyType', 'sma_cross'))),
      },
      request.signal,
    );

    return budRouteResponse(result);
  } catch (error) {
    return budRouteError(error);
  }
}

function normalizeStrategyType(value: string) {
  return strategyTypes.has(value) ? value : 'sma_cross';
}

function normalizeStatus(value: string) {
  return strategyStatuses.has(value) ? value : 'candidate';
}

function normalizeRegimeTags(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && regimeNames.has(item)) : [];
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
