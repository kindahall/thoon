import { getBudPaperState, normalizeBudSymbol, placeBudPaperOrder } from './bud-backend-client';
import { readThoonDb, updateThoonDb } from './thoon-db';
import { visibleStrategyRecords } from '../utils/strategy-catalog';
import type { AuditEvent, BacktestReport, Bot, PaperTestSession, Strategy } from '../types/trading';

type StartPaperBotTestOptions = {
  durationMinutes?: number;
  quantity?: number;
  strategyId?: string;
  symbol?: string;
};

type PaperBotSelection = {
  report?: BacktestReport;
  strategy: Strategy;
};

const paperBotRunnerTag = 'paper-bot-runner';
const finalizers = new Map<string, ReturnType<typeof setTimeout>>();

export async function startBudPaperBotTest(options: StartPaperBotTestOptions = {}, signal?: AbortSignal) {
  const durationMinutes = Math.max(0.001, Math.min(720, Number(options.durationMinutes ?? 120)));
  const quantity = Math.max(0.000001, Math.min(10, Number(options.quantity ?? 0.001)));
  const symbol = normalizeBudSymbol(options.symbol ?? 'BTCUSDT');
  const selection = selectPaperBotStrategy(options.strategyId, symbol);
  const now = new Date();
  const startedAt = now.toISOString();
  const endsAt = new Date(now.getTime() + durationMinutes * 60_000).toISOString();
  const session = buildPaperSession(selection, symbol, startedAt, endsAt, quantity);
  const bot = buildPaperBot(selection, session);

  updateThoonDb((db) => {
    const auditEvent: AuditEvent = {
      action: 'Paper bot test prepared',
      actor: 'system',
      botId: bot.id,
      details: `${session.id} prepared for ${durationMinutes} minutes on ${symbol}.`,
      eventType: 'bot',
      id: `audit-paper-bot-prepared-${Date.now()}`,
      ipAddress: 'server',
      status: 'success',
      symbol,
      time: startedAt,
    };

    db.paperTestSessionRecords = [session, ...db.paperTestSessionRecords.filter((record) => record.id !== session.id)].slice(0, 160);
    db.botRecords = [bot, ...db.botRecords.filter((record) => record.id !== bot.id)].slice(0, 120);
    db.auditLogRecords = [auditEvent, ...db.auditLogRecords].slice(0, 1000);
  });

  try {
    const entryOrder = await placeBudPaperOrder(
      {
        client_order_id: `paper-bot-entry-${Date.now()}`.slice(0, 64),
        quantity,
        side: 'buy',
        symbol,
      },
      signal,
    );
    const state = await getBudPaperState(symbol, signal);
    const runningSession = updatePaperBotSession(session.id, {
      note: `Entry paper buy filled at ${formatMaybeNumber(entryOrder.price)}. Ends at ${endsAt}.`,
      pnl: Number(state.position?.total_pnl ?? 0),
      status: 'running',
      tradeDelta: 1,
    });

    schedulePaperBotFinalizer(runningSession.id, endsAt);

    return {
      bot,
      durationMinutes,
      endsAt,
      entryOrder,
      session: runningSession,
      state,
      status: 'running',
    };
  } catch (error) {
    const blocked = updatePaperBotSession(session.id, {
      blocker: error instanceof Error ? error.message : 'Bud paper order failed',
      note: `Paper bot could not start: ${error instanceof Error ? error.message : 'Bud paper order failed'}`,
      status: 'blocked',
    });

    return {
      bot,
      durationMinutes,
      endsAt,
      error: error instanceof Error ? error.message : 'Bud paper order failed',
      session: blocked,
      status: 'blocked',
    };
  }
}

