import { randomUUID } from 'node:crypto';

import { Wallet as EvmWallet } from 'ethers';
import { NextRequest, NextResponse } from 'next/server';

import { JIMMY_LEGACY_STRATEGY_IDS, JIMMY_STRATEGY_ID } from '../../../config/jimmy-strategy';
import { appendAuditEvent, runWithAuditContext } from '../../../server/audit';
import { runBacktestFromCandles } from '../../../server/backtest-engine';
import {
  clearedSessionCookieOptions,
  createLoginSession,
  getAuthProductionStatus,
  getSessionFromRequest,
  isAuthRequired,
  sessionCookieOptions,
  thoonSessionCookieName,
  verifyPassword,
} from '../../../server/auth';
import { encryptSecret, maskSecret } from '../../../server/crypto';
import { getThoonServerEnv, hasProductionEncryptionKey } from '../../../server/env';
import { executeLiveOrder, fetchLiveAccountSnapshot, verifyLiveApiKey } from '../../../server/exchanges/live-executor';
import { getMetricsSnapshot, incrementMetric, observeApiResponse, logServerEvent } from '../../../server/observability';
import { checkRateLimit, rateLimitHeaders } from '../../../server/rate-limit';
import { getProductionReadiness } from '../../../server/readiness';
import { generateAiStrategySuggestions, getStrategyAgentAiStatus, runCodexAgentChat } from '../../../server/strategy-agent-ai';
import { getKronosIntegrationProfile } from '../../../server/kronos-integration';
import { advanceKronosLearning, getKronosLearningProfile } from '../../../server/kronos-learning';
import { getTradingViewMcpProfile } from '../../../server/tradingview-mcp-integration';
import {
  archiveVersion,
  buildAgentSuggestions,
  compareVersions,
  createAgentJournalNote,
  createAgentReport,
  createDraftBotFromVersion,
  createVariant,
  evaluateAgentAction,
  normalizeAgentSettings,
  promoteVersion,
  updateVersionWithBacktest,
} from '../../../server/strategy-agent';
import { flushPendingPostgresMirror, readThoonDb, updateThoonDb, type SavedSetupRecord, type ThoonDb } from '../../../server/thoon-db';
import { researchTradingViewStrategies } from '../../../server/tradingview-research';
import { getMarketCandles, getMarketDataSnapshot } from '../../../services/market-service';
import type { MarketDataSnapshot, MarketPair, PositionDraft, Timeframe } from '../../../types/market';
import { buildRiskOrderInputFromDraft, evaluateRiskEngine, lossPercentFromPnl } from '../../../services/risk-engine';
import type { AgentAction, AgentChatMessage, AgentQueueTask, AgentReport, AgentRun, Alert, ApiKeyRecord, BacktestExecutionSettings, BacktestReport, Bot, JournalTrade, Order, PaperTestSession, Position, RiskRules, Strategy, StrategyCondition, StrategyResearchRecord, StrategyRiskSettings, TradeLimits, UserPreferences, UserProfile, WalletConnection, Watchlist } from '../../../types/trading';
import { findVisibleStrategyRecord, isExecutableStrategy, strategyIdFromResearchRecord, visibleStrategyRecords as buildVisibleStrategyRecords } from '../../../utils/strategy-catalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

const loginAttempts = new Map<string, { blockedUntil?: number; count: number; firstAttemptAt: number }>();
const agentCronBacktestBatchSize = 24;
const agentCronBacktestPeriod = '30D';
const agentCronInnovationBatchSize = 8;
const agentCronResearchIntervalMs = 30 * 60 * 1000;
const agentCronTargetPairCount = 100;
const agentCronTimeframesPerSweep = 4;
const maximumNumericInput = 1_000_000_000;
const maximumCandleLimit = 1000;

export async function GET(request: NextRequest, context: RouteContext) {
  return handleApiError(request, () => getHandler(request, context));
}

async function getHandler(request: NextRequest, context: RouteContext) {
  const path = await routePath(context);
  const guard = readGuard(request, path);

  if (guard) {
    return guard;
  }

  if (path[0] === 'auth' && path[1] === 'session') {
    const session = getSessionFromRequest(request);

    if (!session && isAuthRequired()) {
      return json({ authenticated: false, auth: getAuthProductionStatus() }, 401);
    }

    return json({ authenticated: Boolean(session), auth: getAuthProductionStatus(), session });
  }

  const db = readThoonDb();

  if (path[0] === 'production' && path[1] === 'readiness') {
    const readiness = await getProductionReadiness();

    return json(readiness, readiness.ok ? 200 : 503);
  }

  if (path[0] === 'observability' && path[1] === 'metrics') {
    return json(getMetricsSnapshot());
  }

  if (path[0] === 'health') {
    return json({
      auth: getAuthProductionStatus(),
      dataFile: getThoonServerEnv().dataFile,
      databaseProvider: getThoonServerEnv().databaseProvider,
      marketDataProvider: getThoonServerEnv().marketDataProvider,
      ok: true,
      resources: resourceIndex,
      updatedAt: db.updatedAt,
    });
  }

  if (path[0] === 'agent' && (path[1] === 'cron' || path[1] === 'progress')) {
    const guard = cronRequestGuard(request, path);

    if (guard) {
      return guard;
    }

    return durableMutation(async () => (path[1] === 'progress' ? agentProgressCron() : agentCron()));
  }

  if (path[0] === 'agent') {
    const strategyId = request.nextUrl.searchParams.get('strategyId') ?? undefined;

    if (path[1] === 'settings') {
      return json(db.agentSettingsRecord);
    }

    if (path[1] === 'ai' && path[2] === 'status') {
      return json(getStrategyAgentAiStatus());
    }

    if (path[1] === 'versions') {
      return json(strategyId ? db.strategyVersionRecords.filter((version) => version.strategyId === strategyId) : db.strategyVersionRecords);
    }

    if (path[1] === 'suggestions') {
      return json(strategyId ? db.agentSuggestionRecords.filter((suggestion) => suggestion.strategyId === strategyId) : db.agentSuggestionRecords);
    }

    if (path[1] === 'activity') {
      return json(strategyId ? db.agentRunRecords.filter((run) => run.strategyId === strategyId) : db.agentRunRecords);
    }

    if (path[1] === 'reports') {
      return json(strategyId ? db.agentReportRecords.filter((report) => report.strategyId === strategyId) : db.agentReportRecords);
    }

    if (path[1] === 'queue') {
      return json(strategyId ? db.agentQueueRecords.filter((task) => task.strategyId === strategyId) : db.agentQueueRecords);
    }

    if (path[1] === 'chat') {
      return json(db.agentChatRecords);
    }

    if (path[1] === 'kronos') {
      return json(getKronosIntegrationProfile());
    }

    if (path[1] === 'kronos-learning') {
      return json({
        profile: getKronosLearningProfile(db.kronosForecastRecords),
        records: db.kronosForecastRecords.slice(0, 80),
      });
    }

    if (path[1] === 'tradingview-mcp') {
      return json(getTradingViewMcpProfile());
    }

    if (path[1] === 'research') {
      return json(strategyId ? db.strategyResearchRecords.filter((record) => record.strategyId === strategyId) : db.strategyResearchRecords);
    }

    return json(agentDashboard(db, strategyId));
  }

  if (path[0] === 'paper-tests') {
    const strategyId = request.nextUrl.searchParams.get('strategyId') ?? undefined;
    const session = path[1] ? db.paperTestSessionRecords.find((record) => record.id === path[1]) : undefined;

    return json(path[1] ? session : strategyId ? db.paperTestSessionRecords.filter((record) => record.strategyId === strategyId) : db.paperTestSessionRecords);
  }

  if (path[0] === 'markets') {
    const snapshot = await getMarketDataSnapshot();

    if (path[1] === 'candles') {
      const symbol = request.nextUrl.searchParams.get('symbol');
      const timeframe = request.nextUrl.searchParams.get('timeframe');
      const exchangeId = request.nextUrl.searchParams.get('exchangeId') ?? 'binance';
      const marketType = marketDataType(request.nextUrl.searchParams.get('marketType'));
      const requestedLimit = normalizeCandleLimit(request.nextUrl.searchParams.get('limit'));

      if (!symbol || !isTimeframe(timeframe)) {
        return json({ error: 'Missing symbol or timeframe' }, 400);
      }

      try {
        return json(await getMarketCandles(symbol, timeframe, exchangeId, requestedLimit, { marketType, strict: marketType !== 'spot' }));
      } catch (error) {
        throw new ApiError(error instanceof Error ? error.message : `${exchangeId} ${marketType} candles unavailable.`, 502);
      }
    }

    if (path[1] === 'status') {
      return json(snapshot.status);
    }

    const symbol = request.nextUrl.searchParams.get('symbol');
    return json(symbol ? snapshot.pairs.find((pair) => pair.symbol === symbol) : snapshot);
  }

  if (path[0] === 'watchlists') {
    return json(db.watchlistRecords);
  }

  if (path[0] === 'alerts') {
    const pair = request.nextUrl.searchParams.get('pair');
    return json(pair ? db.alertRecords.filter((alert) => alert.symbol === pair) : db.alertRecords);
  }

  if (path[0] === 'strategies') {
    const visibleStrategies = buildVisibleStrategyRecords(db.strategyRecords, db.strategyResearchRecords);
    const requestedStrategy = path[1] ? findVisibleStrategyRecord(db.strategyRecords, db.strategyResearchRecords, path[1]) : undefined;

    return json(path[1] ? requestedStrategy : visibleStrategies);
  }

  if (path[0] === 'bots') {
    if (path[1] && path[2] === 'logs') {
      return json(db.botLogRecords.filter((log) => log.botId === path[1]));
    }

    return json(path[1] ? db.botRecords.find((bot) => bot.id === path[1]) : db.botRecords);
  }

  if (path[0] === 'orders') {
    return json({
      fills: db.fillRecords,
      history: db.orderHistoryRecords,
      open: db.openOrderRecords,
      planned: db.plannedOrderRecords,
      positions: db.positionRecords,
    });
  }

  if (path[0] === 'journal') {
    return json(db.journalTradeRecords);
  }

  if (path[0] === 'backtests') {
    return json(db.backtestReportRecords.filter((report) => report.source === 'calculated'));
  }

  if (path[0] === 'preferences') {
    return json({ preferences: db.userPreferencesRecord, profile: db.userProfileRecord });
  }

  if (path[0] === 'profile') {
    return json(db.userProfileRecord);
  }

  if (path[0] === 'risk-rules') {
    return json(db.riskRulesRecord);
  }

  if (path[0] === 'trade-limits') {
    return json(db.tradeLimitsRecord);
  }

  if (path[0] === 'exchanges') {
    if (path[1] === 'api-keys') {
      return json(db.apiKeyRecords);
    }

    return json({ apiKeys: db.apiKeyRecords, exchanges: db.exchangeRecords });
  }

  if (path[0] === 'wallets') {
    return json(db.walletRecords);
  }

  if (path[0] === 'audit-logs') {
    return json(db.auditLogRecords);
  }

  if (path[0] === 'setups') {
    return json(db.savedSetupRecords);
  }

  return notFound(path);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handleApiError(request, () => durableMutation(() => postHandler(request, context)));
}

