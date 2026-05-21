import type { NextRequest } from 'next/server';

import { appendAuditEvent } from '../../../../server/audit';
import { budRouteError, budRouteResponse, readOptionalJson } from '../../../../server/bud-route';
import { updateThoonDb } from '../../../../server/thoon-db';

type JsonRecord = Record<string, unknown>;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await readOptionalJson(request);
    const result = asRecord(body.result);
    const draft = asRecord(body.draft);
    const execution = asRecord(body.execution);
    const selectedEvaluation = asRecord(body.selectedEvaluation);
    const metrics = asRecord(readPath(result, ['metrics']));
    const walkForward = asRecord(readPath(result, ['walk_forward']));
    const blockers = [
      ...asArray(readPath(walkForward, ['rejection_reasons'])).map(String),
      ...asArray(readPath(selectedEvaluation, ['rejection_reasons'])).map(String),
    ].filter(Boolean);
    const decision = orchestratorDecision(metrics, walkForward, blockers);
    const reply = {
      confidence: decision.confidence,
      decision: decision.status,
      summary: [
        `Strategy ${stringValue(readPath(draft, ['name']), 'edited strategy')} submitted from Backtest Lab.`,
        `Symbol ${stringValue(body.symbol, 'unknown')} on ${stringValue(body.timeframe, 'unknown timeframe')}.`,
        `Return ${percentValue(readPath(metrics, ['total_return']))}, win rate ${percentValue(readPath(metrics, ['win_rate']))}, drawdown ${percentValue(readPath(metrics, ['max_drawdown']))}, trades ${stringValue(readPath(metrics, ['total_trades']), 'not verified')}.`,
        `Execution profile: ${stringValue(readPath(execution, ['direction_mode']), 'both')} direction, ${stringValue(readPath(execution, ['risk_per_trade_pct']), '1')}% risk, ${stringValue(readPath(execution, ['fee_bps']), '10')} bps fees, ${stringValue(readPath(execution, ['slippage_bps']), '3')} bps slippage.`,
        decision.reason,
      ],
    };
    const questions = [
      'Quel minimum acceptes-tu avant paper: profit factor, win rate, drawdown max et nombre de trades ?',
      'Dois-je tester cette variante sur plusieurs paires/timeframes avant de la garder ?',
      'Veux-tu que cette variante soit sauvegardee comme candidate ou rejetee apres ce resultat ?',
    ];
    const payload = {
      blockers,
      generatedAt: new Date().toISOString(),
      questions,
      reply,
      source: 'thoon_bud_backtest_orchestrator',
    };

    updateThoonDb((db) => {
      appendAuditEvent(db, {
        action: 'Bud backtest orchestrator review',
        actor: 'system',
        details: `${reply.decision}: ${reply.summary.join(' ').slice(0, 420)}`,
        eventType: 'strategy',
        status: blockers.length ? 'warning' : 'success',
        symbol: stringValue(body.symbol, undefined),
      });

      return null;
    });

    return budRouteResponse(payload);
  } catch (error) {
    return budRouteError(error);
  }
}

function orchestratorDecision(metrics: JsonRecord, walkForward: JsonRecord, blockers: string[]) {
  const totalReturn = numberValue(readPath(metrics, ['total_return']));
  const winRate = numberValue(readPath(metrics, ['win_rate']));
  const drawdown = Math.abs(numberValue(readPath(metrics, ['max_drawdown'])));
  const trades = numberValue(readPath(metrics, ['total_trades']));
  const accepted = readPath(walkForward, ['accepted']) === true;

  if (blockers.length || !accepted) {
    return {
      confidence: 'medium',
      reason: 'Decision: rejected for now because walk-forward validation or rejection reasons are not clean.',
      status: 'reject_or_rework',
    };
  }

  if (totalReturn > 0 && winRate >= 0.45 && drawdown <= 0.12 && trades >= 20) {
    return {
      confidence: 'high',
      reason: 'Decision: candidate for broader paper validation, not live.',
      status: 'paper_candidate',
    };
  }

  return {
    confidence: 'low',
    reason: 'Decision: keep testing; evidence is not strong enough for a bot candidate.',
    status: 'needs_more_tests',
  };
}

function readPath(record: unknown, path: string[]): unknown {
  let current = record;

  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function percentValue(value: unknown) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 'not verified';
  }

  return `${(Math.abs(parsed) <= 1 ? parsed * 100 : parsed).toFixed(2)}%`;
}

function stringValue(value: unknown, fallback: string | undefined): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return fallback ?? '';
}