export async function getBudPaperBotTests(signal?: AbortSignal) {
  await finalizeExpiredPaperBotTests(signal);
  const db = readThoonDb();
  const sessions = db.paperTestSessionRecords.filter((session) => session.notes.some((note) => note.includes(paperBotRunnerTag)));
  for (const session of sessions) {
    if (session.status === 'running' && sessionEndTime(session) > Date.now() && !finalizers.has(session.id)) {
      schedulePaperBotFinalizer(session.id, new Date(sessionEndTime(session)).toISOString());
    }
  }
  const sessionByBotId = new Map(sessions.map((session) => [paperBotIdForSession(session.id), session]));
  const botIds = new Set(sessionByBotId.keys());
  const bots = db.botRecords.filter((bot) => botIds.has(bot.id)).map((bot) => {
    const session = sessionByBotId.get(bot.id);

    return session && (session.status === 'blocked' || session.status === 'completed') ? { ...bot, status: 'stopped' as const } : bot;
  });

  return {
    bots,
    generatedAt: new Date().toISOString(),
    sessions,
    source: 'thoon_paper_bot_runner',
  };
}

export async function finalizeBudPaperBotTest(sessionId: string, signal?: AbortSignal) {
  const db = readThoonDb();
  const session = db.paperTestSessionRecords.find((record) => record.id === sessionId);

  if (!session) {
    throw new Error('Paper bot session not found');
  }

  if (session.status === 'completed' || session.status === 'blocked') {
    return { session, status: session.status };
  }

  const state = await getBudPaperState(session.market, signal);
  const quantity = Math.min(Math.max(0, Number(state.position?.quantity ?? 0)), sessionBotQuantity(session));
  let closeOrder: Record<string, unknown> | undefined;

  if (quantity > 0) {
    closeOrder = await placeBudPaperOrder(
      {
        client_order_id: `paper-bot-exit-${Date.now()}`.slice(0, 64),
        quantity,
        side: 'sell',
        symbol: session.market,
      },
      signal,
    );
  }

  const finalState = await getBudPaperState(session.market, signal);
  const totalPnl = closeOrder ? calculateBotOnlyPnl(session, closeOrder, quantity, finalState) : Number(finalState.position?.total_pnl ?? state.position?.total_pnl ?? 0);
  const tradesRecorded = Math.max(session.tradesRecorded, Number(finalState.trades_count ?? session.tradesRecorded));
  const updated = updatePaperBotSession(session.id, {
    note: `Completed paper bot test with ${tradesRecorded} paper trades and ${totalPnl.toFixed(4)} total PnL.`,
    pnl: totalPnl,
    rMultiple: totalPnl === 0 ? 0 : totalPnl / Math.max(1, Math.abs(Number(finalState.position?.market_price ?? 0)) * 0.001),
    status: 'completed',
    tradesRecorded,
  });

  const timer = finalizers.get(session.id);
  if (timer) {
    clearTimeout(timer);
  }
  finalizers.delete(session.id);

  updateThoonDb((nextDb) => {
    const botId = paperBotIdForSession(session.id);
    const auditEvent: AuditEvent = {
      action: 'Paper bot test completed',
      actor: 'system',
      botId,
      details: `${session.id}: ${tradesRecorded} paper trades, ${totalPnl.toFixed(4)} PnL.`,
      eventType: 'bot',
      id: `audit-paper-bot-completed-${Date.now()}`,
      ipAddress: 'server',
      status: totalPnl >= 0 ? 'success' : 'warning',
      symbol: session.market,
      time: new Date().toISOString(),
    };

    nextDb.botRecords = nextDb.botRecords.map((bot) =>
      bot.id === botId
        ? {
            ...bot,
            pnl: totalPnl,
            status: 'stopped',
            winRate: totalPnl >= 0 ? 100 : 0,
        }
        : bot,
    );
    nextDb.auditLogRecords = [auditEvent, ...nextDb.auditLogRecords].slice(0, 1000);
  });

  return {
    closeOrder,
    finalState,
    session: updated,
    status: 'completed',
  };
}