async function postHandler(request: NextRequest, context: RouteContext) {
  const path = await routePath(context);
  const guard = mutationGuard(request, path);

  if (guard) {
    return guard;
  }

  const body = await readJson(request);

  if (path[0] === 'auth' && path[1] === 'login') {
    return login(request, body);
  }

  if (path[0] === 'auth' && path[1] === 'logout') {
    return logout(request);
  }

  if (path[0] === 'agent' && path[1] === 'actions') {
    return agentAction(body);
  }

  if (path[0] === 'agent' && path[1] === 'chat') {
    return agentChat(body);
  }

  if (path[0] === 'agent' && (path[1] === 'cron' || path[1] === 'progress')) {
    return path[1] === 'progress' ? agentProgressCron() : agentCron();
  }

  if (path[0] === 'bots' && path[1] && path[2] === 'action') {
    const result = updateThoonDb((db) => {
      const bot = db.botRecords.find((item) => item.id === path[1]);

      if (!bot) {
        throw new ApiError('Bot not found', 404);
      }

      const action = normalizeBotAction(body.action);

      if (!action) {
        throw new ApiError('Unknown bot action', 400);
      }

      if (action === 'start') {
        const validationBlocker = getBotLaunchValidationBlocker(db, bot.strategyId, bot.symbol, bot.sourceBacktestReportId);

        if (validationBlocker) {
          appendAuditEvent(db, {
            action: 'Bot start blocked',
            actor: 'system',
            botId: bot.id,
            details: validationBlocker,
            eventType: 'risk',
            exchange: bot.exchange,
            status: 'blocked',
            symbol: bot.symbol,
          });

          return { error: validationBlocker };
        }
      }

      bot.status = action === 'pause' ? 'paused' : action === 'stop' ? 'stopped' : 'running';
      appendAuditEvent(db, {
        action: `Bot ${action || 'updated'}`,
        actor: 'user',
        botId: bot.id,
        details: `${bot.name} status set to ${bot.status}.`,
        eventType: 'bot',
        exchange: bot.exchange,
        status: 'success',
        symbol: bot.symbol,
      });

      return bot;
    });

    return json(result, 'error' in result ? 403 : 200);
  }

  if (path[0] === 'orders' && path[1] === 'close-all') {
    return json(
      updateThoonDb((db) => {
        const now = new Date().toISOString();
        const closedPositions = db.positionRecords;
        const closedRecords = closedPositions.map((position) => {
          const order = positionToCloseOrder(position, now);

          return {
            fill: positionToFill(position, now, order.id),
            order,
            trade: positionToJournalTrade(position, now),
          };
        });
        const closed = closedPositions.length;

        db.orderHistoryRecords = [...closedRecords.map((record) => record.order), ...db.openOrderRecords.map((order) => ({ ...order, status: 'cancelled' as const })), ...db.plannedOrderRecords.map((order) => ({ ...order, status: 'cancelled' as const })), ...db.orderHistoryRecords];
        db.fillRecords = [...closedRecords.map((record) => record.fill), ...db.fillRecords];
        db.journalTradeRecords = [...closedRecords.map((record) => record.trade), ...db.journalTradeRecords];
        db.positionRecords = [];
        db.openOrderRecords = [];
        db.plannedOrderRecords = [];
        appendAuditEvent(db, {
          action: 'Close all positions',
          actor: 'user',
          details: `${closed} positions closed and pending orders cleared.`,
          eventType: 'order',
          exchange: 'Paper',
          status: 'success',
        });

        return {
          closed,
          fills: closedRecords.map((record) => record.fill),
          orders: closedRecords.map((record) => record.order),
          trades: closedRecords.map((record) => record.trade),
        };
      }),
    );
  }

  if (path[0] === 'positions' && path[1] && path[2] === 'close') {
    return json(
      updateThoonDb((db) => {
        const position = db.positionRecords.find((item) => item.id === path[1]);

        if (!position) {
          throw new ApiError('Position not found', 404);
        }

        const now = new Date().toISOString();
        const order = positionToCloseOrder(position, now);
        const fill = positionToFill(position, now, order.id);
        const trade = positionToJournalTrade(position, now);

        db.positionRecords = db.positionRecords.filter((item) => item.id !== position.id);
        db.orderHistoryRecords = [order, ...db.orderHistoryRecords];
        db.fillRecords = [fill, ...db.fillRecords];
        db.journalTradeRecords = [trade, ...db.journalTradeRecords];
        appendAuditEvent(db, {
          action: 'Position closed',
          actor: 'user',
          details: `${position.symbol} ${position.side} closed at ${position.markPrice}.`,
          eventType: 'order',
          exchange: position.exchange,
          status: 'success',
          symbol: position.symbol,
        });

        return { fill, order, position, trade };
      }),
    );
  }

  if (path[0] === 'watchlists') {
    return json(
      updateThoonDb((db) => {
        const action = asString(body.action);
        const listId = asString(body.listId) || 'favorites';
        const symbol = asString(body.symbol);
        const list = db.watchlistRecords.find((item) => item.id === listId);

        if (action === 'create-list') {
          const customCount = db.watchlistRecords.filter((item) => item.type === 'custom').length + 1;
          const name = asString(body.name) || `List ${customCount}`;
          const nextList: Watchlist = {
            alertCount: 0,
            id: `watchlist-${slug(name)}-${Date.now()}`,
            name,
            pairSymbols: [],
            type: 'custom',
            updatedAt: new Date().toISOString(),
          };

          db.watchlistRecords = [...db.watchlistRecords, nextList];
          appendAuditEvent(db, {
            action: 'Watchlist created',
            actor: 'user',
            details: `${nextList.name} created.`,
            eventType: 'system',
            status: 'success',
          });

          return nextList;
        }

        if (action === 'rename-list') {
          if (!list || list.id === 'favorites') {
            throw new ApiError('Only custom watchlists can be renamed', 400);
          }

          const nextName = asString(body.name);

          if (!nextName) {
            throw new ApiError('Watchlist name is required', 400);
          }

          list.name = nextName.slice(0, 80);
          list.updatedAt = new Date().toISOString();
          appendAuditEvent(db, {
            action: 'Watchlist renamed',
            actor: 'user',
            details: `${list.id} renamed to ${list.name}.`,
            eventType: 'system',
            status: 'success',
          });

          return list;
        }

        if (action === 'delete-list') {
          if (!list || list.id === 'favorites') {
            throw new ApiError('Only custom watchlists can be deleted', 400);
          }

          db.watchlistRecords = db.watchlistRecords.filter((item) => item.id !== list.id);
          appendAuditEvent(db, {
            action: 'Watchlist deleted',
            actor: 'user',
            details: `${list.name} deleted.`,
            eventType: 'system',
            status: 'warning',
          });

          return list;
        }

        if (!list || !symbol || (action !== 'add-pair' && action !== 'remove-pair')) {
          throw new ApiError('Missing watchlist or symbol', 400);
        }

        if (action === 'remove-pair') {
          list.pairSymbols = list.pairSymbols.filter((item) => item !== symbol);
        } else if (!list.pairSymbols.includes(symbol)) {
          list.pairSymbols.push(symbol);
        }

        list.updatedAt = new Date().toISOString();
        appendAuditEvent(db, {
          action: action === 'remove-pair' ? 'Watchlist pair removed' : 'Watchlist pair added',
          actor: 'user',
          details: `${symbol} ${action === 'remove-pair' ? 'removed from' : 'added to'} ${list.name}.`,
          eventType: 'system',
          status: 'success',
          symbol,
        });

        return list;
      }),
    );
  }

  if (path[0] === 'alerts') {
    return json(
      updateThoonDb((db) => {
        const alert: Alert = {
          channel: body.channel === 'email' || body.channel === 'webhook' ? body.channel : 'app',
          condition: asString(body.condition) || 'crosses above',
          id: `alert-${slug(asString(body.symbol) || 'market')}-${Date.now()}`,
          status: 'active',
          symbol: asString(body.symbol) || db.marketPairRecords[0].symbol,
          trigger: body.trigger === 'repeat' ? 'repeat' : 'once',
          type: normalizeAlertType(body.type),
          value: asString(body.value) || '0',
        };

        db.alertRecords = [alert, ...db.alertRecords];
        appendAuditEvent(db, {
          action: 'Alert created',
          actor: 'user',
          details: `${alert.type} alert created at ${alert.value}.`,
          eventType: 'system',
          status: 'success',
          symbol: alert.symbol,
        });

        return alert;
      }),
      201,
    );
  }

  if (path[0] === 'strategies') {
    if (path[1] && path[2] === 'duplicate') {
      return json(
        updateThoonDb((db) => {
          const source = findVisibleStrategyRecord(db.strategyRecords, db.strategyResearchRecords, path[1]);

          if (!source) {
            throw new ApiError('Strategy not found', 404);
          }

          const strategy: Strategy = {
            ...source,
            id: `strat-${slug(source.name)}-copy-${Date.now()}`,
            name: `${source.name} Copy`,
            status: 'draft',
            updatedAt: new Date().toISOString(),
          };

          db.strategyRecords = [strategy, ...db.strategyRecords];
          appendAuditEvent(db, {
            action: 'Strategy duplicated',
            actor: 'user',
            details: `${source.name} duplicated into ${strategy.name}.`,
            eventType: 'strategy',
            status: 'success',
            symbol: strategy.market,
          });

          return strategy;
        }),
        201,
      );
    }

    return json(
      updateThoonDb((db) => {
        const strategy: Strategy = {
          entryConditions: normalizeStrategyConditions(body.entryConditions, defaultStrategyConditions('entry')),
          exitConditions: normalizeStrategyConditions(body.exitConditions, defaultStrategyConditions('exit')),
          id: `strat-${slug(asString(body.name) || asString(body.market) || 'custom')}-${Date.now()}`,
          market: asString(body.market) || db.marketPairRecords[0].symbol,
          name: asString(body.name) || 'New Strategy',
          performance30d: 0,
          positionDraft: normalizePositionDraft(body.positionDraft),
          riskPerTrade: asNumber(body.riskPerTrade, db.riskRulesRecord.maxRiskPerTrade),
          riskSettings: normalizeStrategyRiskSettings(body.riskSettings),
          setupSnapshot: normalizeSetupSnapshot(body.setupSnapshot),
          sourceSetupId: asString(body.sourceSetupId) || undefined,
          status: body.status === 'active' || body.status === 'archived' ? body.status : 'draft',
          timeframe: normalizeTimeframe(body.timeframe),
          type: normalizeStrategyType(body.type),
          updatedAt: new Date().toISOString(),
        };

        db.strategyRecords = [strategy, ...db.strategyRecords];
        appendAuditEvent(db, {
          action: 'Strategy created',
          actor: 'user',
          details: `${strategy.name} created from builder.`,
          eventType: 'strategy',
          status: 'success',
          symbol: strategy.market,
        });

        return strategy;
      }),
      201,
    );
  }

  if (path[0] === 'bots') {
    const requestedMode = body.mode === 'live' ? 'live' : 'paper';
    const requestedStatus = body.status === 'running' || body.status === 'paused' || body.status === 'stopped' ? body.status : 'draft';

    if (requestedMode === 'live' && requestedStatus === 'running' && !isLiveExecutionEnabled()) {
      return json(
        updateThoonDb((db) => {
          appendAuditEvent(db, {
            action: 'Live bot blocked',
            actor: 'system',
            details: 'Live bot launch blocked because live execution readiness is incomplete.',
            eventType: 'risk',
            exchange: asString(body.exchange) || 'Live',
            status: 'blocked',
            symbol: asString(body.symbol) || db.marketPairRecords[0].symbol,
          });

          return { error: 'Live execution is disabled. Set THOON_APP_MODE=live-enabled only after connecting a real exchange executor.' };
        }),
        403,
      );
    }

    const result = updateThoonDb((db) => {
      const botStrategyId = normalizeStrategyId(asString(body.strategyId) || db.strategyRecords[0]?.id || 'manual', db);
      const botSymbol = asString(body.symbol) || db.marketPairRecords[0].symbol;
      const requestedSourceReportId = asString(body.sourceBacktestReportId);
      const sourceReport = requestedSourceReportId ? resolveBotSourceReport(db, botStrategyId, botSymbol, requestedSourceReportId) : undefined;

      if (requestedSourceReportId && !sourceReport) {
        return { error: 'Bot source report blocked: the selected backtest does not match this exact strategy and pair.' };
      }

      const validationBlocker = requestedStatus === 'running' ? getBotLaunchValidationBlocker(db, botStrategyId, botSymbol, sourceReport?.id) : undefined;

      if (validationBlocker) {
        appendAuditEvent(db, {
          action: 'Bot launch blocked',
          actor: 'system',
          details: validationBlocker,
          eventType: 'risk',
          exchange: asString(body.exchange) || 'Paper',
          status: 'blocked',
          symbol: botSymbol,
        });

        return { error: validationBlocker };
      }

      const liveBotBlocker =
        requestedMode === 'live' && requestedStatus === 'running' ? getLiveTradingBlocker(db, asString(body.exchange) || 'Live') : undefined;

      if (liveBotBlocker) {
        appendAuditEvent(db, {
          action: 'Live bot blocked',
          actor: 'system',
          details: liveBotBlocker,
          eventType: 'risk',
          exchange: asString(body.exchange) || 'Live',
          status: 'blocked',
          symbol: asString(body.symbol) || db.marketPairRecords[0].symbol,
        });

        return { error: liveBotBlocker };
      }

        const bot: Bot = {
          allocatedCapital: asNumber(body.allocatedCapital, 10000),
          exchange: asString(body.exchange) || 'Paper',
          id: `bot-${slug(asString(body.name) || asString(body.symbol) || 'custom')}-${Date.now()}`,
          maxDrawdown: 0,
          mode: requestedMode,
          name: asString(body.name) || 'New Bot',
          pnl: 0,
          riskPerTrade: asNumber(body.riskPerTrade, db.riskRulesRecord.maxRiskPerTrade),
          sourceBacktestPeriod: sourceReport?.period,
          sourceBacktestReportId: sourceReport?.id,
          sourceCandleChecksum: sourceReport?.dataWindow?.candleChecksum,
          sourceExchangeId: sourceReport?.exchangeId,
          sourceExchangeName: sourceReport?.exchangeName,
          sourceExecutionSettings: sourceReport?.executionSettings,
          sourceFeesPct: sourceReport?.feesPct,
          sourceInitialCapital: sourceReport?.initialCapital,
          sourceMarketDataSource: sourceReport?.marketDataSource,
          sourceSlippagePct: sourceReport?.slippagePct,
          sourceTimeframe: sourceReport?.timeframe,
          status: requestedStatus,
          strategyId: botStrategyId,
          symbol: botSymbol,
          winRate: 0,
        };

        db.botRecords = [bot, ...db.botRecords];
        db.botLogRecords = [
          {
            botId: bot.id,
            id: `blog-${Date.now()}`,
            level: bot.status === 'running' ? 'info' : 'warning',
            message: bot.status === 'running' ? 'Bot launched after risk checks.' : 'Bot draft saved.',
            time: new Date().toISOString(),
          },
          ...db.botLogRecords,
        ];
        appendAuditEvent(db, {
          action: bot.status === 'running' ? 'Bot started' : 'Bot draft saved',
          actor: 'user',
          botId: bot.id,
          details: `${bot.name} saved in ${bot.mode} mode.`,
          eventType: 'bot',
          exchange: bot.exchange,
          status: 'success',
          symbol: bot.symbol,
        });

        return bot;
      });

    return json(result, 'error' in result ? 403 : 201);
  }

  if (path[0] === 'orders') {
    return json(
      updateThoonDb((db) => {
        const order = normalizeOrder(body, db.marketPairRecords[0].symbol);
        db.plannedOrderRecords = [order, ...db.plannedOrderRecords];
        appendAuditEvent(db, {
          action: 'Order planned',
          actor: 'user',
          details: `${order.type} ${order.side} order planned at ${order.price}.`,
          eventType: 'order',
          exchange: order.exchange,
          status: 'success',
          symbol: order.symbol,
        });

        return order;
      }),
      201,
    );
  }

  if (path[0] === 'trading' && path[1] === 'execute') {
    const requestedMode = body.mode === 'live' ? 'live' : 'paper';

    if (requestedMode === 'live' && !isLiveExecutionEnabled()) {
      incrementMetric('liveOrdersBlocked');

      return json(
        updateThoonDb((db) => {
          const symbol = asString(body.symbol) || db.marketPairRecords[0].symbol;

          appendAuditEvent(db, {
            action: 'Live order blocked',
            actor: 'system',
            details: 'Live order blocked because live execution readiness is incomplete.',
            eventType: 'risk',
            exchange: asString(body.exchangeName) || 'Live',
            status: 'blocked',
            symbol,
          });

          return { allowed: false, error: 'Live execution is disabled until auth, Postgres, production encryption and a live exchange provider are configured.' };
        }),
        403,
      );
    }

    const db = readThoonDb();
    const mode = requestedMode;
    const draft = body.draft as { direction?: 'long' | 'short'; entry?: number; riskPercent?: number; size?: number; stopLoss?: number; takeProfit?: number };
    const symbol = asString(body.symbol) || db.marketPairRecords[0].symbol;
    const leverage = asNumber(body.leverage, db.userPreferencesRecord.defaultLeverage);
    const executionSource = body.executionSource === 'strategy' ? 'strategy' : 'manual';
    const requestedStrategyId = asString(body.strategyId);
    const requestedStrategyName = asString(body.strategyName);
    const executionStrategy = requestedStrategyId ? findVisibleStrategyRecord(db.strategyRecords, db.strategyResearchRecords, requestedStrategyId) : undefined;
    const requestedExchangeId = asString(body.exchangeId);
    const requestedExchangeName = asString(body.exchangeName);
    const exchange =
      db.exchangeRecords.find((item) => item.id === requestedExchangeId) ??
      db.exchangeRecords.find((item) => item.name === requestedExchangeName) ??
      db.exchangeRecords.find((item) => item.name === db.userPreferencesRecord.defaultExchange) ??
      db.exchangeRecords[0];
    const liveApiKey = mode === 'live' ? getActiveTradeApiKey(db, exchange) : undefined;
    const liveSecret = liveApiKey ? db.apiKeySecrets[liveApiKey.id] : undefined;
    let liveAccountSnapshot:
      | {
          accountBalance: number;
          availableBalance: number;
        }
      | undefined;

    if (executionSource === 'strategy') {
      if (!executionStrategy) {
        throw new ApiError('A strategy trade requires a valid strategy.', 400);
      }

      if (executionStrategy.market !== symbol) {
        throw new ApiError(`${executionStrategy.name} targets ${executionStrategy.market}; switch the chart pair before execution.`, 400);
      }
    }

    if (mode === 'live') {
      if (!exchange || !liveApiKey || !liveSecret) {
        incrementMetric('liveOrdersBlocked');

        return json(
          updateThoonDb((nextDb) => {
            appendAuditEvent(nextDb, {
              action: 'Live order blocked',
              actor: 'system',
              details: 'No active trade-enabled API key is available for the selected exchange.',
              eventType: 'api',
              exchange: exchange?.name ?? 'Live',
              status: 'blocked',
              symbol,
            });

            return { allowed: false, error: 'No active trade-enabled API key is available for the selected exchange.' };
          }),
          403,
        );
      }

      try {
        liveAccountSnapshot = await fetchLiveAccountSnapshot({ apiKey: liveApiKey, exchange, secret: liveSecret });
      } catch (error) {
        incrementMetric('apiErrors');

        return json(
          updateThoonDb((nextDb) => {
            appendAuditEvent(nextDb, {
              action: 'Live order blocked',
              actor: 'system',
              details: error instanceof Error ? error.message : 'Live account snapshot failed.',
              eventType: 'api',
              exchange: exchange.name,
              status: 'blocked',
              symbol,
            });

            return { allowed: false, error: 'Live account balance could not be verified before risk checks.' };
          }),
          502,
        );
      }
    }

    const accountBalance = liveAccountSnapshot?.accountBalance ?? 25000;
    const availableBalance = liveAccountSnapshot?.availableBalance ?? accountBalance;
    const riskResult = evaluateRiskEngine({
      action: 'execute-trade',
      exchange,
      mode,
      order: buildRiskOrderInputFromDraft({
        accountBalance,
        availableBalance,
        dailyLossPercent: liveAccountSnapshot ? lossPercentFromPnl(periodPnl(db, 'day'), accountBalance) : 0,
        draft: {
          direction: draft.direction ?? 'long',
          entry: asNumber(draft.entry, 0),
          riskPercent: asNumber(draft.riskPercent, db.riskRulesRecord.maxRiskPerTrade),
          size: asNumber(draft.size, 0),
          stopLoss: asNumber(draft.stopLoss, 0),
          takeProfit: asNumber(draft.takeProfit, 0),
        },
        leverage,
        marginRequired: (asNumber(draft.entry, 0) * asNumber(draft.size, 0)) / Math.max(leverage, 1),
        openPositions: db.positionRecords.length,
        ordersToday: db.openOrderRecords.length + db.plannedOrderRecords.length,
        weeklyLossPercent: liveAccountSnapshot ? lossPercentFromPnl(periodPnl(db, 'week'), accountBalance) : 0,
      }),
      riskRules: db.riskRulesRecord,
      tradeLimits: db.tradeLimitsRecord,
    });

    if (!riskResult.allowed) {
      incrementMetric('riskBlocks');

      return json(
        updateThoonDb((nextDb) => {
          appendAuditEvent(nextDb, {
            action: 'Order blocked',
            actor: 'system',
            details: riskResult.suggestedCorrection,
            eventType: 'risk',
            exchange: exchange?.name ?? 'Paper',
            status: 'blocked',
            symbol,
          });

          return { allowed: false, riskResult };
        }),
      );
    }

    const order: Order = {
      createdAt: new Date().toISOString(),
      exchange: mode === 'paper' ? 'Paper' : exchange?.name ?? 'Live',
      executionSource,
      id: `ord-${slug(symbol)}-${Date.now()}`,
      price: asNumber(draft.entry, 0),
      reduceOnly: false,
      side: draft.direction === 'short' ? 'sell' : 'buy',
      size: asNumber(draft.size, 0),
      status: mode === 'paper' ? 'filled' : 'open',
      strategyId: executionStrategy?.id,
      strategyName: executionStrategy?.name ?? (requestedStrategyName || undefined),
      symbol,
      type: 'limit',
    };
    let liveResult: Awaited<ReturnType<typeof executeLiveOrder>> | undefined;

    if (mode === 'live') {
      const apiKey = liveApiKey;
      const secret = liveSecret;

      if (!exchange || !apiKey || !secret) {
        incrementMetric('liveOrdersBlocked');

        return json(
          updateThoonDb((nextDb) => {
            appendAuditEvent(nextDb, {
              action: 'Live order blocked',
              actor: 'system',
              details: 'No active trade-enabled API key is available for the selected exchange.',
              eventType: 'api',
              exchange: exchange?.name ?? 'Live',
              status: 'blocked',
              symbol,
            });

            return { allowed: false, error: 'No active trade-enabled API key is available for the selected exchange.', riskResult };
          }),
          403,
        );
      }

      try {
        liveResult = await executeLiveOrder({ apiKey, exchange, order, secret });
        incrementMetric('liveOrdersSent');
      } catch (error) {
        incrementMetric('apiErrors');

        return json(
          updateThoonDb((nextDb) => {
            appendAuditEvent(nextDb, {
              action: 'Live order failed',
              actor: 'system',
              details: error instanceof Error ? error.message : 'Live exchange request failed.',
              eventType: 'api',
              exchange: exchange.name,
              status: 'failed',
              symbol,
            });

            return { allowed: false, error: error instanceof Error ? error.message : 'Live exchange request failed.', riskResult };
          }),
          502,
        );
      }
    }

    return json(
      updateThoonDb((nextDb) => {
        if (mode === 'paper') {
          nextDb.orderHistoryRecords = [order, ...nextDb.orderHistoryRecords];
          nextDb.fillRecords = [
            {
              fee: Math.abs(order.price * order.size * 0.0004),
              id: `fill-${slug(symbol)}-${Date.now()}`,
              orderId: order.id,
              price: order.price,
              side: order.side,
              size: order.size,
              symbol,
              time: new Date().toISOString(),
            },
            ...nextDb.fillRecords,
          ];
        } else {
          nextDb.openOrderRecords = [order, ...nextDb.openOrderRecords];
        }

        appendAuditEvent(nextDb, {
          action: mode === 'paper' ? 'Paper order executed' : 'Live order sent',
          actor: 'user',
          details: liveResult?.exchangeOrderId
            ? `${order.side} ${symbol} sent from ${executionSource}${order.strategyName ? ` (${order.strategyName})` : ''}. Exchange order ${liveResult.exchangeOrderId}.`
            : `${order.side} ${symbol} from ${executionSource}${order.strategyName ? ` (${order.strategyName})` : ''} at ${order.price}.`,
          eventType: 'order',
          exchange: order.exchange,
          status: 'success',
          symbol,
        });

        return { allowed: true, liveResult, order, riskResult };
      }),
    );
  }

  if (path[0] === 'backtests') {
    const db = readThoonDb();
    const strategyId = normalizeStrategyId(asString(body.strategyId) || db.strategyRecords[0]?.id || 'manual', db);
    const strategy = findVisibleStrategyRecord(db.strategyRecords, db.strategyResearchRecords, strategyId);

    if (!strategy) {
      return json({ error: 'Strategy not found.' }, 404);
    }

    if (!isExecutableBacktestStrategy(strategy)) {
      return json(
        {
          error: `${strategy.name} does not have a real executable backtest engine yet. The run was blocked instead of showing synthetic results.`,
          details: strategy.agentSource?.sourceId.startsWith('tradingview:')
            ? 'This TradingView item is a public research candidate. It is visible in Strategies and Backtest, but it needs a real Pine-to-engine implementation before Thoon can calculate results.'
            : 'Only jimmy and agent strategies explicitly linked to the protected jimmy Pine source can currently run through the candle engine.',
        },
        422,
      );
    }

    const period = asString(body.period) || '90D';
    const symbol = asString(body.symbol) || strategy.market;
    const timeframe = isTimeframe(body.timeframe) ? body.timeframe : strategy.timeframe;
    const exchangeId = asString(body.exchangeId) || 'binance';
    const exchange = db.exchangeRecords.find((record) => record.id === exchangeId);
    const executionSettings = normalizeBacktestExecutionSettings(body.executionSettings, strategy);
    let candles;

    try {
      candles = await getMarketCandles(symbol, timeframe, exchangeId, desiredBacktestCandleLimit(period, timeframe), { marketType: executionSettings.marketType, strict: true });
    } catch (error) {
      return json(
        {
          error: `${exchange?.name ?? exchangeId} live candles unavailable for ${symbol} ${timeframe}. Backtest was not saved because fallback/local candles are forbidden.`,
          details: error instanceof Error ? error.message : 'Unknown candle fetch error.',
        },
        502,
      );
    }
    if (candles.length < 40) {
      return json({ error: `${exchange?.name ?? exchangeId} did not return enough candles for ${symbol} ${timeframe}.` }, 502);
    }

    const report = runBacktestFromCandles({
      candles,
      exchangeId,
      exchangeName: exchange?.name ?? exchangeId,
      executionSettings,
      feesPct: positiveValue(body.fees, 0.06),
      initialCapital: positiveValue(body.initialCapital, 10000),
      marketDataSource: exchangeId === 'binance' ? 'binance-live' : `${exchangeId}-public-rest`,
      period,
      slippagePct: positiveValue(body.slippage, 0.02),
      strategy,
      symbol,
      timeframe,
    });

    return json(
      updateThoonDb((db) => {
        const kronosLearning = advanceKronosLearning({
          candles,
          market: symbol,
          records: db.kronosForecastRecords,
          strategyId: strategy.id,
          timeframe,
        });
        db.backtestReportRecords = [report, ...db.backtestReportRecords].slice(0, 80);
        db.kronosForecastRecords = kronosLearning.records;
        appendAuditEvent(db, {
          action: 'Backtest run',
          actor: 'user',
          details: `${report.period} calculated backtest saved for ${strategyId} on ${report.exchangeName ?? exchangeId} using ${report.candleCount} candles. Kronos learning: ${kronosLearning.created ? 'forecast created' : 'no new forecast'}, ${kronosLearning.evaluatedCount} evaluated.`,
          eventType: 'strategy',
          status: 'success',
          symbol,
        });

        return report;
      }),
      201,
    );
  }

  if (path[0] === 'journal') {
    return json(
      updateThoonDb((db) => {
        const trade: JournalTrade = {
          closedAt: new Date().toISOString(),
          id: `trade-${Date.now()}`,
          lessons: asString(body.lessons) || '',
          notes: asString(body.notes) || '',
          pnl: asNumber(body.pnl, 0),
          rMultiple: asNumber(body.rMultiple, 0),
          side: body.side === 'short' ? 'short' : 'long',
          source: body.source === 'bot' || body.source === 'paper' ? body.source : 'manual',
          symbol: asString(body.symbol) || db.marketPairRecords[0].symbol,
          tag: asString(body.tag) || 'manual',
        };

        db.journalTradeRecords = [trade, ...db.journalTradeRecords];
        return trade;
      }),
      201,
    );
  }

  if (path[0] === 'notifications' && path[1] === 'test') {
    return json(
      updateThoonDb((db) => {
        const channel = asString(body.channel) || 'App Notification';

        appendAuditEvent(db, {
          action: 'Notification test sent',
          actor: 'system',
          details: `${channel} test queued locally.`,
          eventType: 'system',
          status: 'success',
        });

        return { channel, ok: true, sentAt: new Date().toISOString() };
      }),
    );
  }

  if (path[0] === 'privacy' && path[1] === 'export') {
    return json(
      updateThoonDb((db) => {
        appendAuditEvent(db, {
          action: 'Privacy export generated',
          actor: 'user',
          details: 'Local privacy export payload generated.',
          eventType: 'system',
          status: 'success',
        });

        return {
          auditLogs: db.auditLogRecords,
          generatedAt: new Date().toISOString(),
          profile: db.userProfileRecord,
          settings: db.userPreferencesRecord,
        };
      }),
    );
  }

  if (path[0] === 'security' && path[1] === 'action') {
    return json(
      updateThoonDb((db) => {
        const action = asString(body.action) || 'security-action';

        appendAuditEvent(db, {
          action: 'Security action confirmed',
          actor: 'user',
          details: `${action} confirmed in local security workflow.`,
          eventType: 'system',
          status: action.includes('delete') || action.includes('deactivate') ? 'warning' : 'success',
        });

        return { action, confirmedAt: new Date().toISOString(), ok: true };
      }),
    );
  }

  if (path[0] === 'system' && path[1] === 'cache' && path[2] === 'clear') {
    return json(
      updateThoonDb((db) => {
        appendAuditEvent(db, {
          action: 'Local cache cleared',
          actor: 'user',
          details: 'Advanced settings requested a local cache clear.',
          eventType: 'system',
          status: 'success',
        });

        return { clearedAt: new Date().toISOString(), ok: true };
      }),
    );
  }

  if (path[0] === 'system' && path[1] === 'reset-local-data') {
    return json(
      updateThoonDb((db) => {
        db.savedSetupRecords = [];
        appendAuditEvent(db, {
          action: 'Local data reset',
          actor: 'user',
          details: 'Local chart setups and temporary advanced settings were reset.',
          eventType: 'system',
          status: 'warning',
        });

        return { ok: true, resetAt: new Date().toISOString() };
      }),
    );
  }

  if (path[0] === 'wallets') {
    return json(
      updateThoonDb((db) => {
        const action = asString(body.action) || 'connect-wallet';
        const now = new Date().toISOString();
        const preferredExchangeId = asString(body.exchangeId) || undefined;
        const preferredExchange = preferredExchangeId ? db.exchangeRecords.find((exchange) => exchange.id === preferredExchangeId) : undefined;

        if (preferredExchangeId && !preferredExchange) {
          throw new ApiError('Preferred DEX not found.', 404);
        }

        if (action === 'create-wallet') {
          const env = getThoonServerEnv();
          const chain = normalizeWalletChain(body.chain);

          if (chain !== 'evm') {
            throw new ApiError('Internal wallet creation currently supports EVM only. Connect an existing Solana or Cosmos wallet by public address.', 422);
          }

          if (!hasProductionEncryptionKey(env.encryptionKey)) {
            throw new ApiError('Set a unique THOON_ENCRYPTION_KEY of at least 32 characters before creating an internal wallet.', 500);
          }

          if (!isAuthRequired()) {
            throw new ApiError('Enable THOON_AUTH_MODE=local-required before creating an internal wallet.', 403);
          }

          const evmWallet = EvmWallet.createRandom();
          const label = asString(body.label) || 'Thoon EVM wallet';
          const record: WalletConnection = {
            address: evmWallet.address,
            chain,
            connector: 'internal-vault',
            createdAt: now,
            id: `wallet-${slug(label)}-${Date.now()}`,
            label,
            networks: normalizeWalletNetworks(body.networks, body.network),
            preferredExchangeId,
            status: 'connected',
          };

          db.walletRecords = [record, ...db.walletRecords].slice(0, 24);
          db.walletSecrets[record.id] = {
            encryptedMnemonic: evmWallet.mnemonic?.phrase ? encryptSecret(evmWallet.mnemonic.phrase, env.encryptionKey) : undefined,
            encryptedPrivateKey: encryptSecret(evmWallet.privateKey, env.encryptionKey),
          };

          if (preferredExchange?.venueType === 'dex') {
            preferredExchange.status = 'connected';
            preferredExchange.permissions = preferredExchange.permissions.includes('read') ? preferredExchange.permissions : ['read', ...preferredExchange.permissions];
          }

          appendAuditEvent(db, {
            action: 'Internal wallet created',
            actor: 'user',
            details: 'EVM wallet created server-side. Private key and mnemonic were encrypted and never returned to the client.',
            eventType: 'api',
            exchange: preferredExchange?.name,
            status: 'success',
          });

          return record;
        }

        const address = asString(body.address);
        const chain = normalizeWalletChain(body.chain);

        if (!isLikelyWalletAddress(address, chain)) {
          throw new ApiError('A valid public wallet address is required for this chain.', 400);
        }

        const label = asString(body.label) || `${chain.toUpperCase()} wallet`;
        const existingIndex = db.walletRecords.findIndex((wallet) => wallet.address?.toLowerCase() === address.toLowerCase());
        const record: WalletConnection = {
          address,
          chain,
          connector: 'external-wallet',
          createdAt: existingIndex >= 0 ? db.walletRecords[existingIndex].createdAt : now,
          id: existingIndex >= 0 ? db.walletRecords[existingIndex].id : `wallet-${slug(label)}-${Date.now()}`,
          label,
          networks: normalizeWalletNetworks(body.networks, body.network),
          preferredExchangeId,
          status: 'connected',
        };

        if (existingIndex >= 0) {
          db.walletRecords[existingIndex] = record;
        } else {
          db.walletRecords = [record, ...db.walletRecords].slice(0, 24);
        }

        if (preferredExchange?.venueType === 'dex') {
          preferredExchange.status = 'connected';
          preferredExchange.permissions = preferredExchange.permissions.includes('read') ? preferredExchange.permissions : ['read', ...preferredExchange.permissions];
        }

        appendAuditEvent(db, {
          action: 'Wallet connected',
          actor: 'user',
          details: `${label} connected with a public address only. Signing still requires the wallet at execution time.`,
          eventType: 'api',
          exchange: preferredExchange?.name,
          status: 'success',
        });

        return record;
      }),
      201,
    );
  }

  if (path[0] === 'exchanges' && path[1] === 'api-keys') {
    const env = getThoonServerEnv();

    if (!hasProductionEncryptionKey(env.encryptionKey)) {
      return json({ error: 'Set a unique THOON_ENCRYPTION_KEY of at least 32 characters before storing exchange API keys.' }, 500);
    }

    if (!isAuthRequired()) {
      return json({ error: 'Enable THOON_AUTH_MODE=local-required before storing exchange API keys.' }, 403);
    }

    return json(
      updateThoonDb((db) => {
        const exchangeId = asString(body.exchangeId);
        const apiKey = asString(body.apiKey);
        const apiSecret = asString(body.apiSecret);
        const exchange = db.exchangeRecords.find((item) => item.id === exchangeId);

        if (!exchange || !apiKey) {
          throw new ApiError('Missing exchange or API key', 400);
        }

        const permissions = normalizePermissions(body.permissions);
        const record: ApiKeyRecord = {
          createdAt: new Date().toISOString(),
          exchangeId,
          id: `api-${exchangeId}-${Date.now()}`,
          ipWhitelist: Array.isArray(body.ipWhitelist) ? body.ipWhitelist.map(String) : [],
          label: asString(body.label) || `${exchange.name} API`,
          maskedKey: maskSecret(apiKey, exchangeId.slice(0, 3)),
          permissions,
          status: 'testing',
        };

        db.apiKeyRecords = [record, ...db.apiKeyRecords];
        db.apiKeySecrets[record.id] = {
          encryptedKey: encryptSecret(apiKey, env.encryptionKey),
          encryptedSecret: apiSecret ? encryptSecret(apiSecret, env.encryptionKey) : undefined,
        };
        exchange.status = 'connected';
        exchange.permissions = permissions;

        appendAuditEvent(db, {
          action: 'API key created',
          actor: 'user',
          details: `${exchange.name} key stored encrypted. Withdrawals remain disabled.`,
          eventType: 'api',
          exchange: exchange.name,
          status: 'success',
        });

        return record;
      }),
      201,
    );
  }

  if (path[0] === 'exchanges' && path[1] === 'test') {
    const db = readThoonDb();
    const exchangeId = asString(body.exchangeId);
    const exchange = db.exchangeRecords.find((item) => item.id === exchangeId);

    if (!exchange) {
      throw new ApiError('Exchange not found', 404);
    }

    const testingKeys = db.apiKeyRecords.filter((keyRecord) => keyRecord.exchangeId === exchange.id && keyRecord.status === 'testing');
    const verifiedKeyIds = new Set<string>();
    let liveNetworkChecked = false;
    let verificationError: string | undefined;

    if (getThoonServerEnv().liveExchangeProvider === 'binance' && exchange.id === 'binance') {
      for (const keyRecord of testingKeys) {
        const secret = db.apiKeySecrets[keyRecord.id];

        if (secret?.encryptedKey && secret.encryptedSecret) {
          try {
            await verifyLiveApiKey({ apiKey: keyRecord, exchange, secret });
            verifiedKeyIds.add(keyRecord.id);
            liveNetworkChecked = true;
          } catch (error) {
            verificationError = error instanceof Error ? error.message : 'Live credential test failed.';
          }
        }
      }
    }

    return json(
      updateThoonDb((nextDb) => {
        let activatedKeys = 0;

        nextDb.apiKeyRecords = nextDb.apiKeyRecords.map((keyRecord) => {
          if (!verifiedKeyIds.has(keyRecord.id)) {
            return keyRecord;
          }

          activatedKeys += 1;
          return { ...keyRecord, status: 'active' };
        });

        appendAuditEvent(nextDb, {
          action: 'API key tested',
          actor: 'system',
          details:
            activatedKeys > 0
              ? `${exchange.name} key activated after live signed account check.`
              : verificationError
                ? `${exchange.name} key was not activated because the live signed account check failed.`
                : `${exchange.name} key was not activated because no live signed account check completed.`,
          eventType: 'api',
          exchange: exchange.name,
          status: activatedKeys > 0 ? 'success' : 'blocked',
        });

        return {
          activatedKeys,
          exchange: nextDb.exchangeRecords.find((item) => item.id === exchangeId) ?? exchange,
          error: verificationError ? 'Live credential test failed.' : undefined,
          liveNetworkChecked,
          ok: activatedKeys > 0,
        };
      }),
    );
  }

  if (path[0] === 'setups') {
    return json(
      updateThoonDb((db) => {
        const setup = body as SavedSetupRecord;
        const record: SavedSetupRecord = {
          chartHeight: asNumber(setup.chartHeight, 640),
          draft: setup.draft ?? {},
          drawings: Array.isArray(setup.drawings) ? setup.drawings : [],
          exchangeId: asString(setup.exchangeId),
          executionIntent: setup.executionIntent === 'strategy' ? 'strategy' : 'manual',
          id: asString(setup.id) || `setup-${Date.now()}`,
          indicators: setup.indicators ?? {},
          markers: Array.isArray(setup.markers) ? setup.markers : [],
          name: asString(setup.name) || 'Saved setup',
          notes: asString(setup.notes),
          pair: asString(setup.pair) || db.marketPairRecords[0].symbol,
          plannedOrders: Array.isArray(setup.plannedOrders) ? setup.plannedOrders : [],
          riskSettings: setup.riskSettings ?? {},
          savedAt: asString(setup.savedAt) || new Date().toISOString(),
          selectedRange: asString(setup.selectedRange) || '1D',
          strategyId: asString(setup.strategyId) || undefined,
          timeframe: asString(setup.timeframe) || '15m',
        };

        db.savedSetupRecords = [record, ...db.savedSetupRecords.filter((item) => item.id !== record.id)].slice(0, 30);
        appendAuditEvent(db, {
          action: 'Chart setup saved',
          actor: 'user',
          details: `${record.name} saved from Charts.`,
          eventType: 'system',
          status: 'success',
          symbol: record.pair,
        });

        return record;
      }),
      201,
    );
  }

  return notFound(path);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handleApiError(request, () => durableMutation(() => patchHandler(request, context)));
}

