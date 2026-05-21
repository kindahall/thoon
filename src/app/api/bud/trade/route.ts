import { randomUUID } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { getHedgeFundReadiness } from '../../../../server/hedge-fund-readiness';
import { normalizeBudSymbol, placeBudTrade } from '../../../../server/bud-backend-client';
import { budRouteError, budRouteResponse, numberFromBody, readOptionalJson, stringFromBody } from '../../../../server/bud-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const exchanges = new Set(['binance', 'bybit', 'bitget', 'hyperliquid', 'dydx']);
const categories = new Set(['spot', 'linear', 'inverse', 'option']);
const budLiveConfirmationText = 'I_UNDERSTAND_LIVE_CRYPTO_TRADING';

export async function POST(request: NextRequest) {
  try {
    const body = await readOptionalJson(request);
    const liveRequested = body.live_trading === true || body.liveTrading === true || body.paper_trading === false || body.paperTrading === false;
    const automatedRequest = isAutomatedExecution(body);

    if (liveRequested && automatedRequest) {
      const readiness = await getHedgeFundReadiness(request.signal);

      if (!readiness.liveReady) {
        return NextResponse.json(
          {
            blockers: readiness.blockers,
            detail: 'Live trading blocked by Thoon hedge fund readiness gates',
            readiness: {
              generatedAt: readiness.generatedAt,
              score: readiness.score,
              status: readiness.status,
              summary: readiness.summary,
            },
            source: 'thoon_bud_trade_gate',
            status: 403,
          },
          { status: 403 },
        );
      }
    }

    if (liveRequested && !hasManualLiveConfirmation(body)) {
      return NextResponse.json(
        {
          confirmationRequired: true,
          detail: 'Manual live trading requires explicit user confirmation.',
          live_confirmation_text: budLiveConfirmationText,
          source: 'thoon_bud_trade_gate',
          status: 428,
        },
        { status: 428 },
      );
    }

    const side = stringFromBody(body, 'side', 'buy').toLowerCase();
    if (side !== 'buy' && side !== 'sell') {
      return NextResponse.json({ detail: 'Trade side must be buy or sell', source: 'thoon_bud_trade_gate' }, { status: 400 });
    }

    const exchange = normalizeExchange(stringFromBody(body, 'exchange', 'binance'));
    const orderType = stringFromBody(body, 'order_type', stringFromBody(body, 'orderType', 'MARKET')).toUpperCase();
    const category = normalizeCategory(stringFromBody(body, 'category', 'spot'));
    const clientOrderId = typeof body.client_order_id === 'string' ? body.client_order_id : typeof body.clientOrderId === 'string' ? body.clientOrderId : undefined;
    const strategyId = typeof body.strategy_id === 'string' ? body.strategy_id : typeof body.strategyId === 'string' ? body.strategyId : undefined;
    const strategyConfidence = optionalNumber(body.strategy_confidence ?? body.strategyConfidence);
    const price = optionalNumber(body.price);
    const expectedPrice = optionalNumber(body.expected_price ?? body.expectedPrice);
    const payload = {
      category,
      client_order_id: clientOrderId ?? (liveRequested ? `thoon-live-${randomUUID()}`.slice(0, 64) : undefined),
      exchange,
      expected_price: expectedPrice,
      leverage: numberFromBody(body, 'leverage', 1, 1, 125),
      live_confirmation: liveRequested ? budLiveConfirmation(body) : undefined,
      live_trading: liveRequested,
      max_slippage_bps: numberFromBody(body, 'max_slippage_bps', numberFromBody(body, 'maxSlippageBps', 25, 1, 1000), 1, 1000),
      order_type: orderType === 'LIMIT' ? 'LIMIT' : 'MARKET',
      paper_trading: !liveRequested,
      price,
      quantity: numberFromBody(body, 'quantity', 0, 0, 1_000_000),
      reduce_only: body.reduce_only === true || body.reduceOnly === true,
      side,
      strategy_confidence: strategyConfidence,
      strategy_id: strategyId,
      symbol: normalizeBudSymbol(stringFromBody(body, 'symbol', 'BTCUSDT')),
    };

    const result = await placeBudTrade(payload, request.signal);

    return budRouteResponse(result);
  } catch (error) {
    return budRouteError(error);
  }
}

function normalizeExchange(value: string) {
  const normalized = value.toLowerCase();

  return exchanges.has(normalized) ? normalized : 'binance';
}

function normalizeCategory(value: string) {
  const normalized = value.toLowerCase();

  return categories.has(normalized) ? normalized : 'spot';
}

function isAutomatedExecution(body: Record<string, unknown>) {
  const source = stringFromBody(body, 'execution_source', stringFromBody(body, 'executionSource', stringFromBody(body, 'source', 'manual'))).toLowerCase();
  const actor = stringFromBody(body, 'actor', '').toLowerCase();

  return body.automated === true || body.orchestrated === true || ['agent', 'automation', 'bot', 'orchestrator'].includes(source) || ['agent', 'automation', 'bot', 'orchestrator'].includes(actor);
}

function hasManualLiveConfirmation(body: Record<string, unknown>) {
  return body.confirmed === true || body.confirmation === 'confirmed' || body.live_confirmation === budLiveConfirmationText || body.liveConfirmation === budLiveConfirmationText;
}

function budLiveConfirmation(body: Record<string, unknown>) {
  if (body.confirmed === true || body.confirmation === 'confirmed') {
    return budLiveConfirmationText;
  }

  return typeof body.live_confirmation === 'string' ? body.live_confirmation : typeof body.liveConfirmation === 'string' ? body.liveConfirmation : undefined;
}

function optionalNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : undefined;

  return Number.isFinite(parsed) && parsed !== undefined && parsed > 0 ? parsed : undefined;
}