async function finalizeExpiredPaperBotTests(signal?: AbortSignal) {
  const db = readThoonDb();
  const now = Date.now();
  const expiredSessions = db.paperTestSessionRecords.filter((session) => session.status === 'running' && session.notes.some((note) => note.includes(paperBotRunnerTag)) && sessionEndTime(session) <= now);

  for (const session of expiredSessions) {
    await finalizeBudPaperBotTest(session.id, signal);
  }
}

function schedulePaperBotFinalizer(sessionId: string, endsAt: string) {
  const delayMs = Math.max(0, new Date(endsAt).getTime() - Date.now());
  const currentTimer = finalizers.get(sessionId);
  if (currentTimer) {
    clearTimeout(currentTimer);
  }
  const timer = setTimeout(() => {
    void finalizeBudPaperBotTest(sessionId).catch(() => undefined);
  }, delayMs);
  timer.unref?.();
  finalizers.set(sessionId, timer);
}

function selectPaperBotStrategy(strategyId: string | undefined, symbol: string): PaperBotSelection {
  const db = readThoonDb();
  const strategies = visibleStrategyRecords(db.strategyRecords, db.strategyResearchRecords).filter((strategy) => strategy.status === 'active');
  const reports = db.backtestReportRecords
    .filter((report) => report.source === 'calculated' || report.source === 'agent')
    .slice()
    .sort((left, right) => reportRank(right) - reportRank(left));
  const requested = strategyId ? strategies.find((strategy) => strategy.id === strategyId) : undefined;
  const symbolReport = reports.find((report) => normalizeBudSymbol(report.market ?? '') === symbol);
  const report = requested ? reports.find((item) => item.strategyId === requested.id) : symbolReport ?? reports[0];
  const strategy = requested ?? strategies.find((item) => item.id === report?.strategyId) ?? strategies[0];

  if (!strategy) {
    throw new Error('No active strategy is available for paper bot testing.');
  }

  return { report, strategy };
}

function buildPaperSession(selection: PaperBotSelection, symbol: string, startedAt: string, endsAt: string, quantity: number): PaperTestSession {
  const { report, strategy } = selection;

  return {
    blockers: report?.dataWindow?.candleChecksum ? [] : ['trusted_backtest_checksum_missing'],
    botDecision: report && report.profitFactor >= 1 ? 'bot_candidate' : 'paper_test',
    botScore: report ? Math.round(Math.max(0, Math.min(100, report.profitFactor * 25 + report.winRate * 0.35 - report.drawdown))) : 0,
    candleChecksum: report?.dataWindow?.candleChecksum ?? '',
    createdAt: startedAt,
    dataSource: 'bud-paper-live-market',
    id: `paper-session-${paperBotRunnerTag}-${slug(strategy.id)}-${slug(symbol)}-${Date.now()}`,
    market: symbol,
    notes: [
      `${paperBotRunnerTag}: deterministic 2h paper bot runner.`,
      `ends_at:${endsAt}`,
      `bot_quantity:${quantity}`,
      `Strategy: ${strategy.name}. Report: ${report?.id ?? 'no trusted report'}.`,
    ],
    pnl: 0,
    reportId: report?.id ?? `manual-paper-bot-${Date.now()}`,
    rMultiple: 0,
    status: 'prepared',
    strategyId: strategy.id,
    timeframe: report?.timeframe ?? strategy.timeframe,
    tradesRecorded: 0,
    updatedAt: startedAt,
    usagePlan: [
      'Open one tiny paper position through Bud paper execution.',
      'Hold for exactly the configured session duration.',
      'Close the paper position and compare PnL against the source backtest.',
      'Never promote to live without hedge fund readiness gates.',
    ],
  };
}