async function patchHandler(request: NextRequest, context: RouteContext) {
  const path = await routePath(context);
  const guard = mutationGuard(request, path);

  if (guard) {
    return guard;
  }

  const body = await readJson(request);

  if (path[0] === 'agent' && path[1] === 'settings') {
    return json(
      updateThoonDb((db) => {
        db.agentSettingsRecord = normalizeAgentSettings(body);
        appendAuditEvent(db, {
          action: 'Strategy Agent settings updated',
          actor: 'user',
          details: `Mode set to ${db.agentSettingsRecord.mode}.`,
          eventType: 'system',
          status: 'success',
        });

        return db.agentSettingsRecord;
      }),
    );
  }

  if (path[0] === 'paper-tests' && path[1]) {
    return json(
      updateThoonDb((db) => {
        const session = db.paperTestSessionRecords.find((record) => record.id === path[1]);

        if (!session) {
          throw new ApiError('Paper test session not found', 404);
        }

        const status = body.status === 'completed' || body.status === 'running' || body.status === 'blocked' || body.status === 'prepared' ? body.status : session.status;
        const tradeDelta = Math.max(0, Math.floor(asNumber(body.tradeDelta, 0)));
        const pnlDelta = asNumber(body.pnlDelta, 0);
        const rMultipleDelta = asNumber(body.rMultipleDelta, 0);
        const note = asString(body.note);
        const nextSession: PaperTestSession = {
          ...session,
          notes: note ? [note, ...session.notes].slice(0, 12) : session.notes,
          pnl: session.pnl + pnlDelta,
          rMultiple: session.rMultiple + rMultipleDelta,
          status,
          tradesRecorded: session.tradesRecorded + tradeDelta,
          updatedAt: new Date().toISOString(),
        };

        db.paperTestSessionRecords = db.paperTestSessionRecords.map((record) => (record.id === nextSession.id ? nextSession : record));
        appendAuditEvent(db, {
          action: 'Paper test session updated',
          actor: 'user',
          details: `${nextSession.id}: ${nextSession.status}, ${nextSession.tradesRecorded} paper trades recorded.`,
          eventType: 'strategy',
          status: 'success',
          symbol: nextSession.market,
        });

        return nextSession;
      }),
    );
  }

  if (path[0] === 'preferences') {
    return json(updateThoonDb((db) => patchUserPreferences(db.userPreferencesRecord, body)));
  }

  if (path[0] === 'risk-rules') {
    return json(updateThoonDb((db) => patchRiskRules(db.riskRulesRecord, body)));
  }

  if (path[0] === 'trade-limits') {
    return json(updateThoonDb((db) => patchTradeLimits(db.tradeLimitsRecord, body)));
  }

  if (path[0] === 'profile') {
    return json(updateThoonDb((db) => patchUserProfile(db.userProfileRecord, body)));
  }

  if (path[0] === 'alerts' && path[1]) {
    return json(
      updateThoonDb((db) => {
        const alert = db.alertRecords.find((item) => item.id === path[1]);

        if (!alert) {
          throw new ApiError('Alert not found', 404);
        }

        if (body.status === 'active' || body.status === 'paused' || body.status === 'triggered') {
          alert.status = body.status;
        }

        appendAuditEvent(db, {
          action: 'Alert updated',
          actor: 'user',
          details: `${alert.symbol} alert set to ${alert.status}.`,
          eventType: 'system',
          status: 'success',
          symbol: alert.symbol,
        });

        return alert;
      }),
    );
  }

  if (path[0] === 'orders' && path[1]) {
    return json(
      updateThoonDb((db) => {
        const order = [...db.openOrderRecords, ...db.plannedOrderRecords].find((item) => item.id === path[1]);

        if (!order) {
          throw new ApiError('Order not found', 404);
        }

        if (body.status !== 'cancelled') {
          throw new ApiError('Unsupported order update', 400);
        }

        order.status = 'cancelled';
        db.openOrderRecords = db.openOrderRecords.filter((item) => item.id !== order.id);
        db.plannedOrderRecords = db.plannedOrderRecords.filter((item) => item.id !== order.id);
        db.orderHistoryRecords = [order, ...db.orderHistoryRecords];
        appendAuditEvent(db, {
          action: 'Order cancelled',
          actor: 'user',
          details: `${order.symbol} ${order.type} order cancelled.`,
          eventType: 'order',
          exchange: order.exchange,
          status: 'success',
          symbol: order.symbol,
        });

        return order;
      }),
    );
  }

  if (path[0] === 'strategies' && path[1]) {
    return json(
      updateThoonDb((db) => {
        let strategy = db.strategyRecords.find((item) => item.id === path[1]);

        if (!strategy) {
          const visibleStrategy = findVisibleStrategyRecord(db.strategyRecords, db.strategyResearchRecords, path[1]);

          if (!visibleStrategy) {
            throw new ApiError('Strategy not found', 404);
          }

          strategy = { ...visibleStrategy, updatedAt: new Date().toISOString() };
          db.strategyRecords = [strategy, ...db.strategyRecords];
        }

        if (body.status === 'active' || body.status === 'draft' || body.status === 'archived') {
          strategy.status = body.status;
        }

        if (typeof body.name === 'string') {
          strategy.name = asString(body.name) || strategy.name;
        }

        if (typeof body.market === 'string') {
          strategy.market = asString(body.market) || strategy.market;
        }

        if (body.timeframe !== undefined) {
          strategy.timeframe = normalizeTimeframe(body.timeframe);
        }

        if (body.type !== undefined) {
          strategy.type = normalizeStrategyType(body.type);
        }

        if (body.riskPerTrade !== undefined) {
          strategy.riskPerTrade = asNumber(body.riskPerTrade, strategy.riskPerTrade);
        }

        if (body.entryConditions !== undefined) {
          strategy.entryConditions = normalizeStrategyConditions(body.entryConditions, strategy.entryConditions ?? defaultStrategyConditions('entry'));
        }

        if (body.exitConditions !== undefined) {
          strategy.exitConditions = normalizeStrategyConditions(body.exitConditions, strategy.exitConditions ?? defaultStrategyConditions('exit'));
        }

        if (body.riskSettings !== undefined) {
          strategy.riskSettings = normalizeStrategyRiskSettings(body.riskSettings, strategy.riskSettings);
        }

        if (body.positionDraft !== undefined) {
          strategy.positionDraft = normalizePositionDraft(body.positionDraft) ?? strategy.positionDraft;
        }

        if (body.setupSnapshot !== undefined) {
          strategy.setupSnapshot = normalizeSetupSnapshot(body.setupSnapshot) ?? strategy.setupSnapshot;
        }

        if (body.sourceSetupId !== undefined) {
          strategy.sourceSetupId = asString(body.sourceSetupId) || strategy.sourceSetupId;
        }

        strategy.updatedAt = new Date().toISOString();
        appendAuditEvent(db, {
          action: 'Strategy updated',
          actor: 'user',
          details: `${strategy.name} set to ${strategy.status}.`,
          eventType: 'strategy',
          status: 'success',
          symbol: strategy.market,
        });

        return strategy;
      }),
    );
  }

  if (path[0] === 'bots' && path[1]) {
    const result = updateThoonDb((db) => {
      const bot = db.botRecords.find((item) => item.id === path[1]);

      if (!bot) {
        throw new ApiError('Bot not found', 404);
      }

      const requestedMode = body.mode === 'live' ? 'live' : body.mode === 'paper' ? 'paper' : bot.mode;
      const requestedStatus = body.status === 'running' || body.status === 'paused' || body.status === 'stopped' || body.status === 'draft' ? body.status : bot.status;
      const nextStrategyId = normalizeStrategyId(asString(body.strategyId) || bot.strategyId, db);
      const nextSymbol = asString(body.symbol) || bot.symbol;
      const requestedSourceReportId = asString(body.sourceBacktestReportId) || (nextStrategyId === bot.strategyId && nextSymbol === bot.symbol ? bot.sourceBacktestReportId ?? '' : '');
      const sourceReport = requestedSourceReportId ? resolveBotSourceReport(db, nextStrategyId, nextSymbol, requestedSourceReportId) : undefined;

      if (requestedSourceReportId && !sourceReport) {
        return { error: 'Bot source report blocked: the selected backtest does not match this exact strategy and pair.' };
      }

      if (requestedMode === 'live' && requestedStatus === 'running' && !isLiveExecutionEnabled()) {
        appendAuditEvent(db, {
          action: 'Live bot update blocked',
          actor: 'system',
          botId: bot.id,
          details: 'Live bot update blocked because live execution readiness is incomplete.',
          eventType: 'risk',
          exchange: asString(body.exchange) || bot.exchange,
          status: 'blocked',
          symbol: asString(body.symbol) || bot.symbol,
        });

        return { error: 'Live execution is disabled. Set THOON_APP_MODE=live-enabled only after connecting a real exchange executor.' };
      }

      const validationBlocker = requestedStatus === 'running' ? getBotLaunchValidationBlocker(db, nextStrategyId, nextSymbol, sourceReport?.id) : undefined;

      if (validationBlocker) {
        appendAuditEvent(db, {
          action: 'Bot update blocked',
          actor: 'system',
          botId: bot.id,
          details: validationBlocker,
          eventType: 'risk',
          exchange: asString(body.exchange) || bot.exchange,
          status: 'blocked',
          symbol: nextSymbol,
        });

        return { error: validationBlocker };
      }

      const liveBotBlocker =
        requestedMode === 'live' && requestedStatus === 'running' ? getLiveTradingBlocker(db, asString(body.exchange) || bot.exchange) : undefined;

      if (liveBotBlocker) {
        appendAuditEvent(db, {
          action: 'Live bot update blocked',
          actor: 'system',
          botId: bot.id,
          details: liveBotBlocker,
          eventType: 'risk',
          exchange: asString(body.exchange) || bot.exchange,
          status: 'blocked',
          symbol: asString(body.symbol) || bot.symbol,
        });

        return { error: liveBotBlocker };
      }

      if (typeof body.name === 'string') {
        bot.name = asString(body.name) || bot.name;
      }

      bot.mode = requestedMode;
      bot.status = requestedStatus;
      bot.allocatedCapital = positiveValue(body.allocatedCapital, bot.allocatedCapital);
      bot.exchange = asString(body.exchange) || bot.exchange;
      bot.riskPerTrade = positiveValue(body.riskPerTrade, bot.riskPerTrade);
      bot.sourceBacktestPeriod = sourceReport?.period;
      bot.sourceBacktestReportId = sourceReport?.id;
      bot.sourceCandleChecksum = sourceReport?.dataWindow?.candleChecksum;
      bot.sourceExchangeId = sourceReport?.exchangeId;
      bot.sourceExchangeName = sourceReport?.exchangeName;
      bot.sourceExecutionSettings = sourceReport?.executionSettings;
      bot.sourceFeesPct = sourceReport?.feesPct;
      bot.sourceInitialCapital = sourceReport?.initialCapital;
      bot.sourceMarketDataSource = sourceReport?.marketDataSource;
      bot.sourceSlippagePct = sourceReport?.slippagePct;
      bot.sourceTimeframe = sourceReport?.timeframe;
      bot.strategyId = nextStrategyId;
      bot.symbol = nextSymbol;

      appendAuditEvent(db, {
        action: 'Bot updated',
        actor: 'user',
        botId: bot.id,
        details: `${bot.name} status set to ${bot.status}.`,
        eventType: 'bot',
        exchange: bot.exchange,
        status: 'success',
        symbol: bot.symbol,
      });

      return bot;
    });

    return json(result, 'error' in result ? 403 : 200);
  }

  return notFound(path);
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  return handleApiError(_request, () => durableMutation(() => deleteHandler(_request, context)));
}

async function deleteHandler(_request: NextRequest, context: RouteContext) {
  const path = await routePath(context);
  const guard = mutationGuard(_request, path);

  if (guard) {
    return guard;
  }

  if (path[0] === 'alerts' && path[1]) {
    return json(
      updateThoonDb((db) => {
        const deleted = db.alertRecords.find((alert) => alert.id === path[1]);
        db.alertRecords = db.alertRecords.filter((alert) => alert.id !== path[1]);

        if (deleted) {
          appendAuditEvent(db, {
            action: 'Alert deleted',
            actor: 'user',
            details: `${deleted.symbol} alert deleted.`,
            eventType: 'system',
            status: 'success',
            symbol: deleted.symbol,
          });
        }

        return { deleted: Boolean(deleted) };
      }),
    );
  }

  if (path[0] === 'strategies' && path[1]) {
    return json(updateThoonDb((db) => {
      const existingStrategy = findVisibleStrategyRecord(db.strategyRecords, db.strategyResearchRecords, path[1]);
      const deletedStrategy = removeById(db.strategyRecords, path[1]);
      const beforeResearchCount = db.strategyResearchRecords.length;
      db.strategyResearchRecords = db.strategyResearchRecords.filter((record) => strategyIdFromResearchRecord(record) !== path[1]);
      const deleted = deletedStrategy || db.strategyResearchRecords.length !== beforeResearchCount;

      if (deleted) {
        appendAuditEvent(db, {
          action: 'Strategy deleted',
          actor: 'user',
          details: `${existingStrategy?.name ?? path[1]} removed from Strategies.`,
          eventType: 'strategy',
          status: 'warning',
          symbol: existingStrategy?.market,
        });
      }

      return { deleted };
    }));
  }

  if (path[0] === 'bots' && path[1]) {
    return json(updateThoonDb((db) => {
      const existingBot = db.botRecords.find((bot) => bot.id === path[1]);
      const deleted = removeById(db.botRecords, path[1]);

      if (deleted) {
        db.botLogRecords = db.botLogRecords.filter((log) => log.botId !== path[1]);
        appendAuditEvent(db, {
          action: 'Bot deleted',
          actor: 'user',
          botId: existingBot?.id,
          details: `${existingBot?.name ?? path[1]} removed from Bots.`,
          eventType: 'bot',
          exchange: existingBot?.exchange,
          status: 'warning',
          symbol: existingBot?.symbol,
        });
      }

      return { deleted };
    }));
  }

  if (path[0] === 'exchanges' && path[1] === 'api-keys' && path[2]) {
    return json(
      updateThoonDb((db) => {
        const keyRecord = db.apiKeyRecords.find((item) => item.id === path[2]);

        if (!keyRecord) {
          throw new ApiError('API key not found', 404);
        }

        keyRecord.status = 'disabled';
        delete db.apiKeySecrets[keyRecord.id];
        appendAuditEvent(db, {
          action: 'API key revoked',
          actor: 'user',
          details: `${keyRecord.label} disabled and encrypted secret removed.`,
          eventType: 'api',
          exchange: db.exchangeRecords.find((exchange) => exchange.id === keyRecord.exchangeId)?.name,
          status: 'warning',
        });

        return keyRecord;
      }),
    );
  }

  if (path[0] === 'journal' && path[1]) {
    return json(
      updateThoonDb((db) => {
        const deleted = db.journalTradeRecords.find((trade) => trade.id === path[1]);
        db.journalTradeRecords = db.journalTradeRecords.filter((trade) => trade.id !== path[1]);

        if (deleted) {
          appendAuditEvent(db, {
            action: 'Journal trade deleted',
            actor: 'user',
            details: `${deleted.symbol} journal entry removed.`,
            eventType: 'system',
            status: 'warning',
            symbol: deleted.symbol,
          });
        }

        return { deleted: Boolean(deleted) };
      }),
    );
  }

  return notFound(path);
}

function json(value: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(value, { headers, status });
}

