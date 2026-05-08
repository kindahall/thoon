import { NextRequest, NextResponse } from 'next/server';

import { JIMMY_LEGACY_STRATEGY_IDS, JIMMY_STRATEGY_ID } from '../../../config/jimmy-strategy';
import { appendAuditEvent } from '../../../server/audit';
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
import { executeLiveOrder } from '../../../server/exchanges/live-executor';
import { getMetricsSnapshot, incrementMetric, logServerEvent } from '../../../server/observability';
import { getProductionReadiness } from '../../../server/readiness';
import { generateAiStrategySuggestions, getStrategyAgentAiStatus } from '../../../server/strategy-agent-ai';
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
import type { PositionDraft, Timeframe } from '../../../types/market';
import { buildRiskOrderInputFromDraft, evaluateRiskEngine } from '../../../services/risk-engine';
import type { AgentAction, AgentRun, Alert, ApiKeyRecord, BacktestReport, Bot, JournalTrade, Order, Position, Strategy, StrategyCondition, StrategyRiskSettings } from '../../../types/trading';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  return handleApiError(() => getHandler(request, context));
}

async function getHandler(request: NextRequest, context: RouteContext) {
  const path = await routePath(context);
  const db = readThoonDb();

  if (path[0] === 'auth' && path[1] === 'session') {
    const session = getSessionFromRequest(request);

    if (!session && isAuthRequired()) {
      return json({ authenticated: false, auth: getAuthProductionStatus() }, 401);
    }

    return json({ authenticated: Boolean(session), auth: getAuthProductionStatus(), session });
  }

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

    if (path[1] === 'research') {
      return json(strategyId ? db.strategyResearchRecords.filter((record) => record.strategyId === strategyId) : db.strategyResearchRecords);
    }

    return json(agentDashboard(db, strategyId));
  }

  if (path[0] === 'markets') {
    const snapshot = await getMarketDataSnapshot();

    if (path[1] === 'candles') {
      const symbol = request.nextUrl.searchParams.get('symbol');
      const timeframe = request.nextUrl.searchParams.get('timeframe');
      const exchangeId = request.nextUrl.searchParams.get('exchangeId') ?? 'binance';
      const requestedLimit = positiveInteger(request.nextUrl.searchParams.get('limit'), undefined);

      if (!symbol || !isTimeframe(timeframe)) {
        return json({ error: 'Missing symbol or timeframe' }, 400);
      }

      return json(await getMarketCandles(symbol, timeframe, exchangeId, requestedLimit));
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
    const visibleStrategies = visibleStrategyRecords(db);
    const requestedId = canonicalStrategyId(path[1]);

    return json(path[1] ? visibleStrategies.find((strategy) => strategy.id === requestedId) : visibleStrategies);
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
    return json(db.backtestReportRecords.filter((report) => report.source === 'calculated' && report.strategyId === JIMMY_STRATEGY_ID));
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

  if (path[0] === 'audit-logs') {
    return json(db.auditLogRecords);
  }

  if (path[0] === 'setups') {
    return json(db.savedSetupRecords);
  }

  return notFound(path);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handleApiError(() => durableMutation(() => postHandler(request, context)));
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

  if (path[0] === 'bots' && path[1] && path[2] === 'action') {
    return json(
      updateThoonDb((db) => {
        const bot = db.botRecords.find((item) => item.id === path[1]);

        if (!bot) {
          throw new ApiError('Bot not found', 404);
        }

        const action = asString(body.action);
        bot.status = action === 'pause' ? 'paused' : action === 'stop' ? 'stopped' : action === 'start' ? 'running' : bot.status;
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
      }),
    );
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

        if (!list || !symbol) {
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
          const source = db.strategyRecords.find((strategy) => strategy.id === path[1]);

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
            details: 'Live bot launch blocked because THOON_APP_MODE is not live-enabled.',
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
          status: requestedStatus,
          strategyId: canonicalStrategyId(asString(body.strategyId) || db.strategyRecords[0]?.id || 'manual'),
          symbol: asString(body.symbol) || db.marketPairRecords[0].symbol,
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
            details: 'Live order blocked because THOON_APP_MODE is not live-enabled.',
            eventType: 'risk',
            exchange: asString(body.exchangeName) || 'Live',
            status: 'blocked',
            symbol,
          });

          return { allowed: false, error: 'Live execution is disabled. Set THOON_APP_MODE=live-enabled only after connecting a real exchange executor.' };
        }),
        403,
      );
    }

    const db = readThoonDb();
    const mode = requestedMode;
    const draft = body.draft as { direction?: 'long' | 'short'; entry?: number; riskPercent?: number; size?: number; stopLoss?: number; takeProfit?: number };
    const symbol = asString(body.symbol) || db.marketPairRecords[0].symbol;
    const leverage = asNumber(body.leverage, db.userPreferencesRecord.defaultLeverage);
    const requestedExchangeId = asString(body.exchangeId);
    const requestedExchangeName = asString(body.exchangeName);
    const exchange =
      db.exchangeRecords.find((item) => item.id === requestedExchangeId) ??
      db.exchangeRecords.find((item) => item.name === requestedExchangeName) ??
      db.exchangeRecords.find((item) => item.name === db.userPreferencesRecord.defaultExchange) ??
      db.exchangeRecords[0];
    const riskResult = evaluateRiskEngine({
      action: 'execute-trade',
      exchange,
      mode,
      order: buildRiskOrderInputFromDraft({
        accountBalance: 25000,
        availableBalance: 25000,
        dailyLossPercent: 0,
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
        weeklyLossPercent: 0,
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
      id: `ord-${slug(symbol)}-${Date.now()}`,
      price: asNumber(draft.entry, 0),
      reduceOnly: false,
      side: draft.direction === 'short' ? 'sell' : 'buy',
      size: asNumber(draft.size, 0),
      status: mode === 'paper' ? 'filled' : 'open',
      symbol,
      type: 'limit',
    };
    let liveResult: Awaited<ReturnType<typeof executeLiveOrder>> | undefined;

    if (mode === 'live') {
      const apiKey = getActiveTradeApiKey(db, exchange);
      const secret = apiKey ? db.apiKeySecrets[apiKey.id] : undefined;

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
          details: liveResult?.exchangeOrderId ? `${order.side} ${symbol} sent. Exchange order ${liveResult.exchangeOrderId}.` : `${order.side} ${symbol} at ${order.price}.`,
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
    const strategyId = canonicalStrategyId(asString(body.strategyId) || db.strategyRecords[0]?.id || 'manual');
    const strategy = db.strategyRecords.find((record) => record.id === strategyId) ?? db.strategyRecords[0];

    if (!strategy) {
      return json({ error: 'Strategy not found.' }, 404);
    }

    const period = asString(body.period) || '90D';
    const symbol = asString(body.symbol) || strategy.market;
    const timeframe = isTimeframe(body.timeframe) ? body.timeframe : strategy.timeframe;
    const exchangeId = asString(body.exchangeId) || 'binance';
    const exchange = db.exchangeRecords.find((record) => record.id === exchangeId);
    let candles;

    try {
      candles = await getMarketCandles(symbol, timeframe, exchangeId, desiredBacktestCandleLimit(period, timeframe), { strict: true });
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
        db.backtestReportRecords = [report, ...db.backtestReportRecords].slice(0, 80);
        appendAuditEvent(db, {
          action: 'Backtest run',
          actor: 'user',
          details: `${report.period} calculated backtest saved for ${strategyId} on ${report.exchangeName ?? exchangeId} using ${report.candleCount} candles.`,
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

  if (path[0] === 'exchanges' && path[1] === 'api-keys') {
    const env = getThoonServerEnv();

    if (!hasProductionEncryptionKey(env.encryptionKey)) {
      return json({ error: 'Set a unique THOON_ENCRYPTION_KEY of at least 32 characters before storing exchange API keys.' }, 500);
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
    return json(
      updateThoonDb((db) => {
        const exchangeId = asString(body.exchangeId);
        const exchange = db.exchangeRecords.find((item) => item.id === exchangeId);

        if (!exchange) {
          throw new ApiError('Exchange not found', 404);
        }

        let activatedKeys = 0;

        db.apiKeyRecords = db.apiKeyRecords.map((keyRecord) => {
          const secret = db.apiKeySecrets[keyRecord.id];

          if (keyRecord.exchangeId !== exchange.id || keyRecord.status !== 'testing' || !secret?.encryptedKey || !secret.encryptedSecret) {
            return keyRecord;
          }

          activatedKeys += 1;
          return { ...keyRecord, status: 'active' };
        });

        appendAuditEvent(db, {
          action: 'API key tested',
          actor: 'system',
          details: activatedKeys > 0 ? `${exchange.name} key activated after local credential check. Live network test still requires real credentials.` : `${exchange.name} local credential check completed. Live network test requires real credentials.`,
          eventType: 'api',
          exchange: exchange.name,
          status: exchange.permissions.length ? 'success' : 'warning',
        });

        return { exchange, liveNetworkChecked: false, ok: exchange.status === 'connected' };
      }),
    );
  }

  if (path[0] === 'setups') {
    return json(
      updateThoonDb((db) => {
        const setup = body as SavedSetupRecord;
        const record: SavedSetupRecord = {
          draft: setup.draft ?? {},
          drawings: Array.isArray(setup.drawings) ? setup.drawings : [],
          exchangeId: asString(setup.exchangeId),
          id: asString(setup.id) || `setup-${Date.now()}`,
          indicators: setup.indicators ?? {},
          markers: Array.isArray(setup.markers) ? setup.markers : [],
          name: asString(setup.name) || 'Saved setup',
          notes: asString(setup.notes),
          pair: asString(setup.pair) || db.marketPairRecords[0].symbol,
          plannedOrders: Array.isArray(setup.plannedOrders) ? setup.plannedOrders : [],
          riskSettings: setup.riskSettings ?? {},
          savedAt: asString(setup.savedAt) || new Date().toISOString(),
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
  return handleApiError(() => durableMutation(() => patchHandler(request, context)));
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

  if (path[0] === 'preferences') {
    return json(updateThoonDb((db) => Object.assign(db.userPreferencesRecord, body)));
  }

  if (path[0] === 'risk-rules') {
    return json(updateThoonDb((db) => Object.assign(db.riskRulesRecord, body)));
  }

  if (path[0] === 'trade-limits') {
    return json(updateThoonDb((db) => Object.assign(db.tradeLimitsRecord, body)));
  }

  if (path[0] === 'profile') {
    return json(updateThoonDb((db) => Object.assign(db.userProfileRecord, body)));
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

        order.status = body.status === 'cancelled' ? 'cancelled' : order.status;
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
        const strategy = db.strategyRecords.find((item) => item.id === path[1]);

        if (!strategy) {
          throw new ApiError('Strategy not found', 404);
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

      if (requestedMode === 'live' && requestedStatus === 'running' && !isLiveExecutionEnabled()) {
        appendAuditEvent(db, {
          action: 'Live bot update blocked',
          actor: 'system',
          botId: bot.id,
          details: 'Live bot update blocked because THOON_APP_MODE is not live-enabled.',
          eventType: 'risk',
          exchange: asString(body.exchange) || bot.exchange,
          status: 'blocked',
          symbol: asString(body.symbol) || bot.symbol,
        });

        return { error: 'Live execution is disabled. Set THOON_APP_MODE=live-enabled only after connecting a real exchange executor.' };
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
      bot.strategyId = canonicalStrategyId(asString(body.strategyId) || bot.strategyId);
      bot.symbol = asString(body.symbol) || bot.symbol;

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
  return handleApiError(() => durableMutation(() => deleteHandler(_request, context)));
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
    return json(updateThoonDb((db) => ({ deleted: removeById(db.strategyRecords, path[1]) })));
  }

  if (path[0] === 'bots' && path[1]) {
    return json(updateThoonDb((db) => ({ deleted: removeById(db.botRecords, path[1]) })));
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

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status });
}

function login(request: NextRequest, body: Record<string, unknown>) {
  const env = getThoonServerEnv();

  if (!isAuthRequired()) {
    return json({ authenticated: true, session: getSessionFromRequest(request) });
  }

  const email = asString(body.email).toLowerCase();
  const password = asString(body.password);

  if (!env.thoonAdminPasswordHash) {
    return json({ error: 'THOON_ADMIN_PASSWORD_HASH is required before local auth can be enabled.' }, 503);
  }

  if (email !== env.thoonAdminEmail.toLowerCase() || !verifyPassword(password, env.thoonAdminPasswordHash)) {
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
        ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local',
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

async function agentAction(body: Record<string, unknown>) {
  const action = normalizeAgentAction(body.action);

  if (!action) {
    return json({ error: 'Unknown Strategy Agent action.' }, 400);
  }

  const confirmed = Boolean(body.confirmed);
  const strategyId = canonicalStrategyId(asString(body.strategyId));
  const versionId = asString(body.versionId);
  let aiSuggestionResult: Awaited<ReturnType<typeof generateAiStrategySuggestions>> | undefined;
  let agentBacktestReport: BacktestReport | undefined;
  let tradingViewResearchResult: Awaited<ReturnType<typeof researchTradingViewStrategies>> | undefined;

  if (action === 'analyze_strategy' || action === 'create_report') {
    const db = readThoonDb();
    const strategy = strategyId ? db.strategyRecords.find((item) => item.id === strategyId) : undefined;
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
    const strategy = strategyId ? db.strategyRecords.find((item) => item.id === strategyId) : undefined;

    if (strategy) {
      let candles;

      try {
        candles = await getMarketCandles(strategy.market, strategy.timeframe, 'binance', desiredBacktestCandleLimit('90D', strategy.timeframe), { strict: true });
      } catch (error) {
        throw new ApiError(error instanceof Error ? error.message : 'Live Binance candles unavailable for agent backtest.', 502);
      }
      agentBacktestReport = runBacktestFromCandles({
        candles,
        exchangeId: 'binance',
        exchangeName: 'Binance',
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
    const strategy = strategyId ? db.strategyRecords.find((item) => item.id === strategyId) : undefined;
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
      const strategy = strategyId ? db.strategyRecords.find((item) => item.id === strategyId) : undefined;
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

      const result = executeAgentAction(db, action, strategy, version, aiSuggestionResult, agentBacktestReport, tradingViewResearchResult);
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

function executeAgentAction(
  db: ThoonDb,
  action: AgentAction,
  strategy?: Strategy,
  version?: ThoonDb['strategyVersionRecords'][number],
  aiSuggestionResult?: Awaited<ReturnType<typeof generateAiStrategySuggestions>>,
  agentBacktestReport?: BacktestReport,
  tradingViewResearchResult?: Awaited<ReturnType<typeof researchTradingViewStrategies>>,
) {
  if (!strategy && action !== 'compare_versions') {
    throw new ApiError('Strategy not found', 404);
  }

  switch (action) {
    case 'analyze_strategy': {
      const suggestions = aiSuggestionResult?.suggestions.length ? aiSuggestionResult.suggestions : buildAgentSuggestions(db, strategy?.id);
      db.agentSuggestionRecords = [...suggestions, ...db.agentSuggestionRecords.filter((suggestion) => suggestion.strategyId !== strategy?.id)].slice(0, 60);

      return { notes: aiSuggestionResult ? `Analysis refreshed with ${aiSuggestionResult.provider.provider} provider.` : 'Analysis refreshed with local rules.', payload: { provider: aiSuggestionResult?.provider ?? getStrategyAgentAiStatus(), suggestions, summary: aiSuggestionResult?.summary } };
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
      return {
        notes: 'Paper test workspace prepared. No paper performance is recorded until trades are actually executed.',
        payload: { href: `/backtest/replay?pair=${encodeURIComponent((strategy as Strategy).market)}&strategyId=${encodeURIComponent((strategy as Strategy).id)}`, version },
      };
    }
    case 'prepare_bot':
      return {
        notes: 'Paper bot draft prepared.',
        payload: { href: `/bots/new?strategyId=${encodeURIComponent((strategy as Strategy).id)}&pair=${encodeURIComponent((strategy as Strategy).market)}` },
      };
    case 'create_draft_bot': {
      const bot = createDraftBotFromVersion(strategy as Strategy, version);
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

  return {
    ai: getStrategyAgentAiStatus(),
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
      tasks: queue.length,
      versions: versions.length,
    },
    suggestions,
    versions,
  };
}


async function handleApiError(handler: () => Promise<NextResponse>) {
  incrementMetric('apiRequests');

  try {
    return await handler();
  } catch (error) {
    incrementMetric('apiErrors');

    if (error instanceof ApiError) {
      return json({ error: error.message }, error.status);
    }

    logServerEvent('error', 'api.unhandled_error', { error: error instanceof Error ? error.message : String(error) });
    return json({ error: 'Internal server error' }, 500);
  }
}

async function durableMutation(handler: () => Promise<NextResponse>) {
  const response = await handler();

  await flushPendingPostgresMirror();

  return response;
}

function notFound(path: string[]) {
  return json({ error: `Unknown API route: /api/${path.join('/')}` }, 404);
}

function mutationGuard(request: NextRequest, path: string[]) {
  const origin = request.headers.get('origin');

  if (origin && origin !== request.nextUrl.origin && !isEquivalentLocalOrigin(origin, request.nextUrl.origin)) {
    return json({ error: 'Cross-origin mutation blocked.' }, 403);
  }

  if (path[0] === 'auth') {
    return null;
  }

  if (isAuthRequired() && !getSessionFromRequest(request)) {
    return json({ error: 'Authentication required.' }, 401);
  }

  return null;
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
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown, fallback: number) {
  const nextValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

function canonicalStrategyId(_value: string | undefined) {
  return JIMMY_STRATEGY_ID;
}

function visibleStrategyRecords(db: ThoonDb) {
  const jimmy = db.strategyRecords.find((strategy) => strategy.id === JIMMY_STRATEGY_ID);

  return jimmy ? [jimmy] : db.strategyRecords.filter((strategy) => !JIMMY_LEGACY_STRATEGY_IDS.includes(strategy.id)).slice(0, 1);
}

function positiveValue(value: unknown, fallback: number) {
  const nextValue = asNumber(value, fallback);

  return nextValue >= 0 ? nextValue : fallback;
}

function positiveInteger(value: unknown, fallback: number | undefined) {
  const nextValue = Math.floor(asNumber(value, fallback ?? 0));

  return nextValue > 0 ? nextValue : fallback;
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

function isLiveExecutionEnabled() {
  return getThoonServerEnv().appMode === 'live-enabled';
}

function getLiveTradingBlocker(db: ThoonDb, exchangeNameOrId: string) {
  const exchange = findExchange(db, exchangeNameOrId);

  if (!exchange || exchange.status !== 'connected') {
    return 'Live trading requires a connected exchange.';
  }

  if (!getActiveTradeApiKey(db, exchange)) {
    return 'Live trading requires an active trade-enabled API key. Save the key, run the connection test, then retry.';
  }

  return undefined;
}

function getActiveTradeApiKey(db: ThoonDb, exchange?: ThoonDb['exchangeRecords'][number]) {
  if (!exchange || exchange.status !== 'connected') {
    return undefined;
  }

  return db.apiKeyRecords.find((record) => record.exchangeId === exchange.id && record.status === 'active' && record.permissions.includes('trade'));
}

function findExchange(db: ThoonDb, exchangeNameOrId: string) {
  const normalized = exchangeNameOrId.toLowerCase();

  return db.exchangeRecords.find((exchange) => exchange.id.toLowerCase() === normalized || exchange.name.toLowerCase() === normalized);
}

function normalizeOrder(body: Record<string, unknown>, fallbackSymbol: string): Order {
  return {
    createdAt: new Date().toISOString(),
    exchange: asString(body.exchange) || 'Paper',
    id: asString(body.id) || `plan-${Date.now()}`,
    price: positiveValue(body.price, 0),
    reduceOnly: Boolean(body.reduceOnly),
    side: body.side === 'sell' ? 'sell' : 'buy',
    size: positiveValue(body.size, 0),
    status: body.status === 'open' || body.status === 'filled' || body.status === 'cancelled' || body.status === 'rejected' ? body.status : 'planned',
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
  'PATCH /api/agent/settings',
  'GET /api/markets',
  'GET /api/markets/candles?symbol=BTC%2FUSDT&timeframe=15m&exchangeId=binance|bybit|okx|bitget|kraken|kucoin|coinbase-advanced',
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
  'GET|POST /api/setups',
];