function buildPaperBot(selection: PaperBotSelection, session: PaperTestSession): Bot {
  const { report, strategy } = selection;

  return {
    allocatedCapital: Number(((report?.initialCapital ?? 10_000) * 0.01).toFixed(2)),
    exchange: 'Bud Paper',
    id: paperBotIdForSession(session.id),
    maxDrawdown: Math.max(1, report?.drawdown ?? 5),
    mode: 'paper',
    name: `Paper 2h - ${strategy.name}`.slice(0, 90),
    pnl: 0,
    riskPerTrade: Math.min(strategy.riskPerTrade, 1),
    sourceBacktestPeriod: report?.period,
    sourceBacktestReportId: report?.id,
    sourceCandleChecksum: report?.dataWindow?.candleChecksum,
    sourceExchangeId: report?.exchangeId ?? 'binance',
    sourceExchangeName: report?.exchangeName ?? 'Binance',
    sourceExecutionSettings: report?.executionSettings,
    sourceFeesPct: report?.feesPct,
    sourceInitialCapital: report?.initialCapital,
    sourceMarketDataSource: report?.marketDataSource,
    sourceSlippagePct: report?.slippagePct,
    sourceTimeframe: session.timeframe,
    status: 'running',
    strategyId: strategy.id,
    symbol: session.market,
    winRate: 0,
  };
}

function updatePaperBotSession(
  sessionId: string,
  patch: { blocker?: string; note?: string; pnl?: number; rMultiple?: number; status?: PaperTestSession['status']; tradeDelta?: number; tradesRecorded?: number },
) {
  return updateThoonDb((db) => {
    const session = db.paperTestSessionRecords.find((record) => record.id === sessionId);

    if (!session) {
      throw new Error('Paper bot session not found');
    }

    const updated: PaperTestSession = {
      ...session,
      blockers: patch.blocker ? Array.from(new Set([patch.blocker, ...session.blockers])).slice(0, 12) : session.blockers,
      notes: patch.note ? [patch.note, ...session.notes].slice(0, 16) : session.notes,
      pnl: patch.pnl ?? session.pnl,
      rMultiple: patch.rMultiple ?? session.rMultiple,
      status: patch.status ?? session.status,
      tradesRecorded: patch.tradesRecorded ?? session.tradesRecorded + (patch.tradeDelta ?? 0),
      updatedAt: new Date().toISOString(),
    };

    db.paperTestSessionRecords = db.paperTestSessionRecords.map((record) => (record.id === sessionId ? updated : record));

    return updated;
  });
}

function sessionEndTime(session: PaperTestSession) {
  const note = session.notes.find((item) => item.startsWith('ends_at:'));

  return note ? new Date(note.replace('ends_at:', '')).getTime() : new Date(session.updatedAt).getTime();
}

function sessionBotQuantity(session: PaperTestSession) {
  const note = session.notes.find((item) => item.startsWith('bot_quantity:'));
  const parsed = Number(note?.replace('bot_quantity:', ''));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.001;
}

function sessionEntryPrice(session: PaperTestSession) {
  const note = session.notes.find((item) => item.includes('Entry paper buy filled at'));
  const match = note?.match(/Entry paper buy filled at\s+([0-9.]+)/i);
  const parsed = Number(match?.[1]);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function calculateBotOnlyPnl(session: PaperTestSession, closeOrder: Record<string, unknown>, quantity: number, finalState: Awaited<ReturnType<typeof getBudPaperState>>) {
  const entryPrice = sessionEntryPrice(session);
  const closePrice = Number(closeOrder.price);
  const feeRate = Number(finalState.risk_limits?.fee_rate ?? 0.001);

  if (!entryPrice || !Number.isFinite(closePrice) || closePrice <= 0) {
    return Number(closeOrder.realized_pnl_delta ?? finalState.position?.total_pnl ?? 0);
  }

  return (closePrice - entryPrice) * quantity - (entryPrice + closePrice) * quantity * feeRate;
}

function paperBotIdForSession(sessionId: string) {
  return `bot-${slug(sessionId)}`;
}

function reportRank(report: BacktestReport) {
  return report.profitFactor * 30 + report.winRate - report.drawdown + Math.min(report.totalTrades, 100) * 0.2;
}

function formatMaybeNumber(value: unknown) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed.toFixed(4) : 'market';
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}