function login(request: NextRequest, body: Record<string, unknown>) {
  const env = getThoonServerEnv();

  if (!isAuthRequired()) {
    return json({ authenticated: true, session: getSessionFromRequest(request) });
  }

  const email = asString(body.email).toLowerCase();
  const password = asString(body.password);
  const rateLimitKey = loginRateLimitKey(request, email);
  const rateLimit = getLoginRateLimit(rateLimitKey);

  if (rateLimit.blocked) {
    incrementMetric('rateLimitedRequests');

    return json(
      {
        error: 'Too many login attempts. Try again in a few minutes.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      429,
      { 'Retry-After': String(rateLimit.retryAfterSeconds) },
    );
  }

  if (!env.thoonAdminPasswordHash) {
    incrementMetric('authFailures');

    return json({ error: 'THOON_ADMIN_PASSWORD_HASH is required before local auth can be enabled.' }, 503);
  }

  if (email !== env.thoonAdminEmail.toLowerCase() || !verifyPassword(password, env.thoonAdminPasswordHash)) {
    incrementMetric('authFailures');
    recordFailedLoginAttempt(rateLimitKey);
    updateThoonDb((db) => {
      appendAuditEvent(db, {
        action: 'Login failed',
        actor: 'system',
        details: `Rejected login attempt for ${email || 'unknown user'}.`,
        eventType: 'system',
        status: 'blocked',
      });
    });

    return json({ error: 'Invalid credentials.' }, 401);
  }

  clearLoginAttempts(rateLimitKey);
  const { cookie, payload } = createLoginSession(email);
  const response = json({
    authenticated: true,
    session: {
      email: payload.email,
      expiresAt: payload.expiresAt,
      mode: 'authenticated',
      role: payload.role,
    },
  });

  response.cookies.set(thoonSessionCookieName, cookie, sessionCookieOptions(payload.expiresAt));
  updateThoonDb((db) => {
    db.sessionRecords = [
      {
        createdAt: payload.issuedAt,
        email: payload.email,
        expiresAt: payload.expiresAt,
        id: payload.sessionId,
        ipAddress: clientIp(request),
        lastSeenAt: payload.issuedAt,
        role: payload.role,
        userAgent: request.headers.get('user-agent') ?? 'unknown',
      },
      ...db.sessionRecords.filter((session) => !session.revokedAt).slice(0, 19),
    ];
    appendAuditEvent(db, {
      action: 'Login successful',
      actor: 'user',
      details: `${payload.email} signed in.`,
      eventType: 'system',
      status: 'success',
    });
  });

  return response;
}

function logout(request: NextRequest) {
  const session = getSessionFromRequest(request);
  const response = json({ authenticated: false, ok: true });

  response.cookies.set(thoonSessionCookieName, '', clearedSessionCookieOptions());

  if (session?.mode === 'authenticated') {
    updateThoonDb((db) => {
      db.sessionRecords = db.sessionRecords.map((record) => (record.id === session.sessionId && !record.revokedAt ? { ...record, revokedAt: new Date().toISOString() } : record));
      appendAuditEvent(db, {
        action: 'Logout',
        actor: 'user',
        details: `${session.email} signed out.`,
        eventType: 'system',
        status: 'success',
      });
    });
  }

  return response;
}

function loginRateLimitKey(request: NextRequest, email: string) {
  return `${clientIp(request)}:${email || 'unknown'}`;
}

function getLoginRateLimit(key: string) {
  const env = getThoonServerEnv();
  const windowMs = env.loginRateLimitWindowSeconds * 1000;
  const now = Date.now();
  const attempt = loginAttempts.get(key);

  if (!attempt) {
    return { blocked: false };
  }

  if (attempt.blockedUntil && attempt.blockedUntil > now) {
    return { blocked: true, retryAfterSeconds: Math.max(Math.ceil((attempt.blockedUntil - now) / 1000), 1) };
  }

  if (now - attempt.firstAttemptAt > windowMs) {
    loginAttempts.delete(key);
  }

  return { blocked: false };
}

function recordFailedLoginAttempt(key: string) {
  const env = getThoonServerEnv();
  const windowMs = env.loginRateLimitWindowSeconds * 1000;
  const now = Date.now();
  const current = loginAttempts.get(key);
  const next =
    current && now - current.firstAttemptAt <= windowMs
      ? { ...current, count: current.count + 1 }
      : { count: 1, firstAttemptAt: now };

  if (next.count >= env.loginRateLimitMax) {
    next.blockedUntil = now + windowMs;
  }

  loginAttempts.set(key, next);
}

function clearLoginAttempts(key: string) {
  loginAttempts.delete(key);
}

function clientIp(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 80) || 'local';
}

async function agentChat(body: Record<string, unknown>) {
  const content = asString(body.message).trim();

  if (!content) {
    throw new ApiError('Message is required.', 400);
  }

  const now = new Date().toISOString();
  const userMessage: AgentChatMessage = {
    content,
    createdAt: now,
    id: `agent-chat-user-${randomUUID()}`,
    role: 'user',
    status: 'completed',
  };

  const response = updateThoonDb((db) => {
    const instantMessage: AgentChatMessage = {
      content: buildInstantAgentChatReply(content, db),
      createdAt: new Date().toISOString(),
      id: `agent-chat-thoonix-instant-${randomUUID()}`,
      role: 'assistant',
      status: 'completed',
    };
    const backgroundMessage: AgentChatMessage = {
      content: 'Analyse profonde lancee avec Codex. Tu peux continuer a ecrire, je mets cette reponse a jour des que le job termine.',
      createdAt: new Date().toISOString(),
      id: `agent-chat-thoonix-job-${randomUUID()}`,
      role: 'assistant',
      status: 'running',
    };

    db.agentChatRecords = [backgroundMessage, instantMessage, userMessage, ...db.agentChatRecords].slice(0, 120);
    appendAuditEvent(db, {
      action: 'Thoonix chat request',
      actor: 'user',
      details: content.slice(0, 160),
      eventType: 'system',
      status: 'success',
    });
    appendAuditEvent(db, {
      action: 'Thoonix instant chat response',
      actor: 'system',
      details: instantMessage.content.slice(0, 160),
      eventType: 'system',
      status: 'success',
    });

    return { backgroundMessage, instantMessage, messages: db.agentChatRecords };
  });

  void completeAgentChatInBackground({ assistantMessageId: response.backgroundMessage.id, content }).catch((error) => {
    logServerEvent('error', 'agent.chat_background_unhandled', { error: error instanceof Error ? error.message : String(error) });
  });

  return json({ messages: response.messages, reply: response.instantMessage });
}

async function completeAgentChatInBackground({ assistantMessageId, content }: { assistantMessageId: string; content: string }) {
  let tradingViewImportNote = '';

  if (shouldRunTradingViewImportFromChat(content)) {
    try {
      const db = readThoonDb();
      const strategy = findVisibleStrategyRecord(db.strategyRecords, db.strategyResearchRecords, JIMMY_STRATEGY_ID);
      const research = await researchTradingViewStrategies({ limit: 8, query: content, strategy });
      const newCount = research.records.filter((record) => !db.strategyResearchRecords.some((item) => item.url === record.url)).length;

      updateThoonDb((nextDb) => {
        nextDb.strategyResearchRecords = mergeResearchRecords(nextDb.strategyResearchRecords, research.records);
        nextDb.agentRunRecords = [
          createSystemAgentRun(nextDb, 'research_tradingview', 'completed', `${research.records.length} TradingView records saved from chat request; ${newCount} new.`),
          ...nextDb.agentRunRecords,
        ].slice(0, 300);
        appendAuditEvent(nextDb, {
          action: 'TradingView import from chat',
          actor: 'system',
          details: `${research.records.length} records saved for query: ${content.slice(0, 120)}`,
          eventType: 'strategy',
          status: 'success',
          symbol: strategy?.market,
        });
      });

      tradingViewImportNote = `TradingView import pipeline saved ${research.records.length} public strategy records (${newCount} new).`;
    } catch (error) {
      tradingViewImportNote = `TradingView import pipeline failed: ${error instanceof Error ? error.message : 'unknown error'}.`;
      updateThoonDb((db) => {
        appendAuditEvent(db, {
          action: 'TradingView import from chat failed',
          actor: 'system',
          details: tradingViewImportNote.slice(0, 220),
          eventType: 'strategy',
          status: 'failed',
        });
      });
    }
  }

  try {
    const db = readThoonDb();
    const replyText = await runCodexAgentChat({
      appSnapshot: buildAgentChatSnapshot(db),
      history: db.agentChatRecords.slice(0, 16).reverse(),
      message: tradingViewImportNote ? `${content}\n\n${tradingViewImportNote}` : content,
    });
    const assistantMessage: AgentChatMessage = {
      content: replyText || 'Thoonix did not return a message.',
      createdAt: new Date().toISOString(),
      id: `agent-chat-thoonix-${randomUUID()}`,
      role: 'assistant',
      status: 'completed',
    };

    updateThoonDb((db) => {
      db.agentChatRecords = db.agentChatRecords.map((message) => (message.id === assistantMessageId ? { ...assistantMessage, id: assistantMessageId, createdAt: message.createdAt } : message)).slice(0, 120);
      appendAuditEvent(db, {
        action: 'Thoonix chat response',
        actor: 'system',
        details: assistantMessage.content.slice(0, 160),
        eventType: 'system',
        status: 'success',
      });
    });
  } catch (error) {
    const assistantMessage: AgentChatMessage = {
      content: friendlyAgentChatFailure(error),
      createdAt: new Date().toISOString(),
      id: assistantMessageId,
      role: 'assistant',
      status: 'failed',
    };

    updateThoonDb((db) => {
      db.agentChatRecords = db.agentChatRecords.map((message) => (message.id === assistantMessageId ? { ...assistantMessage, createdAt: message.createdAt } : message)).slice(0, 120);
      appendAuditEvent(db, {
        action: 'Thoonix chat failed',
        actor: 'system',
        details: assistantMessage.content.slice(0, 160),
        eventType: 'system',
        status: 'failed',
      });
    });
  }
}

function buildInstantAgentChatReply(content: string, db: ThoonDb) {
  const normalized = normalizeChatQuery(content);
  const strategies = buildVisibleStrategyRecords(db.strategyRecords, db.strategyResearchRecords);
  const calculatedReports = db.backtestReportRecords.filter((report) => report.source === 'calculated');
  const bestReport = calculatedReports
    .slice()
    .sort((left, right) => assessBotReadiness(right, db.agentSettingsRecord).score - assessBotReadiness(left, db.agentSettingsRecord).score || right.netProfit - left.netProfit)[0];
  const recentResearch = db.strategyResearchRecords[0];
  const activeTasks = db.agentQueueRecords.filter((task) => task.status === 'queued' || task.status === 'running').length;
  const mentionsLatency = ['instant', 'instantane', 'lent', 'timeout', 'openclaw', 'codex'].some((token) => normalized.includes(token));
  const asksForStrategies = ['strategie', 'strategies', 'tradingview', 'research', 'recherche'].some((token) => normalized.includes(token));
  const lines = [
    mentionsLatency
      ? "Tu as raison: le chat ne doit pas attendre Codex CLI pour afficher une reponse. Je reponds maintenant en local tout de suite, puis Codex approfondit en arriere-plan."
      : "Recu. Je te reponds tout de suite avec l'etat local, puis je lance l'analyse Codex en arriere-plan.",
  ];

  if (asksForStrategies || mentionsLatency) {
    lines.push(`Recherche strategies: ${db.strategyResearchRecords.length} source${db.strategyResearchRecords.length > 1 ? 's' : ''} TradingView en memoire, ${strategies.length} strategie${strategies.length > 1 ? 's' : ''} visible${strategies.length > 1 ? 's' : ''}, ${calculatedReports.length} backtest${calculatedReports.length > 1 ? 's' : ''} calcule${calculatedReports.length > 1 ? 's' : ''}.`);
  }

  if (bestReport) {
    const readiness = assessBotReadiness(bestReport, db.agentSettingsRecord);
    lines.push(`Meilleur backtest verifie: ${bestReport.market} ${bestReport.timeframe}, score bot ${readiness.score}/100, PnL ${formatMoney(bestReport.netProfit)}, winrate ${bestReport.winRate.toFixed(1)}%.`);
  } else {
    lines.push("Pour l'instant, aucune strategie n'a encore un backtest calcule fiable a proposer en bot. Je dois importer/creer des candidates puis les valider sur bougies live.");
  }

  if (recentResearch) {
    lines.push(`Derniere piste TradingView: ${recentResearch.title}.`);
  }

  if (shouldRunTradingViewImportFromChat(content)) {
    lines.push('Import TradingView lance en arriere-plan: je sauvegarde les concepts publics, puis Thoon les validera par backtest/paper test.');
  }

  lines.push(`File agent: ${activeTasks} tache${activeTasks > 1 ? 's' : ''} active${activeTasks > 1 ? 's' : ''}.`);
  lines.push("La reponse profonde remplacera le message 'Analyse profonde' quand Codex aura fini.");

  return lines.join('\n');
}

function friendlyAgentChatFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (/timed out|timeout|Codex CLI/i.test(message)) {
    return "La reponse instantanee est deja affichee. L'analyse profonde Codex a depasse le delai serveur; je garde le chat disponible au lieu de bloquer l'interface. Relance une demande plus ciblee si tu veux une passe profonde plus courte.";
  }

  return `La reponse instantanee est affichee, mais l'analyse profonde a echoue: ${message}`;
}

