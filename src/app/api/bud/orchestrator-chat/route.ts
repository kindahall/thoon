import { randomUUID } from 'node:crypto';

import type { NextRequest } from 'next/server';

import { appendAuditEvent } from '../../../../server/audit';
import { budRouteError, budRouteResponse, readOptionalJson } from '../../../../server/bud-route';
import { readThoonDb, updateThoonDb } from '../../../../server/thoon-db';
import type { AgentChatMessage } from '../../../../types/trading';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const db = readThoonDb();

    return budRouteResponse({
      messages: db.agentChatRecords.filter((message) => message.id.includes('bud-bot-orchestrator')).slice(0, 80),
    });
  } catch (error) {
    return budRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readOptionalJson(request);
    const message = stringValue(body.message, 'Explique la selection du bot.');
    const context = asRecord(body.context);
    const now = new Date().toISOString();
    const userMessage: AgentChatMessage = {
      content: message,
      createdAt: now,
      id: `bud-bot-orchestrator-user-${randomUUID()}`,
      role: 'user',
      status: 'completed',
    };
    const assistantMessage: AgentChatMessage = {
      content: buildBotOrchestratorReply(context),
      createdAt: new Date().toISOString(),
      id: `bud-bot-orchestrator-assistant-${randomUUID()}`,
      role: 'assistant',
      steps: [
        { label: 'Lecture bot', status: 'completed' },
        { label: 'Lecture preuves', status: 'completed' },
        { label: 'Questions bloqueurs', status: 'completed' },
      ],
      status: 'completed',
    };

    const messages = updateThoonDb((db) => {
      db.agentChatRecords = [assistantMessage, userMessage, ...db.agentChatRecords].slice(0, 120);
      appendAuditEvent(db, {
        action: 'Bud bot orchestrator chat',
        actor: 'system',
        botId: stringValue(readPath(context, ['bot', 'id']), undefined),
        details: assistantMessage.content.slice(0, 220),
        eventType: 'bot',
        status: 'success',
        symbol: stringValue(readPath(context, ['bot', 'symbol']) ?? readPath(context, ['session', 'market']), undefined),
      });

      return db.agentChatRecords.filter((item) => item.id.includes('bud-bot-orchestrator')).slice(0, 80);
    });

    return budRouteResponse({ messages, reply: assistantMessage });
  } catch (error) {
    return budRouteError(error);
  }
}

function buildBotOrchestratorReply(context: Record<string, unknown>) {
  const bot = asRecord(readPath(context, ['bot']));
  const session = asRecord(readPath(context, ['session']));
  const strategy = asRecord(readPath(context, ['strategy']));
  const backtest = asRecord(readPath(context, ['backtest']));
  const audit = asArray(readPath(context, ['audit']));
  const blockers = asArray(readPath(session, ['blockers'])).map(String).filter(Boolean);
  const botName = stringValue(readPath(bot, ['name']), 'bot non identifie');
  const strategyName = stringValue(readPath(strategy, ['name']) ?? readPath(bot, ['strategyId']) ?? readPath(session, ['strategyId']), 'strategie non verifiee');
  const selector = asArray(readPath(session, ['notes'])).join(' ').includes('paper-bot-runner') ? 'paper-bot-runner deterministe' : 'Bud launcher ou selection manuelle';
  const reportId = stringValue(readPath(bot, ['sourceBacktestReportId']) ?? readPath(session, ['reportId']), 'rapport non verifie');
  const evidence = [
    `Bot: ${botName}.`,
    `Strategie: ${strategyName}.`,
    `Selection: ${selector}.`,
    `Rapport source: ${reportId}.`,
    `Decision actuelle: ${stringValue(readPath(session, ['botDecision']) ?? readPath(bot, ['status']), 'non verifiee')}.`,
    `Score bot: ${stringValue(readPath(session, ['botScore']), 'non verifie')}.`,
    `Backtest: PF ${stringValue(readPath(backtest, ['profitFactor']), 'non verifie')}, win rate ${stringValue(readPath(backtest, ['winRate']), 'non verifie')}, drawdown ${stringValue(readPath(backtest, ['drawdown']), 'non verifie')}, trades ${stringValue(readPath(backtest, ['totalTrades']), 'non verifie')}.`,
    `Audit: ${audit.length} evenement(s) lies visibles dans le contexte.`,
  ];
  const riskLine = blockers.length ? `Bloqueurs: ${blockers.join(', ')}.` : 'Bloqueurs: aucun bloqueur session attache, mais le live reste bloque tant que les gates hedge fund ne passent pas.';
  const questions = [
    'Quel capital maximal veux-tu autoriser pour ce bot en paper ?',
    'Est-ce que je dois le relancer uniquement sur cette paire ou tester plusieurs paires/timeframes ?',
    'Quel seuil minimum dois-je exiger avant de le garder: profit factor, win rate, drawdown, nombre de trades ?',
  ];

  return [...evidence, riskLine, `Questions: ${questions.join(' ')}`].join('\n');
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

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