function normalizeChatQuery(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

async function agentAction(body: Record<string, unknown>) {
  const action = normalizeAgentAction(body.action);

  if (!action) {
    return json({ error: 'Unknown Strategy Agent action.' }, 400);
  }

  const confirmed = Boolean(body.confirmed);
  const initialDb = readThoonDb();
  const strategyId = normalizeStrategyId(asString(body.strategyId), initialDb);
  const versionId = asString(body.versionId);
  const reportId = asString(body.reportId);
  let aiSuggestionResult: Awaited<ReturnType<typeof generateAiStrategySuggestions>> | undefined;
  let agentBacktestReport: BacktestReport | undefined;
  let tradingViewResearchResult: Awaited<ReturnType<typeof researchTradingViewStrategies>> | undefined;

  if (action === 'analyze_strategy' || action === 'create_report') {
    const db = readThoonDb();
    const strategy = strategyId ? findVisibleStrategyRecord(db.strategyRecords, db.strategyResearchRecords, strategyId) : undefined;
    const versions = strategyId ? db.strategyVersionRecords.filter((item) => item.strategyId === strategyId) : db.strategyVersionRecords;

    try {
      aiSuggestionResult = await generateAiStrategySuggestions({
        backtests: strategyId ? db.backtestReportRecords.filter((report) => report.strategyId === strategyId) : db.backtestReportRecords,
        riskRules: db.riskRulesRecord,
        strategy,
        versions,
      });
    } catch (error) {
      logServerEvent('warn', 'agent.ai_provider_failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (action === 'run_backtest') {
    const db = readThoonDb();
    const strategy = strategyId ? findVisibleStrategyRecord(db.strategyRecords, db.strategyResearchRecords, strategyId) : undefined;

    if (strategy) {
      const executionSettings = normalizeBacktestExecutionSettings(undefined, strategy);

      if (!isExecutableBacktestStrategy(strategy)) {
        throw new ApiError(`${strategy.name} does not have a real executable backtest engine yet.`, 422);
      }

      let candles;

      try {
        candles = await getMarketCandles(strategy.market, strategy.timeframe, 'binance', desiredBacktestCandleLimit('90D', strategy.timeframe), { marketType: executionSettings.marketType, strict: true });
      } catch (error) {
        throw new ApiError(error instanceof Error ? error.message : 'Live Binance candles unavailable for agent backtest.', 502);
      }
      agentBacktestReport = runBacktestFromCandles({
        candles,
        exchangeId: 'binance',
        exchangeName: 'Binance',
        executionSettings,
        feesPct: 0.06,
        initialCapital: strategy.riskSettings?.accountBalance ?? 10000,
        marketDataSource: 'binance-live',
        period: '90D',
        slippagePct: 0.02,
        strategy,
        symbol: strategy.market,
        timeframe: strategy.timeframe,
      });
    }
  }

  if (action === 'research_tradingview') {
    const db = readThoonDb();
    const strategy = strategyId ? findVisibleStrategyRecord(db.strategyRecords, db.strategyResearchRecords, strategyId) : undefined;
    const decision = evaluateAgentAction(db, action, { confirmed, strategyId, versionId });

    if (decision.allowed && !decision.requiredConfirmation) {
      tradingViewResearchResult = await researchTradingViewStrategies({
        limit: 8,
        query: asString(body.query),
        strategy,
      });
    }
  }

  return json(
    updateThoonDb((db) => {
      const decision = evaluateAgentAction(db, action, { confirmed, strategyId, versionId });
      const strategy = strategyId ? findVisibleStrategyRecord(db.strategyRecords, db.strategyResearchRecords, strategyId) : undefined;
      const version = versionId ? db.strategyVersionRecords.find((item) => item.id === versionId) : strategy ? latestStrategyVersion(db, strategy.id) : undefined;
      const runBase = createAgentRunBase(db, action, decision, strategy?.id, version?.id, confirmed);

      if (!decision.allowed) {
        const run: AgentRun = { ...runBase, notes: decision.blockers[0] ?? 'Blocked by Strategy Agent guard.', result: 'blocked' };
        db.agentRunRecords = [run, ...db.agentRunRecords].slice(0, 80);
        appendAuditEvent(db, {
          action: 'Strategy Agent action blocked',
          actor: 'system',
          details: `${action}: ${decision.blockers.join(' ')}`,
          eventType: 'risk',
          status: 'blocked',
          symbol: strategy?.market,
        });

        return { decision, ok: false, run };
      }

      if (decision.requiredConfirmation) {
        const task = {
          action,
          createdAt: new Date().toISOString(),
          id: `agent-task-${slug(action)}-${Date.now()}`,
          nextAction: 'Approve task',
          priority: dangerousAgentAction(action) ? ('high' as const) : ('normal' as const),
          result: 'Waiting for user confirmation.',
          status: 'waiting_for_confirmation' as const,
          strategyId: strategy?.id,
          versionId: version?.id,
        };
        const run: AgentRun = { ...runBase, notes: 'Waiting for user confirmation.', result: 'waiting_for_confirmation' };
        db.agentQueueRecords = [task, ...db.agentQueueRecords].slice(0, 40);
        db.agentRunRecords = [run, ...db.agentRunRecords].slice(0, 80);

        return { confirmationRequired: true, decision, ok: true, run, task };
      }

      const result = executeAgentAction(db, action, strategy, version, aiSuggestionResult, agentBacktestReport, tradingViewResearchResult, reportId);
      const run: AgentRun = { ...runBase, notes: result.notes, result: 'completed' };
      db.agentQueueRecords = db.agentQueueRecords.map((task) =>
        task.action === action && task.strategyId === strategy?.id && task.versionId === version?.id && task.status === 'waiting_for_confirmation'
          ? { ...task, result: result.notes, status: 'completed' }
          : task,
      );
      db.agentRunRecords = [run, ...db.agentRunRecords].slice(0, 80);
      appendAuditEvent(db, {
        action: 'Strategy Agent action',
        actor: 'system',
        details: `${action}: ${result.notes}`,
        eventType: 'strategy',
        status: 'success',
        symbol: strategy?.market,
      });

      return { decision, ok: true, result: result.payload, run };
    }),
  );
}

async function agentCron() {
  const startedAt = new Date().toISOString();
  const initialDb = readThoonDb();
  const settings = normalizeAgentSettings(initialDb.agentSettingsRecord);

  if (!settings.enabled || settings.queuePaused) {
    return json(
      updateThoonDb((db) => {
        const notes = settings.enabled ? 'Strategy Agent cron skipped because queue is paused.' : 'Strategy Agent cron skipped because agent is disabled.';
        const run = createSystemAgentRun(db, 'run_backtest', 'blocked', notes);

        db.agentRunRecords = [run, ...db.agentRunRecords].slice(0, 300);
        appendAuditEvent(db, {
          action: 'Strategy Agent cron blocked',
          actor: 'system',
          details: notes,
          eventType: 'strategy',
          status: 'blocked',
        });

        return { ok: false, reason: notes, startedAt };
      }),
    );
  }

  let snapshot: MarketDataSnapshot;

  try {
    snapshot = await getMarketDataSnapshot();
  } catch (error) {
    const notes = error instanceof Error ? error.message : 'Live market snapshot failed.';

    return json(
      updateThoonDb((db) => {
        const run = createSystemAgentRun(db, 'run_backtest', 'failed', notes);

        db.agentRunRecords = [run, ...db.agentRunRecords].slice(0, 300);
        appendAuditEvent(db, {
          action: 'Strategy Agent cron failed',
          actor: 'system',
          details: notes,
          eventType: 'strategy',
          status: 'failed',
        });

        return { ok: false, reason: notes, startedAt };
      }),
      502,
    );
  }

  if (!snapshot.status.live) {
    const notes = `Live market data is unavailable: ${snapshot.status.warnings[0] ?? 'snapshot provider is local'}. No backtest was saved.`;

    return json(
      updateThoonDb((db) => {
        const run = createSystemAgentRun(db, 'run_backtest', 'blocked', notes);

        db.agentRunRecords = [run, ...db.agentRunRecords].slice(0, 300);
        appendAuditEvent(db, {
          action: 'Strategy Agent cron blocked',
          actor: 'system',
          details: notes,
          eventType: 'strategy',
          status: 'blocked',
        });

        return { ok: false, reason: notes, startedAt, warnings: snapshot.status.warnings };
      }),
    );
  }

  const research = await runAgentCronResearch(initialDb);
  const newResearchCount = research.records.filter((record) => !initialDb.strategyResearchRecords.some((item) => item.url === record.url)).length;
  const shouldInnovate = research.attempted && newResearchCount === 0;
  const innovationStrategies = buildAgentInnovationStrategies(initialDb, snapshot.pairs, shouldInnovate);
  const virtualDb: ThoonDb = {
    ...initialDb,
    agentSettingsRecord: settings,
    marketPairRecords: mergeLiveMarketPairs(initialDb.marketPairRecords, snapshot.pairs),
    strategyRecords: [...innovationStrategies, ...initialDb.strategyRecords],
    strategyResearchRecords: mergeResearchRecords(initialDb.strategyResearchRecords, research.records),
  };
  const candidates = selectAgentCronBacktestTargets(virtualDb, snapshot.pairs);
  const outcomes: AgentCronBacktestOutcome[] = [];

  for (const target of candidates) {
    outcomes.push(await runAgentCronBacktest(virtualDb, target));
  }

  return json(
    updateThoonDb((db) => {
      db.agentSettingsRecord = normalizeAgentSettings(db.agentSettingsRecord);
      db.marketPairRecords = mergeLiveMarketPairs(db.marketPairRecords, snapshot.pairs);
      db.strategyRecords = mergeStrategyRecords(db.strategyRecords, innovationStrategies);
      db.strategyResearchRecords = mergeResearchRecords(db.strategyResearchRecords, research.records);

      const reports = outcomes.flatMap((outcome) => (outcome.report ? [outcome.report] : []));
      db.backtestReportRecords = [...reports, ...db.backtestReportRecords].slice(0, 1000);
      const kronosCreated = outcomes.filter((outcome) => outcome.kronosLearning?.created).length;
      const kronosEvaluated = outcomes.reduce((sum, outcome) => sum + (outcome.kronosLearning?.evaluatedCount ?? 0), 0);
      db.kronosForecastRecords = mergeKronosForecastRecords(db.kronosForecastRecords, outcomes.flatMap((outcome) => outcome.kronosLearning?.records ?? []));

      const runRecords = buildAgentCronRunRecords(db, outcomes, research, innovationStrategies.length, newResearchCount);
      if (kronosCreated || kronosEvaluated) {
        const profile = getKronosLearningProfile(db.kronosForecastRecords);
        runRecords.unshift(createSystemAgentRun(db, 'analyze_strategy', 'completed', `Kronos learning updated: ${kronosCreated} new forecast${kronosCreated === 1 ? '' : 's'}, ${kronosEvaluated} evaluated, ${(profile.accuracy * 100).toFixed(1)}% accuracy, weight ${profile.confidenceWeight.toFixed(2)}.`));
      }
      db.agentRunRecords = [...runRecords, ...db.agentRunRecords].slice(0, 300);
      db.agentQueueRecords = buildAutonomousAgentTasks(db);
      db.agentReportRecords = [...buildAgentCronReports(db, outcomes), ...db.agentReportRecords].slice(0, 160);

      const completed = outcomes.filter((outcome) => outcome.status === 'completed').length;
      const failed = outcomes.filter((outcome) => outcome.status === 'failed').length;
      const blocked = outcomes.filter((outcome) => outcome.status === 'blocked').length;

      appendAuditEvent(db, {
        action: 'Strategy Agent cron executed',
        actor: 'system',
        details: `${completed} calculated backtests saved, ${innovationStrategies.length} innovation strategies created, ${newResearchCount} new TradingView records, ${failed} failed, ${blocked} blocked.`,
        eventType: 'strategy',
        status: completed ? 'success' : failed || blocked ? 'warning' : 'success',
      });

      return {
        backtests: {
          blocked,
          completed,
          failed,
          requested: candidates.length,
          saved: reports.length,
        },
        innovationsCreated: innovationStrategies.length,
        kronosLearning: {
          created: kronosCreated,
          evaluated: kronosEvaluated,
          profile: getKronosLearningProfile(db.kronosForecastRecords),
        },
        marketPairsSeen: snapshot.pairs.length,
        matrix: {
          strategyCount: new Set(candidates.map((candidate) => candidate.strategy.id)).size,
          symbolCount: new Set(candidates.map((candidate) => candidate.symbol)).size,
          timeframeCount: new Set(candidates.map((candidate) => candidate.timeframe)).size,
        },
        ok: true,
        research: {
          attempted: research.attempted,
          errors: research.errors,
          newRecords: newResearchCount,
          savedRecords: research.records.length,
        },
        startedAt,
      };
    }),
  );
}

function agentProgressCron() {
  return json(
    updateThoonDb((db) => {
      const report = buildAgentProgressReport(db);
      const run = createSystemAgentRun(db, 'create_report', 'completed', report.summary.join(' '));

      db.agentReportRecords = [report, ...db.agentReportRecords].slice(0, 160);
      db.agentRunRecords = [run, ...db.agentRunRecords].slice(0, 300);
      appendAuditEvent(db, {
        action: 'Strategy Agent progress report',
        actor: 'system',
        details: report.summary.join(' '),
        eventType: 'strategy',
        status: 'success',
      });

      return { ok: true, report };
    }),
  );
}

type AgentCronResearchOutcome = {
  attempted: boolean;
  errors: string[];
  records: StrategyResearchRecord[];
  searchedQueries: string[];
};

type AgentCronBacktestOutcome = {
  decision: AgentRun['decision'];
  kronosLearning?: ReturnType<typeof advanceKronosLearning>;
  notes: string;
  report?: BacktestReport;
  status: AgentRun['result'];
  strategy: Strategy;
  target: AgentCronBacktestTarget;
};

type AgentCronBacktestTarget = {
  marketRank: number;
  strategy: Strategy;
  symbol: string;
  timeframe: Timeframe;
};

async function runAgentCronResearch(db: ThoonDb): Promise<AgentCronResearchOutcome> {
  if (!shouldRunAgentCronResearch(db)) {
    return { attempted: false, errors: [], records: [], searchedQueries: [] };
  }

  const strategy = findVisibleStrategyRecord(db.strategyRecords, db.strategyResearchRecords, JIMMY_STRATEGY_ID);

  try {
    const result = await researchTradingViewStrategies({ limit: 8, strategy });

    return {
      attempted: true,
      errors: result.errors,
      records: result.records,
      searchedQueries: result.searchedQueries,
    };
  } catch (error) {
    return {
      attempted: true,
      errors: [error instanceof Error ? error.message : 'TradingView public research failed.'],
      records: [],
      searchedQueries: [],
    };
  }
}

function shouldRunAgentCronResearch(db: ThoonDb) {
  const latestFetch = db.strategyResearchRecords.reduce((latest, record) => Math.max(latest, new Date(record.fetchedAt).getTime()), 0);

  return !latestFetch || Date.now() - latestFetch >= agentCronResearchIntervalMs;
}

function buildAgentInnovationStrategies(db: ThoonDb, pairs: MarketPair[], forceInnovation: boolean): Strategy[] {
  const settings = normalizeAgentSettings(db.agentSettingsRecord);
  const livePairs = pairs.filter((pair) => pair.quote === 'USDT').slice(0, agentCronTargetPairCount);
  const existingIds = new Set(db.strategyRecords.map((strategy) => strategy.id));
  const existingInnovationCount = db.strategyRecords.filter((strategy) => strategy.agentSource?.sourceId.startsWith('agent-innovation:')).length;
  const needsCryptoCoverage = existingInnovationCount < Math.min(livePairs.length, agentCronTargetPairCount);

  if (!forceInnovation && !needsCryptoCoverage) {
    return [];
  }

  const strategies: Strategy[] = [];

  for (let index = 0; index < livePairs.length; index += 1) {
    const pair = livePairs[index];

    if (!isMarketAllowedByAgent(settings, pair.symbol)) {
      continue;
    }

    const template = innovationTemplateForPair(pair, settings, index);
    const id = `strat-agent-${slug(pair.symbol)}-${slug(template.timeframe)}-${slug(template.type)}`;

    if (existingIds.has(id)) {
      continue;
    }

    existingIds.add(id);
    strategies.push(makeAgentInnovationStrategy(pair, template, id));

    if (strategies.length >= agentCronInnovationBatchSize) {
      break;
    }
  }

  return strategies;
}

type AgentInnovationTemplate = {
  directionBias: NonNullable<Strategy['agentSource']>['directionBias'];
  label: string;
  timeframe: Timeframe;
  type: Strategy['type'];
};

function innovationTemplateForPair(pair: MarketPair, settings: ReturnType<typeof normalizeAgentSettings>, index: number): AgentInnovationTemplate {
  const preferredTimeframe = pair.change24h > 4 ? '15m' : pair.change24h < -3 ? '30m' : index % 3 === 0 ? '5m' : '1h';
  const timeframe = settings.limits.allowedTimeframes.includes(preferredTimeframe) ? preferredTimeframe : settings.limits.allowedTimeframes[0] ?? '15m';

  if (pair.change24h > 4 || pair.volume24h > 1_000_000_000) {
    return {
      directionBias: 'both',
      label: 'Momentum breakout',
      timeframe,
      type: 'breakout',
    };
  }

  if (pair.change24h < -3) {
    return {
      directionBias: 'both',
      label: 'Volatility reversion',
      timeframe,
      type: 'mean-reversion',
    };
  }

  return {
    directionBias: 'both',
    label: 'Trend continuation',
    timeframe,
    type: 'trend',
  };
}

function makeAgentInnovationStrategy(pair: MarketPair, template: AgentInnovationTemplate, id: string): Strategy {
  const stopLossAtr = template.type === 'mean-reversion' ? 'ATR 1.2x required' : template.type === 'breakout' ? 'ATR 1.8x required' : 'ATR 1.5x required';
  const rrTarget = template.type === 'mean-reversion' ? 1.6 : template.type === 'breakout' ? 2.4 : 2;

  return {
    agentSource: {
      directionBias: template.directionBias,
      language: 'manual',
      originalTimeframe: template.timeframe,
      parameters: [
        { label: 'Origin', value: 'Thoon agent innovation' },
        { label: 'Template', value: template.label },
        { label: 'Evidence rule', value: 'Must be backtested with live exchange candles before ranking' },
        { label: 'Market universe', value: 'Dynamic Binance USDT liquidity list' },
      ],
      protectedCore: false,
      sourceId: `agent-innovation:${slug(pair.symbol)}:${slug(template.timeframe)}:${slug(template.type)}`,
      summary: `${template.label} generated by Thoon for ${pair.symbol}. This is a test candidate, not a proven strategy, until live-candle backtests and paper trades validate it.`,
    },
    entryConditions: innovationEntryConditions(template),
    exitConditions: innovationExitConditions(template),
    id,
    market: pair.symbol,
    name: `Agent ${pair.base} ${template.label}`,
    performance30d: 0,
    riskPerTrade: 0.7,
    riskSettings: {
      accountBalance: 10000,
      maxOpenTrades: 3,
      positionSizing: 'risk-percent',
      rrTarget,
      stopLoss: stopLossAtr,
      stopRequired: true,
      takeProfit: `${rrTarget}R target plus ATR trail`,
      trailingStop: true,
    },
    status: 'active',
    timeframe: template.timeframe,
    type: template.type,
    updatedAt: new Date().toISOString(),
  };
}

function innovationEntryConditions(template: AgentInnovationTemplate): StrategyCondition[] {
  if (template.type === 'breakout') {
    return [
      { connector: 'IF', field: 'Close', id: 'agent-breakout-close', operator: 'greater-than', value: 'Donchian upper band' },
      { connector: 'AND', field: 'Volume', id: 'agent-breakout-volume', operator: 'greater-than', value: 'Donchian volume average' },
      { connector: 'OR', field: 'Close', id: 'agent-breakout-short', operator: 'less-than', value: 'Donchian lower band' },
    ];
  }

  if (template.type === 'mean-reversion') {
    return [
      { connector: 'IF', field: 'RSI', id: 'agent-reversion-rsi-low', operator: 'less-than', value: '35 near range low' },
      { connector: 'OR', field: 'RSI', id: 'agent-reversion-rsi-high', operator: 'greater-than', value: '68 near range high' },
    ];
  }

  return [
    { connector: 'IF', field: 'Fast MA', id: 'agent-trend-ma', operator: 'greater-than', value: 'slow MA' },
    { connector: 'AND', field: 'Close', id: 'agent-trend-close', operator: 'crosses-above', value: 'fast MA or Donchian high' },
    { connector: 'OR', field: 'Fast MA', id: 'agent-trend-short', operator: 'less-than', value: 'slow MA' },
  ];
}

function innovationExitConditions(template: AgentInnovationTemplate): StrategyCondition[] {
  return [
    { connector: 'IF', field: 'ATR Stop', id: `agent-${template.type}-exit-stop`, operator: 'less-than', value: 'strategy ATR stop' },
    { connector: 'OR', field: 'ATR Trail', id: `agent-${template.type}-exit-trail`, operator: 'crosses-below', value: 'price' },
    { connector: 'OR', field: 'Target', id: `agent-${template.type}-exit-target`, operator: 'greater-than', value: 'configured R multiple' },
  ];
}

function selectAgentCronBacktestTargets(db: ThoonDb, pairs: MarketPair[]): AgentCronBacktestTarget[] {
  const settings = normalizeAgentSettings(db.agentSettingsRecord);
  const livePairs = pairs
    .filter((pair) => pair.quote === 'USDT')
    .filter((pair) => isMarketAllowedByAgent(settings, pair.symbol))
    .slice(0, agentCronTargetPairCount);
  const liveSymbols = new Set(livePairs.map((pair) => pair.symbol));
  const latestReportTimeByTarget = new Map<string, number>();
  const latestReportTimeByPairTimeframe = new Map<string, number>();

  for (const report of db.backtestReportRecords) {
    const generatedAt = new Date(report.generatedAt ?? 0).getTime();
    const reportTime = Number.isFinite(generatedAt) ? generatedAt : 0;
    const key = backtestTargetKey(report.strategyId, report.market, report.timeframe);
    const current = latestReportTimeByTarget.get(key) ?? 0;
    latestReportTimeByTarget.set(key, Math.max(current, reportTime));

    if (report.market && report.timeframe) {
      const pairTimeframe = pairTimeframeKey(report.market, report.timeframe);
      const pairTimeframeCurrent = latestReportTimeByPairTimeframe.get(pairTimeframe) ?? 0;
      latestReportTimeByPairTimeframe.set(pairTimeframe, Math.max(pairTimeframeCurrent, reportTime));
    }
  }

  const strategies = buildVisibleStrategyRecords(db.strategyRecords, db.strategyResearchRecords)
    .filter((strategy) => isExecutableStrategy(strategy))
    .filter((strategy) => !strategy.market || liveSymbols.has(strategy.market) || strategy.id === JIMMY_STRATEGY_ID || strategy.agentSource?.sourceId.startsWith('tradingview:'))
    .slice(0, 80);
  const timeframes = agentMatrixTimeframes(settings);
  const groups: Array<{
    groupTime: number;
    kronosRank: number;
    marketRank: number;
    strategyRank: number;
    target: AgentCronBacktestTarget;
    targetTime: number;
    timeframeRank: number;
  }> = [];

  for (const [pairIndex, pair] of livePairs.entries()) {
    for (const [timeframeIndex, timeframe] of timeframes.entries()) {
      const rankedTargets = strategies
        .map((strategy, strategyIndex) => {
          const key = backtestTargetKey(strategy.id, pair.symbol, timeframe);

          return {
            groupTime: latestReportTimeByPairTimeframe.get(pairTimeframeKey(pair.symbol, timeframe)) ?? 0,
            kronosRank: kronosTargetRank(db, pair.symbol, timeframe),
            marketRank: pairIndex + 1,
            strategyRank: strategyIndex,
            target: {
              marketRank: pairIndex + 1,
              strategy,
              symbol: pair.symbol,
              timeframe,
            },
            targetTime: latestReportTimeByTarget.get(key) ?? 0,
            timeframeRank: timeframeIndex,
          };
        })
        .sort((left, right) => {
          if (left.targetTime !== right.targetTime) {
            return left.targetTime - right.targetTime;
          }

          return left.strategyRank - right.strategyRank;
        });

      const nextTarget = rankedTargets[0];

      if (nextTarget) {
        groups.push(nextTarget);
      }
    }
  }

  return groups
    .sort((left, right) => {
      if (left.groupTime !== right.groupTime) {
        return left.groupTime - right.groupTime;
      }

      if (left.kronosRank !== right.kronosRank) {
        return left.kronosRank - right.kronosRank;
      }

      if (left.marketRank !== right.marketRank) {
        return left.marketRank - right.marketRank;
      }

      if (left.timeframeRank !== right.timeframeRank) {
        return left.timeframeRank - right.timeframeRank;
      }

      if (left.targetTime !== right.targetTime) {
        return left.targetTime - right.targetTime;
      }

      return left.strategyRank - right.strategyRank;
    })
    .slice(0, agentCronBacktestBatchSize)
    .map((group) => group.target);
}

async function runAgentCronBacktest(db: ThoonDb, target: AgentCronBacktestTarget): Promise<AgentCronBacktestOutcome> {
  const strategy = {
    ...target.strategy,
    market: target.symbol,
    timeframe: target.timeframe,
  };
  const decision = evaluateAgentAction(db, 'run_backtest', { strategyId: strategy.id });

  if (!decision.allowed || decision.requiredConfirmation) {
    return {
      decision,
      notes: decision.blockers[0] ?? 'Backtest blocked by Strategy Agent policy.',
      status: 'blocked',
      strategy,
      target,
    };
  }

  if (!isExecutableBacktestStrategy(strategy)) {
    return {
      decision,
      notes: `${strategy.name} has no executable candle engine. No synthetic result was saved.`,
      status: 'blocked',
      strategy,
      target,
    };
  }

  const executionSettings = normalizeBacktestExecutionSettings(undefined, strategy);

  try {
    const candles = await getMarketCandles(target.symbol, target.timeframe, 'binance', desiredBacktestCandleLimit(agentCronBacktestPeriod, target.timeframe), {
      marketType: executionSettings.marketType,
      strict: true,
    });

    if (candles.length < 40) {
      return {
        decision,
        notes: `Only ${candles.length} live candles returned for ${target.symbol} ${target.timeframe}. Backtest was not saved.`,
        status: 'failed',
        strategy,
        target,
      };
    }

    const kronosLearning = advanceKronosLearning({
      candles,
      market: target.symbol,
      records: db.kronosForecastRecords,
      strategyId: strategy.id,
      timeframe: target.timeframe,
    });
    const report = runBacktestFromCandles({
      candles,
      exchangeId: 'binance',
      exchangeName: 'Binance',
      executionSettings,
      feesPct: 0.06,
      initialCapital: strategy.riskSettings?.accountBalance ?? 10000,
      marketDataSource: 'binance-live',
      period: agentCronBacktestPeriod,
      slippagePct: 0.02,
      strategy,
      symbol: target.symbol,
      timeframe: target.timeframe,
    });
    const assessment = assessBotReadiness(report, db.agentSettingsRecord);

    return {
      decision,
      kronosLearning,
      notes: `Calculated ${target.symbol} ${target.timeframe}: score ${assessment.score}/100, ${assessment.decision.replace(/_/g, ' ')}, ${report.profitFactor.toFixed(2)} PF, ${report.winRate.toFixed(1)}% WR, ${report.totalTrades} trades, ${report.drawdown.toFixed(1)}% DD.`,
      report,
      status: 'completed',
      strategy,
      target,
    };
  } catch (error) {
    return {
      decision,
      notes: error instanceof Error ? error.message : `Live candles unavailable for ${target.symbol}.`,
      status: 'failed',
      strategy,
      target,
    };
  }
}

function buildAgentCronRunRecords(db: ThoonDb, outcomes: AgentCronBacktestOutcome[], research: AgentCronResearchOutcome, innovationCount: number, newResearchCount: number): AgentRun[] {
  const runs = outcomes.map((outcome, index): AgentRun => ({
    action: 'run_backtest',
    createdAt: new Date().toISOString(),
    decision: outcome.decision,
    id: `agent-run-cron-backtest-${slug(outcome.strategy.id)}-${Date.now()}-${index}`,
    mode: db.agentSettingsRecord.mode,
    notes: outcome.notes,
    permission: outcome.decision.permission,
    result: outcome.status,
    strategyId: outcome.strategy.id,
    userConfirmed: false,
  }));

  if (research.attempted) {
    const notes = research.records.length
      ? newResearchCount
        ? `${newResearchCount} new TradingView public record${newResearchCount === 1 ? '' : 's'} saved.`
        : 'TradingView research found no new records; innovation mode was used.'
      : `TradingView research found no usable records; innovation mode was used. ${research.errors[0] ?? ''}`.trim();

    runs.unshift(createSystemAgentRun(db, 'research_tradingview', research.records.length ? 'completed' : 'failed', notes));
  }

  if (innovationCount > 0) {
    runs.unshift(createSystemAgentRun(db, 'create_variant', 'completed', `${innovationCount} agent innovation strateg${innovationCount === 1 ? 'y' : 'ies'} created for live-candle validation.`));
  }

  return runs;
}

function buildAgentCronReports(db: ThoonDb, outcomes: AgentCronBacktestOutcome[]): AgentReport[] {
  return outcomes
    .filter((outcome): outcome is AgentCronBacktestOutcome & { report: BacktestReport } => Boolean(outcome.report))
    .sort((left, right) => assessBotReadiness(right.report, db.agentSettingsRecord).score - assessBotReadiness(left.report, db.agentSettingsRecord).score)
    .slice(0, 3)
    .map((outcome) => agentReportFromBacktest(db, outcome.strategy, outcome.report));
}

function buildAgentProgressReport(db: ThoonDb): AgentReport {
  const strategy = db.strategyRecords[0];
  const trustedReports = trustedCalculatedReports(db.backtestReportRecords);
  const best = trustedReports
    .slice()
    .sort((left, right) => assessBotReadiness(right, db.agentSettingsRecord).score - assessBotReadiness(left, db.agentSettingsRecord).score)[0];
  const bestStrategy = best ? findVisibleStrategyRecord(db.strategyRecords, db.strategyResearchRecords, best.strategyId) ?? strategy : strategy;
  const today = new Date().toISOString().slice(0, 10);
  const todayReports = trustedReports.filter((report) => report.generatedAt?.startsWith(today));
  const blockedToday = db.agentRunRecords.filter((run) => run.createdAt.startsWith(today) && run.result === 'blocked').length;
  const failedToday = db.agentRunRecords.filter((run) => run.createdAt.startsWith(today) && run.result === 'failed').length;

  if (!best || !bestStrategy) {
    return {
      createdAt: new Date().toISOString(),
      details: ['No verified live-candle backtest has been saved yet.', `${db.strategyResearchRecords.length} TradingView research records are saved.`, `${db.strategyRecords.filter((item) => item.agentSource?.sourceId.startsWith('agent-innovation:')).length} innovation strategies exist.`],
      id: `agent-progress-${Date.now()}`,
      marketsTested: [],
      nextAction: 'Run live-candle cron validation before ranking any strategy.',
      periodTested: 'Not tested',
      recommendations: ['No strategy should be promoted without calculated evidence.'],
      risks: ['No verified backtest evidence yet.'],
      status: 'needs_test',
      strategyId: strategy?.id ?? JIMMY_STRATEGY_ID,
      strengths: [],
      summary: [`Comprehension 100%: test strategies across top-100 cryptos, multiple timeframes, then score bot readiness without lying.`, `${todayReports.length} verified backtests today.`, 'No trusted best strategy yet.', `${blockedToday} blocked and ${failedToday} failed agent runs today.`],
      timeframesTested: [],
      usagePlan: ['No bot usage until calculated evidence exists.'],
      weaknesses: ['Evidence missing.'],
    };
  }

  const assessment = assessBotReadiness(best, db.agentSettingsRecord);

  return {
    botDecision: assessment.decision,
    botScore: assessment.score,
    createdAt: new Date().toISOString(),
    details: [
      `${todayReports.length} verified live-candle backtests today.`,
      `${db.strategyResearchRecords.length} TradingView research records saved.`,
      `${db.strategyRecords.filter((item) => item.agentSource?.sourceId.startsWith('agent-innovation:')).length} innovation strategies in the catalog.`,
      `Matrix coverage today: ${new Set(todayReports.map((report) => report.market)).size} cryptos and ${new Set(todayReports.map((report) => report.timeframe)).size} timeframes.`,
      `Bot decision: ${assessment.decision.replace(/_/g, ' ')}. ${assessment.reason}`,
      `Best evidence uses ${best.marketDataSource ?? 'unknown source'} with checksum ${best.dataWindow?.candleChecksum ?? 'missing'}.`,
    ],
    evidenceScore: assessment.evidenceScore,
    id: `agent-progress-${slug(bestStrategy.id)}-${Date.now()}`,
    marketsTested: [best.market ?? bestStrategy.market],
    nextAction: assessment.decision === 'bot_candidate' || assessment.decision === 'paper_test' ? 'Use as paper bot candidate only; live remains blocked until real paper validation.' : 'Continue searching, innovating and retesting before any bot.',
    periodTested: best.period,
    recommendations: topStrategyRecommendations(db).slice(0, 5),
    risks: [
      ...new Set([
        ...(best.warnings ?? []),
        ...assessment.blockers,
        blockedToday ? `${blockedToday} blocked agent run${blockedToday === 1 ? '' : 's'} today.` : '',
        failedToday ? `${failedToday} failed data or backtest run${failedToday === 1 ? '' : 's'} today.` : '',
      ].filter(Boolean)),
    ],
    status: assessment.decision === 'bot_candidate' ? 'bot_candidate' : assessment.decision === 'paper_test' ? 'paper_candidate' : assessment.decision === 'do_not_use' ? 'reject' : 'monitor',
    strategyId: bestStrategy.id,
    strengths: assessment.strengths,
    summary: [
      `Comprehension 100%: top-100 crypto matrix, multi-timeframe tests, bot score, strict no-lie evidence.`,
      `${todayReports.length} verified backtests today.`,
      `Best bot score: ${assessment.score}/100 for ${bestStrategy.name} on ${best.market ?? bestStrategy.market} ${best.timeframe ?? bestStrategy.timeframe}.`,
      `${best.profitFactor.toFixed(2)} PF, ${best.winRate.toFixed(1)}% WR, ${best.totalTrades} trades, ${best.drawdown.toFixed(1)}% DD, ${formatMoney(best.netProfit)} net.`,
      `${blockedToday} blocked and ${failedToday} failed agent runs today.`,
    ],
    timeframesTested: best.timeframe ? [best.timeframe] : [bestStrategy.timeframe],
    usagePlan: assessment.usagePlan,
    weaknesses: assessment.blockers.length ? assessment.blockers : ['Paper validation still missing.'],
  };
}

function agentReportFromBacktest(db: ThoonDb, strategy: Strategy, report: BacktestReport): AgentReport {
  const assessment = assessBotReadiness(report, db.agentSettingsRecord);
  const candidate = assessment.decision === 'bot_candidate' || assessment.decision === 'paper_test';

  return {
    backtestSummary: {
      drawdown: report.drawdown,
      netProfit: report.netProfit,
      period: report.period,
      profitFactor: report.profitFactor,
      totalTrades: report.totalTrades,
      winRate: report.winRate,
    },
    botDecision: assessment.decision,
    botScore: assessment.score,
    createdAt: new Date().toISOString(),
    details: [
      `Data source: ${report.marketDataSource ?? 'unknown'} via ${report.exchangeName ?? report.exchangeId ?? 'unknown exchange'}.`,
      `Window: ${report.dataWindow?.firstCandleAt ?? 'unknown'} to ${report.dataWindow?.lastCandleAt ?? 'unknown'}.`,
      `Checksum: ${report.dataWindow?.candleChecksum ?? 'missing'}.`,
      `Bot score: ${assessment.score}/100. ${assessment.reason}`,
      'No paper or live result is inferred from this backtest.',
    ],
    evidenceScore: assessment.evidenceScore,
    id: `agent-report-cron-${slug(strategy.id)}-${slug(report.market ?? strategy.market)}-${report.timeframe ?? strategy.timeframe}-${Date.now()}`,
    marketsTested: [report.market ?? strategy.market],
    nextAction: candidate ? 'Move to paper validation shortlist; live remains blocked.' : 'Keep testing variants, markets and timeframes before shortlisting.',
    periodTested: report.period,
    recommendations: [
      candidate ? 'Paper validate with the exact market, timeframe and risk below before any bot draft.' : 'Do not use as bot yet.',
      assessment.reason,
      report.totalTrades < db.agentSettingsRecord.limits.minTrades ? 'Increase sample size.' : 'Keep sample-size gate satisfied.',
    ],
    risks: [...(report.warnings ?? []), ...assessment.blockers],
    status: assessment.decision === 'bot_candidate' ? 'bot_candidate' : assessment.decision === 'paper_test' ? 'paper_candidate' : assessment.decision === 'do_not_use' ? 'reject' : 'monitor',
    strategyId: strategy.id,
    strengths: assessment.strengths,
    summary: [
      `${strategy.name} tested on ${report.market ?? strategy.market} ${report.timeframe ?? strategy.timeframe}.`,
      `Bot score ${assessment.score}/100, ${assessment.decision.replace(/_/g, ' ')}.`,
      `${report.profitFactor.toFixed(2)} PF, ${report.winRate.toFixed(1)}% WR, ${report.totalTrades} trades, ${report.drawdown.toFixed(1)}% max drawdown.`,
      `${report.candleCount ?? 0} live candles; source ${report.marketDataSource ?? 'unknown'}.`,
    ],
    timeframesTested: report.timeframe ? [report.timeframe] : [strategy.timeframe],
    usagePlan: assessment.usagePlan,
    weaknesses: assessment.blockers.length ? assessment.blockers : ['Paper validation missing.'],
  };
}

function createSystemAgentRun(db: ThoonDb, action: AgentAction, result: AgentRun['result'], notes: string): AgentRun {
  const allowed = result === 'completed' || result === 'queued' || result === 'waiting_for_confirmation';

  return {
    action,
    createdAt: new Date().toISOString(),
    decision: {
      action,
      allowed,
      blockers: allowed ? [] : [notes],
      policy: 'auto_allowed',
      requiredConfirmation: false,
      riskEngineResult: {
        allowed,
        checked: ['cron authorization', 'live market data', 'no synthetic fallback'],
      },
      warnings: result === 'failed' ? [notes] : [],
    },
    id: `agent-run-system-${slug(action)}-${Date.now()}`,
    mode: db.agentSettingsRecord.mode,
    notes,
    result,
    userConfirmed: false,
  };
}

function mergeLiveMarketPairs(current: MarketPair[], livePairs: MarketPair[]) {
  const bySymbol = new Map(current.map((pair) => [pair.symbol, pair]));

  for (const pair of livePairs.slice(0, agentCronTargetPairCount)) {
    const existing = bySymbol.get(pair.symbol);
    bySymbol.set(pair.symbol, {
      ...existing,
      ...pair,
      candles: [],
      draft: {
        ...(existing?.draft ?? pair.draft),
        ...pair.draft,
      },
      marketCap: pair.marketCap || existing?.marketCap || 0,
    });
  }

  return Array.from(bySymbol.values()).slice(0, agentCronTargetPairCount);
}

function mergeResearchRecords(current: StrategyResearchRecord[], incoming: StrategyResearchRecord[]) {
  const byUrl = new Map(current.map((record) => [record.url, record]));

  for (const record of incoming) {
    byUrl.set(record.url, record);
  }

  return Array.from(byUrl.values())
    .sort((left, right) => new Date(right.fetchedAt).getTime() - new Date(left.fetchedAt).getTime())
    .slice(0, 200);
}

function shouldRunTradingViewImportFromChat(message: string) {
  const normalized = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const mentionsTradingView = normalized.includes('tradingview') || normalized.includes('trading view') || /\btv\b/.test(normalized);
  const asksForImportOrResearch = ['chart', 'graphique', 'import', 'importe', 'importer', 'strategie', 'strategy', 'strategies', 'ta summary', 'analyse'].some((token) =>
    normalized.includes(token),
  );

  return mentionsTradingView && asksForImportOrResearch;
}

function mergeKronosForecastRecords(current: ThoonDb['kronosForecastRecords'], incoming: ThoonDb['kronosForecastRecords']) {
  const byId = new Map(current.map((record) => [record.id, record]));

  for (const record of incoming) {
    const existing = byId.get(record.id);
    byId.set(record.id, existing?.status === 'evaluated' && record.status !== 'evaluated' ? existing : record);
  }

  return Array.from(byId.values())
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 500);
}

function mergeStrategyRecords(current: Strategy[], incoming: Strategy[]) {
  const ids = new Set(current.map((strategy) => strategy.id));
  const fresh = incoming.filter((strategy) => !ids.has(strategy.id));

  return [...fresh, ...current];
}

function trustedCalculatedReports(reports: BacktestReport[]) {
  return reports.filter((report) => report.source === 'calculated' && Boolean(report.dataWindow?.candleChecksum) && Boolean(report.executionSettings) && Array.isArray(report.equityCurve) && report.equityCurve.length > 0);
}

function agentMatrixTimeframes(settings: ReturnType<typeof normalizeAgentSettings>) {
  const preferred: Timeframe[] = ['5m', '15m', '30m', '1h', '2h', '4h'];
  const allowed = preferred.filter((timeframe) => settings.limits.allowedTimeframes.includes(timeframe));

  return (allowed.length ? allowed : settings.limits.allowedTimeframes).slice(0, agentCronTimeframesPerSweep);
}

function backtestTargetKey(strategyId: string, market: string | undefined, timeframe: Timeframe | undefined) {
  return `${strategyId}:${market ?? 'market'}:${timeframe ?? 'tf'}`;
}

function pairTimeframeKey(market: string, timeframe: Timeframe) {
  return `${market}:${timeframe}`;
}

function kronosTargetRank(db: ThoonDb, market: string, timeframe: Timeframe) {
  const profile = getKronosLearningProfile(db.kronosForecastRecords);
  const record = db.kronosForecastRecords
    .filter((item) => item.market === market && item.timeframe === timeframe)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];

  if (!record || profile.evaluated < 4) {
    return 100;
  }

  const confidenceBoost = record.confidence * profile.confidenceWeight * 35;
  const directionBoost = record.predictedDirection === 'range' ? 0 : 8;
  const hitBoost = record.status === 'evaluated' && record.hit ? 8 : 0;

  return Math.max(0, Math.round(100 - confidenceBoost - directionBoost - hitBoost));
}

function assessBotReadiness(report: BacktestReport, settings: ReturnType<typeof normalizeAgentSettings>) {
  const profitable = report.netProfit > 0 && report.profitFactor > 1;
  const winrateRulePassed = profitable && (report.winRate >= 80 || report.winRate < 50);
  const enoughTrades = report.totalTrades >= settings.limits.minTrades;
  const drawdownOk = Math.abs(report.drawdown) <= settings.limits.maxDrawdownCandidate;
  const profitFactorOk = report.profitFactor >= settings.limits.minProfitFactor;
  const evidenceScore =
    (report.source === 'calculated' ? 4 : 0) +
    (report.marketDataSource === 'binance-live' || Boolean(report.marketDataSource?.endsWith('-public-rest')) ? 4 : 0) +
    (report.dataWindow?.candleChecksum ? 4 : 0) +
    (report.executionSettings ? 4 : 0) +
    (Array.isArray(report.equityCurve) && report.equityCurve.length > 0 ? 4 : 0);
  const profitScore = profitable ? Math.min(25, 8 + report.profitFactor * 7 + Math.max(0, Math.min(8, report.netProfit / 10))) : 0;
  const winrateScore = winrateRulePassed ? 20 : profitable ? 7 : 0;
  const drawdownScore = Math.max(0, 20 - (Math.abs(report.drawdown) / Math.max(settings.limits.maxDrawdownCandidate, 1)) * 20);
  const sampleScore = Math.min(15, (report.totalTrades / Math.max(settings.limits.minTrades, 1)) * 15);
  let score = Math.round(evidenceScore + profitScore + winrateScore + drawdownScore + sampleScore);
  const blockers: string[] = [];
  const strengths: string[] = [];

  if (!profitable) {
    blockers.push('Not profitable after fees and slippage.');
  } else {
    strengths.push(`${formatMoney(report.netProfit)} net profit after fees and slippage.`);
  }

  if (!winrateRulePassed) {
    blockers.push(`Winrate rule failed: ${report.winRate.toFixed(1)}% WR. Bot candidates must be profitable with >=80% WR, or profitable with <50% WR and positive expectancy.`);
  } else if (report.winRate >= 80) {
    strengths.push('High-winrate profitable profile.');
  } else {
    strengths.push('Low-winrate positive-expectancy profile.');
  }

  if (!enoughTrades) {
    blockers.push(`Sample too small: ${report.totalTrades}/${settings.limits.minTrades} trades.`);
  } else {
    strengths.push('Minimum trade sample reached.');
  }

  if (!drawdownOk) {
    blockers.push(`Drawdown too high: ${report.drawdown.toFixed(1)}% vs ${settings.limits.maxDrawdownCandidate}% max.`);
  } else {
    strengths.push('Drawdown inside candidate limit.');
  }

  if (!profitFactorOk) {
    blockers.push(`Profit factor below minimum: ${report.profitFactor.toFixed(2)} vs ${settings.limits.minProfitFactor.toFixed(2)}.`);
  } else {
    strengths.push('Profit factor gate passed.');
  }

  if (evidenceScore < 20) {
    blockers.push('Evidence incomplete: source, checksum, execution settings or equity curve missing.');
  }

  if (!profitable) {
    score = Math.min(score, 49);
  } else if (!winrateRulePassed) {
    score = Math.min(score, 69);
  } else if (!enoughTrades || !drawdownOk || !profitFactorOk || evidenceScore < 20) {
    score = Math.min(score, 79);
  }

  const decision =
    !profitable || evidenceScore < 16
      ? ('do_not_use' as const)
      : winrateRulePassed && enoughTrades && drawdownOk && profitFactorOk && score >= 85
        ? ('bot_candidate' as const)
        : winrateRulePassed && enoughTrades && drawdownOk && profitFactorOk
          ? ('paper_test' as const)
          : ('watch' as const);
  const usagePlan =
    decision === 'bot_candidate' || decision === 'paper_test'
      ? [
          `Paper bot only on ${report.market ?? 'tested market'} ${report.timeframe ?? 'tested timeframe'}.`,
          `Use the exact execution settings from the report: ${report.executionSettings?.marketType ?? 'market'} ${report.executionSettings?.directionMode ?? 'direction'}, ${report.executionSettings?.riskPerTradePct ?? 0}% risk, ${report.executionSettings?.leverage ?? 1}x max leverage.`,
          'Require stop-loss, keep live trading blocked, and compare paper trades against this backtest before promotion.',
        ]
      : ['Do not run as bot yet. Keep researching, innovating and retesting until score and blockers improve.'];

  return {
    blockers,
    decision,
    evidenceScore,
    reason:
      decision === 'bot_candidate'
        ? 'Worth paper-bot testing under strict risk controls.'
        : decision === 'paper_test'
          ? 'Worth paper validation, not live automation.'
          : decision === 'watch'
            ? 'Promising enough to watch, but not eligible for a bot yet.'
            : 'Not worth using as a bot from current evidence.',
    score: Math.max(0, Math.min(100, score)),
    strengths,
    usagePlan,
    winrateRulePassed,
  };
}

function topStrategyRecommendations(db: ThoonDb) {
  const strategies = buildVisibleStrategyRecords(db.strategyRecords, db.strategyResearchRecords);

  return trustedCalculatedReports(db.backtestReportRecords)
    .slice()
    .filter((report) => {
      const assessment = assessBotReadiness(report, db.agentSettingsRecord);

      return assessment.decision === 'paper_test' || assessment.decision === 'bot_candidate';
    })
    .sort((left, right) => assessBotReadiness(right, db.agentSettingsRecord).score - assessBotReadiness(left, db.agentSettingsRecord).score)
    .slice(0, 5)
    .map((report) => {
      const strategy = strategies.find((item) => item.id === report.strategyId);
      const assessment = assessBotReadiness(report, db.agentSettingsRecord);

      return `${strategy?.name ?? report.strategyId}: score ${assessment.score}/100, ${report.market ?? strategy?.market ?? 'market'} ${report.timeframe ?? strategy?.timeframe ?? 'tf'}, ${report.profitFactor.toFixed(2)} PF, ${report.winRate.toFixed(1)}% WR, ${report.totalTrades} trades, ${report.drawdown.toFixed(1)}% DD`;
    });
}

function selectPaperTestReport(db: ThoonDb, strategy: Strategy, reportId?: string) {
  const reports = trustedCalculatedReports(db.backtestReportRecords).filter((report) => report.strategyId === strategy.id);
  const selected = reportId ? reports.find((report) => report.id === reportId) : undefined;
  const report =
    selected ??
    reports
      .slice()
      .sort((left, right) => assessBotReadiness(right, db.agentSettingsRecord).score - assessBotReadiness(left, db.agentSettingsRecord).score)[0];

  if (!report) {
    throw new ApiError('Paper test blocked: no trusted calculated backtest with candle checksum exists for this strategy.', 403);
  }

  return report;
}

function createPaperTestSession(strategy: Strategy, report: BacktestReport, assessment: ReturnType<typeof assessBotReadiness>): PaperTestSession {
  const now = new Date().toISOString();
  const market = report.market ?? strategy.market;
  const timeframe = report.timeframe ?? strategy.timeframe;

  return {
    blockers: assessment.blockers,
    botDecision: assessment.decision === 'bot_candidate' ? 'bot_candidate' : 'paper_test',
    botScore: assessment.score,
    candleChecksum: report.dataWindow?.candleChecksum ?? '',
    createdAt: now,
    dataSource: report.marketDataSource ?? 'unknown',
    id: `paper-session-${slug(strategy.id)}-${slug(market)}-${timeframe}-${slug(report.id)}`,
    market,
    notes: [
      `Prepared from verified backtest ${report.id}.`,
      `Use exact settings: ${report.executionSettings?.marketType ?? 'market'} ${report.executionSettings?.directionMode ?? 'direction'}, ${report.executionSettings?.riskPerTradePct ?? 0}% risk, ${report.executionSettings?.leverage ?? 1}x leverage.`,
    ],
    pnl: 0,
    reportId: report.id,
    rMultiple: 0,
    status: 'prepared',
    strategyId: strategy.id,
    timeframe,
    tradesRecorded: 0,
    updatedAt: now,
    usagePlan: assessment.usagePlan,
  };
}

function isMarketAllowedByAgent(settings: ReturnType<typeof normalizeAgentSettings>, market: string) {
  return settings.limits.allowedMarkets.length === 0 || settings.limits.allowedMarkets.includes(market);
}

function formatMoney(value: number) {
  const sign = value < 0 ? '-' : '';

  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function executeAgentAction(
  db: ThoonDb,
  action: AgentAction,
  strategy?: Strategy,
  version?: ThoonDb['strategyVersionRecords'][number],
  aiSuggestionResult?: Awaited<ReturnType<typeof generateAiStrategySuggestions>>,
  agentBacktestReport?: BacktestReport,
  tradingViewResearchResult?: Awaited<ReturnType<typeof researchTradingViewStrategies>>,
  reportId?: string,
) {
  if (!strategy && action !== 'compare_versions') {
    throw new ApiError('Strategy not found', 404);
  }

  switch (action) {
    case 'analyze_strategy': {
      const suggestions = aiSuggestionResult?.suggestions.length ? aiSuggestionResult.suggestions : buildAgentSuggestions(db, strategy?.id);
      db.agentSuggestionRecords = [...suggestions, ...db.agentSuggestionRecords.filter((suggestion) => suggestion.strategyId !== strategy?.id)].slice(0, 60);

      return {
        notes: aiSuggestionResult ? `Analysis refreshed with ${aiSuggestionResult.provider.provider} provider.` : 'Analysis refreshed with local rules.',
        payload: {
          provider: aiSuggestionResult?.provider ?? getStrategyAgentAiStatus(),
          researchPlan: 'sweep markets, timeframes and parameters before ranking candidates',
          suggestions,
          summary: aiSuggestionResult?.summary,
        },
      };
    }
    case 'compare_versions': {
      const versions = strategy ? db.strategyVersionRecords.filter((item) => item.strategyId === strategy.id) : db.strategyVersionRecords;

      return { notes: 'Versions compared by robustness score.', payload: { comparison: compareVersions(versions) } };
    }
    case 'create_variant': {
      const nextVersion = createVariant(db, strategy as Strategy, version);
      db.strategyVersionRecords = [nextVersion, ...db.strategyVersionRecords];

      return { notes: `${nextVersion.version} created as draft variant.`, payload: { version: nextVersion } };
    }
    case 'prepare_backtest':
      return {
        notes: 'Backtest prepared.',
        payload: { href: `/backtest?strategyId=${encodeURIComponent((strategy as Strategy).id)}` },
      };
    case 'run_backtest': {
      const report = agentBacktestReport;

      if (!report) {
        throw new ApiError('Backtest could not be calculated for this strategy.', 502);
      }

      db.backtestReportRecords = [report, ...db.backtestReportRecords];

      if (version) {
        db.strategyVersionRecords = db.strategyVersionRecords.map((item) => (item.id === version.id ? updateVersionWithBacktest(item, report, db.agentSettingsRecord.limits.minTrades) : item));
      }

      return { notes: `Calculated backtest saved with ${report.candleCount ?? 0} candles.`, payload: { report } };
    }
    case 'read_backtest': {
      const report = db.backtestReportRecords.find((item) => item.strategyId === strategy?.id);

      return { notes: report ? 'Backtest summary read.' : 'No backtest found.', payload: { report } };
    }
    case 'research_tradingview': {
      const research = tradingViewResearchResult;

      if (!research) {
        throw new ApiError('TradingView public research could not be completed.', 502);
      }

      const existingByUrl = new Map(db.strategyResearchRecords.map((record) => [record.url, record]));
      for (const record of research.records) {
        existingByUrl.set(record.url, record);
      }
      db.strategyResearchRecords = Array.from(existingByUrl.values())
        .sort((left, right) => new Date(right.fetchedAt).getTime() - new Date(left.fetchedAt).getTime())
        .slice(0, 80);

      return {
        notes: `${research.records.length} public TradingView strategy records saved.`,
        payload: { errors: research.errors, fetchedAt: research.fetchedAt, records: research.records, searchedQueries: research.searchedQueries },
      };
    }
    case 'run_paper_test':
    case 'send_to_paper': {
      const report = selectPaperTestReport(db, strategy as Strategy, reportId);
      const assessment = assessBotReadiness(report, db.agentSettingsRecord);

      if (assessment.decision !== 'bot_candidate' && assessment.decision !== 'paper_test') {
        throw new ApiError(`Paper test blocked: ${assessment.reason}`, 403);
      }

      const market = report.market ?? (strategy as Strategy).market;
      const timeframe = report.timeframe ?? (strategy as Strategy).timeframe;
      const session = createPaperTestSession(strategy as Strategy, report, assessment);
      db.paperTestSessionRecords = [session, ...db.paperTestSessionRecords.filter((record) => record.id !== session.id)].slice(0, 120);

      return {
        notes: `Paper test prepared for ${market} ${timeframe}: score ${assessment.score}/100. No paper performance is recorded until trades are actually executed.`,
        payload: {
          href: `/backtest/replay?pair=${encodeURIComponent(market)}&strategyId=${encodeURIComponent((strategy as Strategy).id)}&timeframe=${encodeURIComponent(timeframe)}&reportId=${encodeURIComponent(report.id)}&sessionId=${encodeURIComponent(session.id)}`,
          recommendation: {
            blockers: assessment.blockers,
            decision: assessment.decision,
            market,
            reason: assessment.reason,
            reportId: report.id,
            score: assessment.score,
            timeframe,
            usagePlan: assessment.usagePlan,
          },
          session,
          version,
        },
      };
    }
    case 'prepare_bot': {
      const report = selectPaperTestReport(db, strategy as Strategy, reportId);
      const market = report.market ?? (strategy as Strategy).market;
      const timeframe = report.timeframe ?? (strategy as Strategy).timeframe;

      return {
        notes: 'Paper bot draft prepared.',
        payload: { href: `/bots/new?strategyId=${encodeURIComponent((strategy as Strategy).id)}&pair=${encodeURIComponent(market)}&timeframe=${encodeURIComponent(timeframe)}&reportId=${encodeURIComponent(report.id)}` },
      };
    }
    case 'create_draft_bot': {
      const report = selectPaperTestReport(db, strategy as Strategy, reportId);
      const bot = createDraftBotFromVersion(strategy as Strategy, version);
      bot.symbol = report.market ?? bot.symbol;
      bot.riskPerTrade = report.executionSettings?.riskPerTradePct ?? bot.riskPerTrade;
      bot.sourceBacktestPeriod = report.period;
      bot.sourceBacktestReportId = report.id;
      bot.sourceCandleChecksum = report.dataWindow?.candleChecksum;
      bot.sourceExchangeId = report.exchangeId;
      bot.sourceExchangeName = report.exchangeName;
      bot.sourceExecutionSettings = report.executionSettings;
      bot.sourceFeesPct = report.feesPct;
      bot.sourceInitialCapital = report.initialCapital;
      bot.sourceMarketDataSource = report.marketDataSource;
      bot.sourceSlippagePct = report.slippagePct;
      bot.sourceTimeframe = report.timeframe;
      db.botRecords = [bot, ...db.botRecords];
      db.botLogRecords = [
        {
          botId: bot.id,
          id: `blog-agent-${Date.now()}`,
          level: 'info',
          message: 'Agent created paper draft bot after guard checks.',
          time: new Date().toISOString(),
        },
        ...db.botLogRecords,
      ];

      return { notes: 'Paper draft bot created.', payload: { bot } };
    }
    case 'create_report': {
      const report = createAgentReport(db, strategy as Strategy, version);
      if (aiSuggestionResult?.summary.length) {
        report.summary = aiSuggestionResult.summary.slice(0, 5);
      }
      db.agentReportRecords = [report, ...db.agentReportRecords].slice(0, 40);

      return { notes: aiSuggestionResult ? `Compact report created with ${aiSuggestionResult.provider.provider} provider.` : 'Compact report created.', payload: { provider: aiSuggestionResult?.provider ?? getStrategyAgentAiStatus(), report } };
    }
    case 'write_journal_note': {
      const report = db.agentReportRecords.find((item) => item.strategyId === strategy?.id);
      const note = createAgentJournalNote(strategy as Strategy, report);
      db.journalTradeRecords = [note, ...db.journalTradeRecords].slice(0, 80);

      return { notes: 'Agent journal note saved.', payload: { note } };
    }
    case 'promote_version': {
      if (!version) {
        throw new ApiError('Strategy version not found', 404);
      }

      const nextVersion = promoteVersion(version);
      db.strategyVersionRecords = db.strategyVersionRecords.map((item) => (item.id === nextVersion.id ? nextVersion : item));

      return { notes: `${nextVersion.version} promotion reviewed.`, payload: { version: nextVersion } };
    }
    case 'archive_variant': {
      if (!version) {
        throw new ApiError('Strategy version not found', 404);
      }

      const nextVersion = archiveVersion(version);
      db.strategyVersionRecords = db.strategyVersionRecords.map((item) => (item.id === nextVersion.id ? nextVersion : item));

      return { notes: nextVersion.protectedOriginal ? 'Protected original remained active.' : `${nextVersion.version} archived.`, payload: { version: nextVersion } };
    }
    case 'execute_live_trade':
    case 'launch_live_bot':
      throw new ApiError('Live Strategy Agent actions are blocked.', 403);
  }
}

function agentDashboard(db: ThoonDb, strategyId?: string) {
  const versions = strategyId ? db.strategyVersionRecords.filter((version) => version.strategyId === strategyId) : db.strategyVersionRecords;
  const runs = strategyId ? db.agentRunRecords.filter((run) => run.strategyId === strategyId) : db.agentRunRecords;
  const suggestions = strategyId ? db.agentSuggestionRecords.filter((suggestion) => suggestion.strategyId === strategyId) : db.agentSuggestionRecords;
  const reports = strategyId ? db.agentReportRecords.filter((report) => report.strategyId === strategyId) : db.agentReportRecords;
  const queue = strategyId ? db.agentQueueRecords.filter((task) => task.strategyId === strategyId) : db.agentQueueRecords;
  const research = strategyId ? db.strategyResearchRecords.filter((record) => record.strategyId === strategyId) : db.strategyResearchRecords;
  const paperTests = strategyId ? db.paperTestSessionRecords.filter((record) => record.strategyId === strategyId) : db.paperTestSessionRecords;

  return {
    ai: getStrategyAgentAiStatus(),
    kronosLearning: {
      profile: getKronosLearningProfile(db.kronosForecastRecords),
      records: db.kronosForecastRecords.slice(0, 80),
    },
    paperTests,
    reports,
    research,
    runs,
    queue,
    settings: db.agentSettingsRecord,
    stats: {
      blocked: runs.filter((run) => run.result === 'blocked').length,
      candidateVersions: versions.filter((version) => version.status === 'candidate' || version.status === 'live-ready').length,
      protectedVersions: versions.filter((version) => version.protectedOriginal).length,
      reports: reports.length,
      research: research.length,
      suggestions: suggestions.length,
      paperTests: paperTests.length,
      tasks: queue.length,
      versions: versions.length,
    },
    suggestions,
    versions,
  };
}

function buildAgentChatSnapshot(db: ThoonDb) {
  const strategies = buildVisibleStrategyRecords(db.strategyRecords, db.strategyResearchRecords);
  const calculatedReports = db.backtestReportRecords
    .filter((report) => report.source === 'calculated')
    .slice()
    .sort((left, right) => assessBotReadiness(right, db.agentSettingsRecord).score - assessBotReadiness(left, db.agentSettingsRecord).score || right.netProfit - left.netProfit)
    .slice(0, 12);

  return {
    ai: getStrategyAgentAiStatus(),
    app: {
      mode: getThoonServerEnv().appMode,
      liveExchangeProvider: getThoonServerEnv().liveExchangeProvider,
      marketDataProvider: getThoonServerEnv().marketDataProvider,
      release: getThoonServerEnv().release,
    },
    kronos: getKronosIntegrationProfile(),
    kronosLearning: {
      profile: getKronosLearningProfile(db.kronosForecastRecords),
      recent: db.kronosForecastRecords.slice(0, 16).map((record) => ({
        confidence: record.confidence,
        hit: record.hit,
        market: record.market,
        predictedDirection: record.predictedDirection,
        realizedDirection: record.realizedDirection,
        status: record.status,
        timeframe: record.timeframe,
        weightAtCreation: record.weightAtCreation,
      })),
    },
    tradingViewMcp: getTradingViewMcpProfile(),
    queue: db.agentQueueRecords.slice(0, 10).map((task) => ({
      action: task.action,
      nextAction: task.nextAction,
      priority: task.priority,
      result: task.result,
      status: task.status,
      strategyId: task.strategyId,
    })),
    recentRuns: db.agentRunRecords.slice(0, 12).map((run) => ({
      action: run.action,
      createdAt: run.createdAt,
      notes: run.notes,
      result: run.result,
      strategyId: run.strategyId,
    })),
    reports: db.agentReportRecords.slice(0, 10).map((report) => ({
      botDecision: report.botDecision,
      botScore: report.botScore,
      nextAction: report.nextAction,
      status: report.status,
      strategyId: report.strategyId,
      summary: report.summary,
    })),
    topBacktests: calculatedReports.map((report) => ({
      botScore: assessBotReadiness(report, db.agentSettingsRecord).score,
      drawdown: report.drawdown,
      id: report.id,
      market: report.market,
      netProfit: report.netProfit,
      profitFactor: report.profitFactor,
      strategyId: report.strategyId,
      timeframe: report.timeframe,
      totalTrades: report.totalTrades,
      winRate: report.winRate,
    })),
    strategies: strategies.slice(0, 40).map((strategy) => ({
      id: strategy.id,
      market: strategy.market,
      name: strategy.name,
      sourceId: strategy.agentSource?.sourceId,
      status: strategy.status,
      timeframe: strategy.timeframe,
      type: strategy.type,
    })),
    tradingViewResearch: db.strategyResearchRecords.slice(0, 16).map((record) => ({
      concepts: record.concepts,
      fetchedAt: record.fetchedAt,
      provider: record.provider,
      scriptType: record.scriptType,
      sourcePolicy: record.sourcePolicy,
      sourceVisibility: record.sourceVisibility,
      strategyId: record.strategyId,
      title: record.title,
      url: record.url,
    })),
    updatedAt: db.updatedAt,
  };
}


async function handleApiError(request: NextRequest, handler: () => Promise<NextResponse>) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  let response: NextResponse;

  try {
    response = await runWithAuditContext({ ipAddress: clientIp(request), requestId }, handler);
  } catch (error) {
    incrementMetric('apiErrors');

    if (error instanceof ApiError) {
      response = json({ error: error.message }, error.status);
    } else {
      logServerEvent('error', 'api.unhandled_error', { error: error instanceof Error ? error.message : String(error), requestId });
      response = json({ error: 'Internal server error' }, 500);
    }
  }

  response.headers.set('X-Thoon-Release', getThoonServerEnv().release);
  response.headers.set('X-Thoon-Request-Id', requestId);
  observeApiResponse({
    durationMs: Date.now() - startedAt,
    method: request.method,
    path: request.nextUrl.pathname,
    requestId,
    status: response.status,
  });

  return response;
}

async function durableMutation(handler: () => Promise<NextResponse>) {
  const response = await handler();

  await flushPendingPostgresMirror();

  return response;
}

function readGuard(request: NextRequest, path: string[]) {
  if (isPublicReadPath(path) || isAgentCronPath(path)) {
    return null;
  }

  const session = getSessionFromRequest(request);

  if (isAuthRequired() && !session) {
    incrementMetric('authFailures');
    return json({ error: 'Authentication required.' }, 401);
  }

  return null;
}

function isPublicReadPath(path: string[]) {
  return path[0] === 'auth' && path[1] === 'session';
}

function notFound(path: string[]) {
  return json({ error: `Unknown API route: /api/${path.join('/')}` }, 404);
}

function mutationGuard(request: NextRequest, path: string[]) {
  const origin = request.headers.get('origin');

  if (origin && origin !== request.nextUrl.origin && !isEquivalentLocalOrigin(origin, request.nextUrl.origin)) {
    return json({ error: 'Cross-origin mutation blocked.' }, 403);
  }

  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return json({ error: 'Cross-site mutation blocked.' }, 403);
  }

  const cronAuthorization = cronAuthorizationState(request, path);

  if (cronAuthorization === 'authorized') {
    return null;
  }

  if (cronAuthorization) {
    return cronAuthorization;
  }

  if (path[0] === 'auth') {
    return null;
  }

  const session = getSessionFromRequest(request);

  if (isAuthRequired() && !session) {
    incrementMetric('authFailures');
    return json({ error: 'Authentication required.' }, 401);
  }

  return mutationRateLimit(request, path, session?.email);
}

function cronRequestGuard(request: NextRequest, path: string[]) {
  const cronAuthorization = cronAuthorizationState(request, path);

  if (cronAuthorization === 'authorized') {
    return null;
  }

  if (cronAuthorization) {
    return cronAuthorization;
  }

  if (!isAuthRequired()) {
    return null;
  }

  const session = getSessionFromRequest(request);

  if (!session) {
    incrementMetric('authFailures');
    return json({ error: 'Authentication required.' }, 401);
  }

  return null;
}

function cronAuthorizationState(request: NextRequest, path: string[]): NextResponse | 'authorized' | null {
  if (!isAgentCronPath(path)) {
    return null;
  }

  const env = getThoonServerEnv();
  const cronSecretRequired =
    env.nodeEnv === 'production' ||
    env.authMode === 'local-required' ||
    env.appMode === 'live-enabled' ||
    Boolean(env.productionBaseUrl) ||
    env.release !== 'local';

  if (!env.cronSecret && cronSecretRequired) {
    return json({ error: 'THOON_CRON_SECRET is required before scheduled agent cron can run in protected runtimes.' }, 503);
  }

  if (!env.cronSecret) {
    return null;
  }

  return request.headers.get('authorization') === `Bearer ${env.cronSecret}` ? 'authorized' : json({ error: 'Invalid cron authorization.' }, 401);
}

function isAgentCronPath(path: string[]) {
  return path[0] === 'agent' && (path[1] === 'cron' || path[1] === 'progress');
}

function mutationRateLimit(request: NextRequest, path: string[], actor?: string) {
  const env = getThoonServerEnv();

  if (!env.rateLimitEnabled) {
    return null;
  }

  const result = checkRateLimit({
    key: `${clientIp(request)}:${actor ?? 'anonymous'}`,
    limit: env.mutationRateLimitMax,
    name: `mutation:${path[0] ?? 'root'}`,
    windowMs: env.mutationRateLimitWindowSeconds * 1000,
  });

  if (result.allowed) {
    return null;
  }

  incrementMetric('rateLimitedRequests');
  logServerEvent('warn', 'api.rate_limited', {
    method: request.method,
    path: request.nextUrl.pathname,
    resetAt: result.resetAt,
  });

  return json(
    {
      error: 'Too many API mutations. Try again shortly.',
      retryAfterSeconds: result.retryAfterSeconds,
    },
    429,
    rateLimitHeaders(result),
  );
}

function isEquivalentLocalOrigin(left: string, right: string) {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

    return leftUrl.protocol === rightUrl.protocol && leftUrl.port === rightUrl.port && localHosts.has(leftUrl.hostname) && localHosts.has(rightUrl.hostname);
  } catch {
    return false;
  }
}

async function routePath(context: RouteContext) {
  const params = await context.params;
  return params.path ?? [];
}

async function readJson(request: NextRequest) {
  const text = await request.text();

  if (!text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as unknown;

    if (!isRecord(parsed)) {
      throw new ApiError('JSON request body must be an object.', 400);
    }

    return parsed;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError('Malformed JSON request body.', 400);
  }
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown, fallback: number) {
  const nextValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

function normalizeStrategyId(value: string | undefined, db: ThoonDb) {
  if (!value || JIMMY_LEGACY_STRATEGY_IDS.includes(value)) {
    return JIMMY_STRATEGY_ID;
  }

  return findVisibleStrategyRecord(db.strategyRecords, db.strategyResearchRecords, value)?.id ?? JIMMY_STRATEGY_ID;
}

function isExecutableBacktestStrategy(strategy: Strategy) {
  return isExecutableStrategy(strategy);
}

function positiveValue(value: unknown, fallback: number) {
  return boundedNumber(value, 0, maximumNumericInput, fallback);
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number) {
  const nextValue = asNumber(value, fallback);

  if (!Number.isFinite(nextValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, nextValue));
}

function extractFirstNumber(value: string | undefined) {
  const match = value?.match(/(\d+(?:\.\d+)?)/);
  const parsed = match ? Number(match[1]) : 0;

  return Number.isFinite(parsed) ? parsed : 0;
}

function extractAtrTrailingStop(value: string | undefined, fallback: number) {
  const explicitAtr =
    value?.match(/(?:trail(?:ing)?(?:\s+stop)?\s*)?(\d+(?:\.\d+)?)\s*x?\s*atr/i)?.[1] ??
    value?.match(/atr\s*(\d+(?:\.\d+)?)x/i)?.[1] ??
    value?.match(/trail(?:ing)?(?:\s+stop)?\s*(\d+(?:\.\d+)?)\s*x/i)?.[1];
  const parsed = explicitAtr ? Number(explicitAtr) : fallback;

  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInteger(value: unknown, fallback: number | undefined) {
  const nextValue = Math.floor(asNumber(value, fallback ?? 0));

  return nextValue > 0 ? nextValue : fallback;
}

function normalizeCandleLimit(value: string | null) {
  const requestedLimit = positiveInteger(value, undefined);

  if (!requestedLimit) {
    return undefined;
  }

  const envLimit = Math.floor(getThoonServerEnv().marketKlineLimit);
  const configuredLimit = Number.isFinite(envLimit) && envLimit > 0 ? envLimit : maximumCandleLimit;

  return Math.min(requestedLimit, maximumCandleLimit, configuredLimit);
}

function desiredBacktestCandleLimit(period: string, timeframe: Timeframe) {
  const daysByPeriod: Record<string, number> = {
    '30D': 30,
    '90D': 90,
    '180D': 180,
    '1Y': 365,
  };
  const minutesByTimeframe: Record<Timeframe, number> = {
    '1M': 43_200,
    '1d': 1_440,
    '1h': 60,
    '1m': 1,
    '1w': 10_080,
    '1y': 525_600,
    '2h': 120,
    '30m': 30,
    '4h': 240,
    '5m': 5,
    '15m': 15,
  };
  const requested = Math.ceil(((daysByPeriod[period] ?? 90) * 1_440) / minutesByTimeframe[timeframe]);

  return Math.min(10_000, Math.max(240, requested + 80));
}

function normalizeAgentAction(value: unknown): AgentAction | undefined {
  const action = asString(value) as AgentAction;
  const actions: AgentAction[] = [
    'analyze_strategy',
    'archive_variant',
    'compare_versions',
    'create_draft_bot',
    'create_report',
    'create_variant',
    'execute_live_trade',
    'launch_live_bot',
    'prepare_backtest',
    'prepare_bot',
    'promote_version',
    'read_backtest',
    'research_tradingview',
    'run_backtest',
    'run_paper_test',
    'send_to_paper',
    'write_journal_note',
  ];

  return actions.includes(action) ? action : undefined;
}

function createAgentRunBase(db: ThoonDb, action: AgentAction, decision: ReturnType<typeof evaluateAgentAction>, strategyId?: string, versionId?: string, confirmed = false): Omit<AgentRun, 'notes' | 'result'> {
  return {
    action,
    createdAt: new Date().toISOString(),
    decision,
    id: `agent-run-${slug(action)}-${Date.now()}`,
    mode: db.agentSettingsRecord.mode,
    permission: decision.permission,
    strategyId,
    userConfirmed: confirmed,
    versionId,
  };
}

function latestStrategyVersion(db: ThoonDb, strategyId: string) {
  return db.strategyVersionRecords.find((version) => version.strategyId === strategyId && !version.protectedOriginal) ?? db.strategyVersionRecords.find((version) => version.strategyId === strategyId);
}

function dangerousAgentAction(action: AgentAction) {
  return action === 'archive_variant' || action === 'promote_version' || action === 'execute_live_trade' || action === 'launch_live_bot';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';
}

function normalizeTimeframe(value: unknown): Strategy['timeframe'] {
  return isTimeframe(value) ? value : '15m';
}

function isTimeframe(value: unknown): value is Timeframe {
  return value === '1m' || value === '5m' || value === '15m' || value === '30m' || value === '1h' || value === '2h' || value === '4h' || value === '1d' || value === '1w' || value === '1M' || value === '1y';
}

function marketDataType(value: unknown) {
  return value === 'perpetual' || value === 'futures' ? 'perpetual' : 'spot';
}

function normalizeStrategyType(value: unknown): Strategy['type'] {
  return value === 'breakout' || value === 'mean-reversion' || value === 'grid' ? value : 'trend';
}

function normalizeStrategyConditions(value: unknown, fallback: StrategyCondition[]): StrategyCondition[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const conditions = value
    .filter(isRecord)
    .map((condition, index): StrategyCondition => {
      const connector = condition.connector === 'AND' || condition.connector === 'OR' || condition.connector === 'IF' ? condition.connector : index === 0 ? 'IF' : 'AND';
      const operator =
        condition.operator === 'crosses-above' || condition.operator === 'crosses-below' || condition.operator === 'greater-than' || condition.operator === 'less-than'
          ? condition.operator
          : 'greater-than';

      return {
        connector,
        field: asString(condition.field) || 'Price',
        id: asString(condition.id) || `condition-${Date.now()}-${index}`,
        operator,
        value: asString(condition.value) || 'Market',
      };
    });

  return conditions.length ? conditions : fallback;
}

function defaultStrategyConditions(kind: 'entry' | 'exit'): StrategyCondition[] {
  if (kind === 'entry') {
    return [
      { connector: 'IF', field: 'Price', id: 'entry-default-1', operator: 'crosses-above', value: 'EMA 50' },
      { connector: 'AND', field: 'Volume', id: 'entry-default-2', operator: 'greater-than', value: '20D avg' },
    ];
  }

  return [
    { connector: 'IF', field: 'Price', id: 'exit-default-1', operator: 'crosses-below', value: 'EMA 20' },
    { connector: 'OR', field: 'R/R', id: 'exit-default-2', operator: 'greater-than', value: '2R' },
  ];
}

function normalizeStrategyRiskSettings(value: unknown, fallback?: StrategyRiskSettings): StrategyRiskSettings {
  const record = isRecord(value) ? value : {};

  return {
    accountBalance: positiveValue(record.accountBalance, fallback?.accountBalance ?? 10000),
    maxOpenTrades: positiveValue(record.maxOpenTrades, fallback?.maxOpenTrades ?? 3),
    positionSizing: asString(record.positionSizing) || fallback?.positionSizing || 'risk-percent',
    rrTarget: positiveValue(record.rrTarget, fallback?.rrTarget ?? 2),
    stopLoss: asString(record.stopLoss) || fallback?.stopLoss || 'Required',
    stopRequired: typeof record.stopRequired === 'boolean' ? record.stopRequired : fallback?.stopRequired ?? true,
    takeProfit: asString(record.takeProfit) || fallback?.takeProfit || '2R',
    trailingStop: typeof record.trailingStop === 'boolean' ? record.trailingStop : fallback?.trailingStop ?? true,
  };
}

function normalizePositionDraft(value: unknown): PositionDraft | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    direction: value.direction === 'short' ? 'short' : 'long',
    entry: positiveValue(value.entry, 0),
    riskPercent: positiveValue(value.riskPercent, 1),
    size: positiveValue(value.size, 0),
    stopLoss: positiveValue(value.stopLoss, 0),
    takeProfit: positiveValue(value.takeProfit, 0),
  };
}

function normalizeSetupSnapshot(value: unknown): Strategy['setupSnapshot'] {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    drawings: Array.isArray(value.drawings) ? value.drawings : [],
    markers: Array.isArray(value.markers) ? value.markers : [],
    notes: asString(value.notes),
    savedSetupId: asString(value.savedSetupId) || undefined,
  };
}

function normalizeAlertType(value: unknown): Alert['type'] {
  return value === 'zone' || value === 'indicator' || value === 'strategy' || value === 'bot' || value === 'webhook' ? value : 'price';
}

function normalizePermissions(value: unknown): ApiKeyRecord['permissions'] {
  if (!Array.isArray(value)) {
    return ['read'];
  }

  const permissions = value.filter((item): item is 'read' | 'trade' => item === 'read' || item === 'trade');
  return permissions.length ? permissions : ['read'];
}

function normalizeWalletChain(value: unknown): WalletConnection['chain'] {
  const chain = asString(value).toLowerCase();

  if (chain === 'cosmos' || chain === 'evm' || chain === 'multi' || chain === 'solana') {
    return chain;
  }

  return 'evm';
}

function normalizeWalletNetworks(networksValue: unknown, networkValue: unknown) {
  const networks = Array.isArray(networksValue) ? networksValue.map((item) => asString(item)).filter(Boolean) : [];
  const network = asString(networkValue);

  if (network) {
    networks.unshift(network);
  }

  return Array.from(new Set(networks)).slice(0, 8);
}

function isLikelyWalletAddress(address: string, chain: WalletConnection['chain']) {
  if (chain === 'evm') {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  if (chain === 'solana') {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }

  if (chain === 'cosmos') {
    return /^[a-z0-9]{2,16}1[ac-hj-np-z02-9]{20,80}$/i.test(address);
  }

  return address.length >= 20 && address.length <= 120;
}

function normalizeBotAction(value: unknown): 'pause' | 'start' | 'stop' | undefined {
  const action = asString(value);

  return action === 'pause' || action === 'start' || action === 'stop' ? action : undefined;
}

function normalizeBacktestExecutionSettings(value: unknown, strategy: Strategy): BacktestExecutionSettings {
  const record = isRecord(value) ? value : {};
  const riskSettings = strategy.riskSettings;

  return {
    directionMode: record.directionMode === 'long-only' || record.directionMode === 'short-only' ? record.directionMode : 'both',
    leverage: boundedNumber(record.leverage, 1, 125, 1),
    marketType: record.marketType === 'spot' ? 'spot' : 'perpetual',
    positionCapPct: boundedNumber(record.positionCapPct, 1, 100, 100),
    riskPerTradePct: boundedNumber(record.riskPerTradePct, 0.01, 10, strategy.riskPerTrade || 1),
    stopLossAtr: boundedNumber(record.stopLossAtr, 0.1, 20, extractFirstNumber(riskSettings?.stopLoss) || 1.5),
    stopLossEnabled: typeof record.stopLossEnabled === 'boolean' ? record.stopLossEnabled : riskSettings?.stopRequired ?? true,
    takeProfitEnabled: typeof record.takeProfitEnabled === 'boolean' ? record.takeProfitEnabled : true,
    takeProfitR: boundedNumber(record.takeProfitR, 0.1, 20, riskSettings?.rrTarget ?? 2),
    trailingStopAtr: boundedNumber(record.trailingStopAtr, 0.1, 20, extractAtrTrailingStop(riskSettings?.takeProfit, 2)),
    trailingStopEnabled: typeof record.trailingStopEnabled === 'boolean' ? record.trailingStopEnabled : riskSettings?.trailingStop ?? true,
  };
}

function buildAutonomousAgentTasks(db: ThoonDb): AgentQueueTask[] {
  const settings = normalizeAgentSettings(db.agentSettingsRecord);

  if (!settings.enabled || settings.queuePaused) {
    return [];
  }

  const latestByStrategy = new Map<string, BacktestReport>();
  const trustedReports = db.backtestReportRecords
    .filter((report) => report.source === 'calculated' && Boolean(report.dataWindow?.candleChecksum) && Boolean(report.executionSettings))
    .sort((left, right) => new Date(right.generatedAt ?? '').getTime() - new Date(left.generatedAt ?? '').getTime());

  for (const report of trustedReports) {
    if (!latestByStrategy.has(report.strategyId)) {
      latestByStrategy.set(report.strategyId, report);
    }
  }

  const now = new Date().toISOString();
  const tasks: AgentQueueTask[] = [];

  for (const strategy of db.strategyRecords) {
    if (!isMarketAllowedByAgent(settings, strategy.market) || !settings.limits.allowedTimeframes.includes(strategy.timeframe)) {
      continue;
    }

    const report = latestByStrategy.get(strategy.id);

    if (!report) {
      tasks.push(makeAgentQueueTask('run_backtest', strategy, 'Run first matrix validation across top-100 cryptos and multiple timeframes.', 'high', now));
      continue;
    }

    if (report.totalTrades < settings.limits.minTrades) {
      tasks.push(makeAgentQueueTask('run_backtest', strategy, `Increase sample size: ${report.totalTrades}/${settings.limits.minTrades} trades.`, 'normal', now));
      continue;
    }

    const assessment = assessBotReadiness(report, settings);

    if (assessment.decision === 'bot_candidate' || assessment.decision === 'paper_test') {
      tasks.push(makeAgentQueueTask('run_paper_test', strategy, `Paper validate ranked candidate: score ${assessment.score}/100, ${report.profitFactor.toFixed(2)} PF, ${report.winRate.toFixed(1)}% WR.`, 'high', now));
      continue;
    }

    if (assessment.decision === 'do_not_use' || assessment.decision === 'watch') {
      tasks.push(makeAgentQueueTask('create_variant', strategy, `Create or test a stronger variant before bot use: score ${assessment.score}/100, ${report.profitFactor.toFixed(2)} PF, ${report.winRate.toFixed(1)}% WR.`, 'normal', now));
    }
  }

  return tasks.slice(0, 12);
}

function makeAgentQueueTask(action: AgentAction, strategy: Strategy, nextAction: string, priority: AgentQueueTask['priority'], createdAt: string): AgentQueueTask {
  return {
    action,
    createdAt,
    id: `agent-cron-${slug(action)}-${slug(strategy.id)}`,
    nextAction,
    priority,
    status: 'queued',
    strategyId: strategy.id,
  };
}

function patchUserPreferences(current: UserPreferences, body: Record<string, unknown>) {
  const target = current as unknown as Record<string, unknown>;
  const enumFields = {
    accent: ['blue', 'cyan', 'green', 'pink', 'red', 'violet', 'yellow'],
    breakEvenRule: ['off', 'move-to-be-at-1r', 'move-to-be-at-tp1'],
    density: ['compact', 'comfortable'],
    multiTpBehavior: ['single-target', 'partial-take-profits', 'equal-ladder'],
    orderType: ['market', 'limit', 'stop'],
    positionSizingMethod: ['risk-percent', 'fixed-usdt', 'fixed-size'],
    preferredMarketType: ['spot', 'perpetual', 'futures'],
    quickPreset: ['scalping', 'day-trading', 'swing-trading', 'position-trading', 'custom'],
    stopLossMode: ['sl-market', 'sl-limit'],
    takeProfitMode: ['tp-limit', 'tp-market', 'scale-out'],
    theme: ['dark', 'light', 'system'],
  } satisfies Record<string, string[]>;
  const numberFields = ['defaultLeverage', 'defaultRiskPerTrade', 'defaultSlippage', 'trailingStopActivationAtr', 'trailingStopTrailAtr'];
  const booleanFields = ['breakEvenAutomation', 'trailingStopEnabled'];
  const stringFields = ['defaultAccount', 'defaultExchange'];
  const extraPreferenceFields = new Set([
    'advancedSettings',
    'analyticsConsent',
    'animations',
    'billingSettings',
    'chartPreset',
    'fontSize',
    'keyboardShortcuts',
    'notificationDigest',
    'notificationSettings',
    'personalizedExperience',
    'reduceMotion',
    'sidebarBehavior',
    'workspaceLayouts',
  ]);

  for (const [key, allowed] of Object.entries(enumFields)) {
    if (key in body && allowed.includes(asString(body[key]))) {
      target[key] = asString(body[key]);
    }
  }

  for (const key of numberFields) {
    if (key in body) {
      target[key] = positiveValue(body[key], Number(target[key] ?? 0));
    }
  }

  for (const key of booleanFields) {
    if (typeof body[key] === 'boolean') {
      target[key] = body[key];
    }
  }

  for (const key of stringFields) {
    if (typeof body[key] === 'string') {
      target[key] = asString(body[key]).slice(0, 120);
    }
  }

  if (Array.isArray(body.categoryFilters)) {
    const allowedCategories = new Set(['all', 'trending', 'defi', 'layer-1', 'meme', 'ai']);
    target.categoryFilters = body.categoryFilters.filter((item): item is string => typeof item === 'string' && allowedCategories.has(item)).slice(0, 8);
  }

  for (const [key, value] of Object.entries(body)) {
    if (extraPreferenceFields.has(key)) {
      target[key] = sanitizeJsonValue(value);
    }
  }

  return current;
}

function patchRiskRules(current: RiskRules, body: Record<string, unknown>) {
  patchBooleanFields(current, body, ['blockOrdersWithoutStop', 'cancelOnDisconnect', 'confirmLiveOrders', 'emergencyKillSwitch']);
  patchBoundedNumberField(current, body, 'botLossStreakPause', 0, 100);
  patchBoundedNumberField(current, body, 'dailyLossLimit', 0, 100);
  patchBoundedNumberField(current, body, 'maxLeverage', 1, 125);
  patchBoundedNumberField(current, body, 'maxRiskPerTrade', 0, 100);
  patchBoundedNumberField(current, body, 'minimumBalance', 0, maximumNumericInput);
  patchBoundedNumberField(current, body, 'stopBotsAtDrawdown', 0, 100);
  patchBoundedNumberField(current, body, 'weeklyLossLimit', 0, 100);

  return current;
}

function patchTradeLimits(current: TradeLimits, body: Record<string, unknown>) {
  patchBoundedNumberField(current, body, 'cooldownAfterBotErrorMinutes', 0, 1440);
  patchBoundedNumberField(current, body, 'cooldownAfterLossMinutes', 0, 1440);
  patchBoundedNumberField(current, body, 'maxApiErrorsBeforePause', 0, 1000);
  patchBoundedNumberField(current, body, 'maxBotSlotsActive', 0, 1000);
  patchBoundedNumberField(current, body, 'maxOpenPositions', 0, 1000);
  patchBoundedNumberField(current, body, 'maxOrdersPerDay', 0, 10000);
  patchBoundedNumberField(current, body, 'maxOrdersPerHour', 0, 10000);
  patchBoundedNumberField(current, body, 'maxPositionSizePerPair', 0, maximumNumericInput);
  patchBoundedNumberField(current, body, 'maxStrategyExecutionsPerDay', 0, 10000);
  patchBoundedNumberField(current, body, 'maxTotalExposure', 0, maximumNumericInput);

  return current;
}

function patchUserProfile(current: UserProfile, body: Record<string, unknown>) {
  const target = current as unknown as Record<string, unknown>;

  for (const key of ['country', 'email', 'name', 'timezone', 'username']) {
    if (typeof body[key] === 'string') {
      target[key] = asString(body[key]).slice(0, 160);
    }
  }

  if (body.language === 'fr' || body.language === 'en') {
    current.language = body.language;
  }

  if (body.mainCurrency === 'USD' || body.mainCurrency === 'EUR' || body.mainCurrency === 'USDT') {
    current.mainCurrency = body.mainCurrency;
  }

  if (body.tradingExperience === 'beginner' || body.tradingExperience === 'intermediate' || body.tradingExperience === 'advanced') {
    current.tradingExperience = body.tradingExperience;
  }

  return current;
}

function patchBooleanFields<T extends Record<string, unknown>>(target: T, body: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof body[key] === 'boolean') {
      target[key as keyof T] = body[key] as T[keyof T];
    }
  }
}

function patchBoundedNumberField<T extends Record<string, unknown>>(target: T, body: Record<string, unknown>, key: string, min: number, max: number) {
  if (key in body) {
    target[key as keyof T] = boundedNumber(body[key], min, max, Number(target[key as keyof T] ?? min)) as T[keyof T];
  }
}

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return undefined;
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return Number.isFinite(value as number) || typeof value !== 'number' ? value : undefined;
  }

  if (typeof value === 'string') {
    return value.slice(0, 5000);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeJsonValue(item, depth + 1));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '__proto__' && key !== 'constructor' && key !== 'prototype')
        .map(([key, item]) => [key.slice(0, 120), sanitizeJsonValue(item, depth + 1)])
        .filter(([, item]) => item !== undefined),
    );
  }

  return undefined;
}

function isLiveExecutionEnabled() {
  const env = getThoonServerEnv();

  return env.appMode === 'live-enabled' && env.authMode === 'local-required' && env.databaseProvider === 'postgres' && env.liveExchangeProvider !== 'disabled' && hasProductionEncryptionKey(env.encryptionKey);
}

function getLiveTradingBlocker(db: ThoonDb, exchangeNameOrId: string) {
  const exchange = findExchange(db, exchangeNameOrId);

  if (!exchange || exchange.status !== 'connected') {
    return 'Live trading requires a connected exchange.';
  }

  if (exchange.venueType === 'dex') {
    const wallet = db.walletRecords.find((record) => record.status === 'connected');

    if (!wallet) {
      return 'Live DEX trading requires a connected wallet in Exchanges.';
    }

    return 'Live DEX routing is not enabled yet. Keep this bot in paper mode until the signed wallet executor is configured.';
  }

  if (!getActiveTradeApiKey(db, exchange)) {
    return 'Live trading requires an active trade-enabled API key. Save the key, run the connection test, then retry.';
  }

  return undefined;
}

function resolveBotSourceReport(db: ThoonDb, strategyId: string, symbol: string, sourceReportId: string) {
  return db.backtestReportRecords.find((report) => report.id === sourceReportId && report.source === 'calculated' && report.strategyId === strategyId && report.market === symbol && Boolean(report.dataWindow?.candleChecksum) && Boolean(report.executionSettings));
}

function getBotLaunchValidationBlocker(db: ThoonDb, strategyId: string, symbol: string, sourceReportId?: string) {
  const strategy = findVisibleStrategyRecord(db.strategyRecords, db.strategyResearchRecords, strategyId);
  const exactSourceReport = sourceReportId ? resolveBotSourceReport(db, strategyId, symbol, sourceReportId) : undefined;

  if (sourceReportId && !exactSourceReport) {
    return 'Bot launch blocked: the attached source backtest does not match this exact strategy and pair.';
  }

  const matchingReports = db.backtestReportRecords
    .filter((report) => report.source === 'calculated' && report.strategyId === strategyId && report.market === symbol && (!strategy?.timeframe || report.timeframe === strategy.timeframe))
    .sort((left, right) => {
      const rightDays = backtestPeriodDays(right.period);
      const leftDays = backtestPeriodDays(left.period);

      if (rightDays !== leftDays) {
        return rightDays - leftDays;
      }

      return new Date(right.generatedAt ?? '').getTime() - new Date(left.generatedAt ?? '').getTime();
    });
  const report = exactSourceReport ?? matchingReports.find((item) => backtestPeriodDays(item.period) >= 90) ?? matchingReports[0];

  if (!report) {
    return 'Bot launch blocked: run a calculated 90D+ backtest for this exact strategy and pair first.';
  }

  if (backtestPeriodDays(report.period) < 90) {
    return 'Bot launch blocked: latest validation is below 90D out-of-sample coverage.';
  }

  if (report.totalTrades < 30) {
    return `Bot launch blocked: only ${report.totalTrades} trades in validation; minimum is 30.`;
  }

  if (report.profitFactor < 1.15) {
    return `Bot launch blocked: profit factor ${report.profitFactor.toFixed(2)} is below 1.15.`;
  }

  if (report.netProfit <= 0) {
    return `Bot launch blocked: validation net PnL is ${report.netProfit.toFixed(2)}.`;
  }

  if (Math.abs(report.drawdown) > Math.max(1, db.riskRulesRecord.stopBotsAtDrawdown)) {
    return `Bot launch blocked: drawdown ${report.drawdown.toFixed(2)}% exceeds ${db.riskRulesRecord.stopBotsAtDrawdown}%.`;
  }

  return undefined;
}

function backtestPeriodDays(period: string) {
  const parsed = Number(period.match(/(\d+)\s*D/i)?.[1]);

  return Number.isFinite(parsed) ? parsed : 0;
}

function getActiveTradeApiKey(db: ThoonDb, exchange?: ThoonDb['exchangeRecords'][number]) {
  if (!exchange || exchange.status !== 'connected') {
    return undefined;
  }

  return db.apiKeyRecords.find((record) => record.exchangeId === exchange.id && record.status === 'active' && record.permissions.includes('trade'));
}

function periodPnl(db: ThoonDb, period: 'day' | 'week') {
  const now = Date.now();
  const windowMs = period === 'day' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  const cutoff = now - windowMs;

  return db.journalTradeRecords
    .filter((trade) => trade.source !== 'paper' && new Date(trade.closedAt).getTime() >= cutoff)
    .reduce((sum, trade) => sum + trade.pnl, 0);
}

function findExchange(db: ThoonDb, exchangeNameOrId: string) {
  const normalized = exchangeNameOrId.toLowerCase();

  return db.exchangeRecords.find((exchange) => exchange.id.toLowerCase() === normalized || exchange.name.toLowerCase() === normalized);
}

function normalizeOrder(body: Record<string, unknown>, fallbackSymbol: string): Order {
  return {
    createdAt: new Date().toISOString(),
    exchange: asString(body.exchange) || 'Paper',
    executionSource: body.executionSource === 'strategy' ? 'strategy' : 'manual',
    id: asString(body.id) || `plan-${Date.now()}`,
    price: positiveValue(body.price, 0),
    reduceOnly: Boolean(body.reduceOnly),
    side: body.side === 'sell' ? 'sell' : 'buy',
    size: positiveValue(body.size, 0),
    status: body.status === 'open' || body.status === 'filled' || body.status === 'cancelled' || body.status === 'rejected' ? body.status : 'planned',
    strategyId: asString(body.strategyId) || undefined,
    strategyName: asString(body.strategyName) || undefined,
    symbol: asString(body.symbol) || fallbackSymbol,
    type: body.type === 'market' || body.type === 'stop' || body.type === 'take-profit' ? body.type : 'limit',
  };
}

function positionToCloseOrder(position: Position, createdAt: string): Order {
  return {
    createdAt,
    exchange: position.exchange,
    id: `close-${slug(position.symbol)}-${Date.now()}`,
    price: position.markPrice,
    reduceOnly: true,
    side: position.side === 'long' ? 'sell' : 'buy',
    size: position.size,
    status: 'filled',
    symbol: position.symbol,
    type: 'market',
  };
}

function positionToFill(position: Position, time: string, orderId: string) {
  return {
    fee: Math.abs(position.markPrice * position.size * 0.0004),
    id: `fill-close-${slug(position.symbol)}-${Date.now()}`,
    orderId,
    price: position.markPrice,
    side: position.side === 'long' ? ('sell' as const) : ('buy' as const),
    size: position.size,
    symbol: position.symbol,
    time,
  };
}

function positionToJournalTrade(position: Position, closedAt: string): JournalTrade {
  return {
    closedAt,
    id: `trade-${slug(position.symbol)}-${Date.now()}`,
    lessons: 'Closed from orders workspace.',
    notes: `Position opened at ${position.entryPrice} and closed at ${position.markPrice}.`,
    pnl: position.pnl,
    rMultiple: Math.round((position.pnlPercent / Math.max(position.leverage, 1)) * 100) / 100,
    side: position.side,
    source: position.exchange === 'Paper' ? 'paper' : 'manual',
    symbol: position.symbol,
    tag: 'position-close',
  };
}

function removeById<T extends { id: string }>(items: T[], id: string) {
  const index = items.findIndex((item) => item.id === id);

  if (index < 0) {
    return false;
  }

  items.splice(index, 1);
  return true;
}

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const resourceIndex = [
  'GET /api/health',
  'GET /api/production/readiness',
  'GET /api/observability/metrics',
  'GET|POST /api/auth/session|login|logout',
  'GET /api/agent|settings|versions|suggestions|activity|reports|queue|research|ai/status',
  'POST /api/agent/actions',
  'GET|POST /api/agent/cron',
  'PATCH /api/agent/settings',
  'GET /api/markets',
  'GET /api/markets/candles?symbol=BTC%2FUSDT&timeframe=15m&exchangeId=binance|bybit|okx|bitget|kraken|kucoin|coinbase-advanced&marketType=spot|perpetual',
  'GET /api/markets/status',
  'GET|POST /api/watchlists',
  'GET|POST|PATCH|DELETE /api/alerts',
  'GET|POST|PATCH|DELETE /api/strategies',
  'GET|POST|PATCH|DELETE /api/bots',
  'GET|POST|PATCH /api/orders',
  'POST /api/positions/:id/close',
  'POST /api/trading/execute',
  'GET|POST /api/backtests',
  'GET|POST|DELETE /api/journal',
  'POST /api/notifications/test',
  'POST /api/privacy/export',
  'POST /api/security/action',
  'POST /api/system/cache/clear',
  'POST /api/system/reset-local-data',
  'GET|PATCH /api/profile',
  'GET|PATCH /api/preferences',
  'GET|PATCH /api/risk-rules',
  'GET|PATCH /api/trade-limits',
  'GET /api/audit-logs',
  'GET|POST|DELETE /api/exchanges/api-keys',
  'POST /api/exchanges/test',
  'GET|POST /api/wallets',
  'GET|POST /api/setups',
];
