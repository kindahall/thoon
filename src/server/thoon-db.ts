import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { JIMMY_LEGACY_STRATEGY_IDS, JIMMY_STRATEGY_ID } from '../config/jimmy-strategy';
import { defaultAgentSettings } from '../config/strategy-agent-defaults';
import { alerts } from '../seed-data/alerts';
import { botLogs, bots } from '../seed-data/bots';
import { fills, openOrders, orderHistory, plannedOrders, positions } from '../seed-data/execution';
import { journalTrades } from '../seed-data/journal';
import { marketOverview, marketPairs } from '../seed-data/markets';
import { apiKeys, auditLogs, exchanges, riskRules, tradeLimits, userPreferences, userProfile, wallets } from '../seed-data/security';
import { backtestReports, strategies } from '../seed-data/strategies';
import { watchlists } from '../seed-data/watchlists';
import type { MarketPair } from '../types/market';
import { strategyIdFromResearchRecord } from '../utils/strategy-catalog';
import type {
  AgentQueueTask,
  AgentChatMessage,
  AgentReport,
  AgentRun,
  AgentSettings,
  AgentSuggestion,
  Alert,
  ApiKeyRecord,
  AuditEvent,
  BacktestReport,
  Bot,
  BotLog,
  ExchangeConnection,
  Fill,
  JournalTrade,
  KronosForecastRecord,
  Order,
  OrderExecutionSource,
  PaperTestSession,
  Position,
  RiskRules,
  Strategy,
  StrategyResearchRecord,
  StrategyVersion,
  TradeLimits,
  UserPreferences,
  UserProfile,
  WalletConnection,
  Watchlist,
} from '../types/trading';
import { getThoonServerEnv } from './env';
import type { EncryptedPayload } from './crypto';
import type { StoredSession } from './auth';
import { mirrorThoonDbToPostgres } from './postgres-store';

let pendingPostgresMirror: Promise<void> | undefined;

export type SavedSetupRecord = {
  draft: unknown;
  drawings?: unknown[];
  exchangeId?: string;
  executionIntent?: OrderExecutionSource;
  id: string;
  indicators?: unknown;
  markers: unknown[];
  name: string;
  notes: string;
  pair: string;
  plannedOrders: Order[];
  riskSettings: unknown;
  savedAt: string;
  strategyId?: string;
  timeframe: string;
};

type MarketOverview = typeof marketOverview;

export type ApiKeySecretRecord = {
  encryptedKey?: EncryptedPayload;
  encryptedSecret?: EncryptedPayload;
};

export type WalletSecretRecord = {
  encryptedMnemonic?: EncryptedPayload;
  encryptedPrivateKey: EncryptedPayload;
};

export type ThoonDb = {
  alertRecords: Alert[];
  agentChatRecords: AgentChatMessage[];
  agentQueueRecords: AgentQueueTask[];
  agentReportRecords: AgentReport[];
  agentRunRecords: AgentRun[];
  agentSettingsRecord: AgentSettings;
  agentSuggestionRecords: AgentSuggestion[];
  apiKeyRecords: ApiKeyRecord[];
  apiKeySecrets: Record<string, ApiKeySecretRecord>;
  auditLogRecords: AuditEvent[];
  backtestReportRecords: BacktestReport[];
  botLogRecords: BotLog[];
  botRecords: Bot[];
  exchangeRecords: ExchangeConnection[];
  fillRecords: Fill[];
  journalTradeRecords: JournalTrade[];
  kronosForecastRecords: KronosForecastRecord[];
  marketOverviewRecord: MarketOverview;
  marketPairRecords: MarketPair[];
  openOrderRecords: Order[];
  orderHistoryRecords: Order[];
  paperTestSessionRecords: PaperTestSession[];
  plannedOrderRecords: Order[];
  positionRecords: Position[];
  riskRulesRecord: RiskRules;
  savedSetupRecords: SavedSetupRecord[];
  schemaVersion: 1;
  sessionRecords: StoredSession[];
  strategyRecords: Strategy[];
  strategyResearchRecords: StrategyResearchRecord[];
  strategyVersionRecords: StrategyVersion[];
  tradeLimitsRecord: TradeLimits;
  updatedAt: string;
  userPreferencesRecord: UserPreferences;
  userProfileRecord: UserProfile;
  walletRecords: WalletConnection[];
  walletSecrets: Record<string, WalletSecretRecord>;
  watchlistRecords: Watchlist[];
};

export function createSeedDb(): ThoonDb {
  return sanitizeDbForAppMode({
    alertRecords: alerts,
    agentChatRecords: [],
    agentQueueRecords: [],
    agentReportRecords: [],
    agentRunRecords: [],
    agentSettingsRecord: defaultAgentSettings,
    agentSuggestionRecords: [],
    apiKeyRecords: apiKeys,
    apiKeySecrets: {},
    auditLogRecords: auditLogs,
    backtestReportRecords: backtestReports,
    botLogRecords: botLogs,
    botRecords: bots,
    exchangeRecords: exchanges,
    fillRecords: [],
    journalTradeRecords: journalTrades,
    kronosForecastRecords: [],
    marketOverviewRecord: marketOverview,
    marketPairRecords: marketPairs,
    openOrderRecords: [],
    orderHistoryRecords: [],
    paperTestSessionRecords: [],
    plannedOrderRecords: [],
    positionRecords: [],
    riskRulesRecord: riskRules,
    savedSetupRecords: [],
    schemaVersion: 1,
    sessionRecords: [],
    strategyRecords: strategies,
    strategyResearchRecords: [],
    strategyVersionRecords: [],
    tradeLimitsRecord: tradeLimits,
    updatedAt: new Date().toISOString(),
    userPreferencesRecord: userPreferences,
    userProfileRecord: userProfile,
    walletRecords: wallets,
    walletSecrets: {},
    watchlistRecords: watchlists,
  });
}

export function readThoonDb(): ThoonDb {
  const { dataFile } = getThoonServerEnv();

  if (!existsSync(dataFile)) {
    const seed = createSeedDb();
    writeThoonDb(seed);

    return seed;
  }

  try {
    const parsed = JSON.parse(readFileSync(dataFile, 'utf8')) as Partial<ThoonDb>;

    return sanitizeDbForAppMode(migrateDb(parsed));
  } catch {
    if (shouldFailClosedOnDbCorruption()) {
      throw new Error(`Thoon data file is corrupt: ${dataFile}. Refusing to reset state in protected runtime.`);
    }

    renameCorruptDb(dataFile);
    const seed = createSeedDb();
    writeThoonDb(seed);

    return seed;
  }
}

export function writeThoonDb(db: ThoonDb) {
  const { dataFile } = getThoonServerEnv();
  const nextDb = { ...db, updatedAt: new Date().toISOString() };
  const tempFile = `${dataFile}.tmp`;

  mkdirSync(dirname(dataFile), { mode: 0o700, recursive: true });
  chmodBestEffort(dirname(dataFile), 0o700);
  writeFileSync(tempFile, `${JSON.stringify(nextDb, null, 2)}\n`);
  chmodBestEffort(tempFile, 0o600);
  renameSync(tempFile, dataFile);
  chmodBestEffort(dataFile, 0o600);
  pendingPostgresMirror = mirrorThoonDbToPostgres(nextDb).catch((error) => {
    console.error('Postgres mirror failed', error);
    throw error;
  });
  void pendingPostgresMirror.catch(() => undefined);
}

export function updateThoonDb<T>(updater: (db: ThoonDb) => T): T {
  const db = readThoonDb();
  const result = updater(db);

  writeThoonDb(db);

  return result;
}

export async function flushPendingPostgresMirror() {
  const mirror = pendingPostgresMirror;

  if (!mirror) {
    return;
  }

  await mirror;

  if (pendingPostgresMirror === mirror) {
    pendingPostgresMirror = undefined;
  }
}

function migrateDb(db: Partial<ThoonDb>): ThoonDb {
  const seed = createSeedDb();
  const strategyRecords = activateAgentSelectedStrategies(mergeSeedRecords(seed.strategyRecords, db.strategyRecords).filter((strategy) => !JIMMY_LEGACY_STRATEGY_IDS.includes(strategy.id)));
  const strategyResearchRecords = db.strategyResearchRecords ?? [];
  const visibleStrategyIds = new Set([...strategyRecords.map((strategy) => strategy.id), ...strategyResearchRecords.map(strategyIdFromResearchRecord)]);

  return {
    ...seed,
    ...db,
    agentQueueRecords: mergeSeedRecords(seed.agentQueueRecords, db.agentQueueRecords).filter((record) => hasVisibleStrategyId(record.strategyId, visibleStrategyIds) && !isRemovedSeedAgentRecord(record.id)),
    agentChatRecords: normalizeAgentChatRecords(db.agentChatRecords),
    agentReportRecords: mergeSeedRecords(seed.agentReportRecords, db.agentReportRecords).filter((record) => visibleStrategyIds.has(record.strategyId) && !isRemovedSeedAgentRecord(record.id)),
    agentRunRecords: mergeSeedRecords(seed.agentRunRecords, db.agentRunRecords).filter((record) => !record.strategyId || visibleStrategyIds.has(record.strategyId)),
    agentSettingsRecord: migrateAgentSettings(db.agentSettingsRecord, seed.agentSettingsRecord),
    agentSuggestionRecords: mergeSeedRecords(seed.agentSuggestionRecords, db.agentSuggestionRecords).filter((record) => visibleStrategyIds.has(record.strategyId) && !isRemovedSeedAgentRecord(record.id)),
    apiKeySecrets: db.apiKeySecrets ?? {},
    backtestReportRecords: mergeSeedRecords(seed.backtestReportRecords, db.backtestReportRecords).filter((record) => isTrustedBacktestReportRecord(record, visibleStrategyIds)),
    botLogRecords: stripLegacyBotLogs(db.botLogRecords),
    botRecords: normalizeBotRecords(db.botRecords ?? seed.botRecords, visibleStrategyIds),
    exchangeRecords: mergeExchangeRecords(seed.exchangeRecords, db.exchangeRecords),
    fillRecords: stripSeedRecords(fills, db.fillRecords),
    kronosForecastRecords: normalizeKronosForecastRecords(db.kronosForecastRecords),
    marketPairRecords: normalizeMarketPairRecords(seed.marketPairRecords, db.marketPairRecords),
    openOrderRecords: stripSeedRecords(openOrders, db.openOrderRecords),
    orderHistoryRecords: stripSeedRecords(orderHistory, db.orderHistoryRecords),
    paperTestSessionRecords: normalizePaperTestSessions(db.paperTestSessionRecords, visibleStrategyIds),
    plannedOrderRecords: stripSeedRecords(plannedOrders, db.plannedOrderRecords),
    positionRecords: stripSeedRecords(positions, db.positionRecords),
    savedSetupRecords: db.savedSetupRecords ?? [],
    sessionRecords: db.sessionRecords ?? [],
    strategyRecords,
    strategyResearchRecords,
    strategyVersionRecords: mergeSeedRecords(seed.strategyVersionRecords, db.strategyVersionRecords).filter((record) => visibleStrategyIds.has(record.strategyId)),
    schemaVersion: 1,
    userPreferencesRecord: migrateUserPreferences(db.userPreferencesRecord, seed.userPreferencesRecord),
    walletRecords: mergeSeedRecords(seed.walletRecords, db.walletRecords),
    walletSecrets: db.walletSecrets ?? {},
  };
}

function normalizeAgentChatRecords(records: AgentChatMessage[] | undefined) {
  return (records ?? [])
    .filter((record) => record && typeof record.id === 'string' && typeof record.content === 'string' && (record.role === 'assistant' || record.role === 'system' || record.role === 'user'))
    .map((record): AgentChatMessage => {
      const status: AgentChatMessage['status'] = record.status === 'failed' || record.status === 'running' ? record.status : 'completed';

      return {
        ...record,
        status,
      };
    })
    .slice(0, 120);
}

function normalizeMarketPairRecords(seedRecords: MarketPair[], dbRecords: MarketPair[] | undefined): MarketPair[] {
  const bySymbol = new Map((dbRecords ?? []).map((record) => [record.symbol, record]));

  return seedRecords.map((seedRecord) => {
    const dbRecord = bySymbol.get(seedRecord.symbol);

    return {
      ...seedRecord,
      ...(dbRecord ?? {}),
      candles: [],
      draft: {
        ...seedRecord.draft,
        ...(dbRecord?.draft ?? {}),
      },
    };
  });
}

function normalizeKronosForecastRecords(records: KronosForecastRecord[] | undefined) {
  return (records ?? [])
    .filter((record) => record && typeof record.id === 'string' && typeof record.market === 'string' && typeof record.timeframe === 'string')
    .map((record): KronosForecastRecord => ({
      ...record,
      confidence: boundedNumber(record.confidence, 0, 1, 0.5),
      horizonCandles: Math.round(boundedNumber(record.horizonCandles, 1, 96, 8)),
      predictedDirection: record.predictedDirection === 'down' || record.predictedDirection === 'range' || record.predictedDirection === 'up' ? record.predictedDirection : 'range',
      source: record.source === 'kronos-worker' ? 'kronos-worker' : 'heuristic-proxy',
      status: record.status === 'evaluated' ? 'evaluated' : 'pending',
      weightAtCreation: boundedNumber(record.weightAtCreation, 0, 2, 0.5),
    }))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 500);
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, numeric));
}

function activateAgentSelectedStrategies(records: Strategy[]) {
  return records.map((strategy) => {
    const sourceId = strategy.agentSource?.sourceId ?? '';

    if (strategy.status === 'draft' && (sourceId.startsWith('tradingview:') || sourceId.startsWith('agent-innovation:'))) {
      return { ...strategy, status: 'active' as const };
    }

    return strategy;
  });
}

function canonicalStrategyId(strategyId: string | undefined, visibleStrategyIds?: Set<string>) {
  if (!strategyId || JIMMY_LEGACY_STRATEGY_IDS.includes(strategyId)) {
    return JIMMY_STRATEGY_ID;
  }

  if (visibleStrategyIds && !visibleStrategyIds.has(strategyId)) {
    return JIMMY_STRATEGY_ID;
  }

  return strategyId;
}

function isTrustedBacktestReportRecord(record: BacktestReport, visibleStrategyIds: Set<string>) {
  return (
    record.source === 'calculated' &&
    visibleStrategyIds.has(record.strategyId) &&
    (record.marketDataSource === 'binance-live' || Boolean(record.marketDataSource?.endsWith('-public-rest'))) &&
    isTrustedBacktestEngine(record.engine) &&
    Boolean(record.dataWindow?.candleChecksum) &&
    Boolean(record.dataWindow?.firstCandleAt) &&
    Boolean(record.dataWindow?.lastCandleAt) &&
    Number.isFinite(record.candleCount) &&
    isTrustedBacktestExecutionSettings(record.executionSettings) &&
    Array.isArray(record.equityCurve) &&
    record.equityCurve.length > 0 &&
    Array.isArray(record.buyHoldCurve) &&
    record.buyHoldCurve.length > 0 &&
    Array.isArray(record.drawdownCurve) &&
    record.drawdownCurve.length > 0 &&
    Array.isArray(record.monthlyReturns) &&
    Array.isArray(record.trades)
  );
}

function isTrustedBacktestEngine(engine: BacktestReport['engine']) {
  return engine === 'jimmy-pine-v5-candle-engine' || engine === 'thoon-concept-candle-engine';
}

function isTrustedBacktestExecutionSettings(settings: BacktestReport['executionSettings']) {
  return (
    settings !== undefined &&
    (settings.directionMode === 'both' || settings.directionMode === 'long-only' || settings.directionMode === 'short-only') &&
    (settings.marketType === 'perpetual' || settings.marketType === 'spot') &&
    Number.isFinite(settings.leverage) &&
    Number.isFinite(settings.positionCapPct) &&
    Number.isFinite(settings.riskPerTradePct) &&
    Number.isFinite(settings.stopLossAtr) &&
    typeof settings.stopLossEnabled === 'boolean' &&
    typeof settings.takeProfitEnabled === 'boolean' &&
    Number.isFinite(settings.takeProfitR) &&
    Number.isFinite(settings.trailingStopAtr) &&
    typeof settings.trailingStopEnabled === 'boolean'
  );
}

function normalizeBotRecords(records: Bot[] | undefined, visibleStrategyIds: Set<string>): Bot[] {
  const legacyDemoBotIds = new Set(['bot-btc-trend-paper', 'bot-eth-breakout-paper', 'bot-sol-reversion-draft']);

  return (records ?? [])
    .filter((bot) => !legacyDemoBotIds.has(bot.id))
    .map((bot) => ({
      ...bot,
      strategyId: canonicalStrategyId(bot.strategyId, visibleStrategyIds),
    }));
}

function normalizePaperTestSessions(records: PaperTestSession[] | undefined, visibleStrategyIds: Set<string>): PaperTestSession[] {
  return (records ?? [])
    .filter((record) => visibleStrategyIds.has(record.strategyId))
    .filter((record) => Boolean(record.reportId && record.candleChecksum))
    .map((record) => {
      const status: PaperTestSession['status'] = record.status === 'completed' || record.status === 'running' || record.status === 'blocked' ? record.status : 'prepared';

      return {
        ...record,
        blockers: Array.isArray(record.blockers) ? record.blockers : [],
        notes: Array.isArray(record.notes) ? record.notes : [],
        pnl: Number.isFinite(record.pnl) ? record.pnl : 0,
        rMultiple: Number.isFinite(record.rMultiple) ? record.rMultiple : 0,
        status,
        tradesRecorded: Number.isFinite(record.tradesRecorded) ? record.tradesRecorded : 0,
        usagePlan: Array.isArray(record.usagePlan) ? record.usagePlan : [],
      };
    })
    .slice(0, 120);
}

function stripLegacyBotLogs(records: BotLog[] | undefined): BotLog[] {
  const legacyDemoBotIds = new Set(['bot-btc-trend-paper', 'bot-eth-breakout-paper', 'bot-sol-reversion-draft']);

  return (records ?? []).filter((log) => !legacyDemoBotIds.has(log.botId));
}

function isRemovedSeedAgentRecord(id: string) {
  const removedSeedAgentIds = new Set([
    'agent-report-jimmy',
    'agent-sug-jimmy-backtest-matrix',
    'agent-sug-jimmy-paper',
    'agent-sug-jimmy-variant',
    'agent-task-jimmy-backtest-matrix',
    'agent-task-jimmy-paper',
  ]);

  return removedSeedAgentIds.has(id);
}

function hasVisibleStrategyId(strategyId: string | undefined, visibleStrategyIds: Set<string>) {
  return Boolean(strategyId && visibleStrategyIds.has(strategyId));
}

function stripSeedRecords<T extends { id: string }>(seedRecords: T[], dbRecords: T[] | undefined): T[] {
  if (!dbRecords) {
    return [];
  }

  const seedIds = new Set(seedRecords.map((record) => record.id));

  return dbRecords.filter((record) => !seedIds.has(record.id));
}

function mergeSeedRecords<T extends { id: string }>(seedRecords: T[], dbRecords: T[] | undefined): T[] {
  if (!dbRecords) {
    return seedRecords;
  }

  const dbById = new Map(dbRecords.map((record) => [record.id, record]));
  const seedIds = new Set(seedRecords.map((record) => record.id));

  return [...seedRecords.map((record) => dbById.get(record.id) ?? record), ...dbRecords.filter((record) => !seedIds.has(record.id))];
}

function mergeExchangeRecords(seedRecords: ExchangeConnection[], dbRecords: ExchangeConnection[] | undefined): ExchangeConnection[] {
  if (!dbRecords) {
    return seedRecords;
  }

  const dbById = new Map(dbRecords.map((record) => [record.id, record]));
  const seedIds = new Set(seedRecords.map((record) => record.id));

  return [
    ...seedRecords.map((record) => {
      const storedRecord = dbById.get(record.id);

      if (!storedRecord) {
        return record;
      }

      return {
        ...record,
        ...storedRecord,
        connectorType: storedRecord.connectorType ?? record.connectorType,
        feeTier: storedRecord.feeTier ?? record.feeTier,
        idealFor: storedRecord.idealFor ?? record.idealFor,
        marketType: storedRecord.marketType ?? record.marketType,
        networks: storedRecord.networks ?? record.networks,
        routingNote: storedRecord.routingNote ?? record.routingNote,
        venueType: storedRecord.venueType ?? record.venueType,
        walletRequired: storedRecord.walletRequired ?? record.walletRequired,
      };
    }),
    ...dbRecords.filter((record) => !seedIds.has(record.id)),
  ];
}

function migrateAgentSettings(dbSettings: AgentSettings | undefined, seedSettings: AgentSettings): AgentSettings {
  if (!dbSettings) {
    return seedSettings;
  }

  const isLegacyDefault =
    dbSettings.mode === 'assisted' &&
    dbSettings.limits.maxBacktestsPerDay === 10 &&
    dbSettings.limits.maxVariantsPerDay === 3 &&
    dbSettings.instructions.general.includes('Improve slowly through variants');

  const isLegacyStrategyAgent =
    dbSettings.instructions.mainStrategy.includes('Core TRIX') ||
    dbSettings.instructions.mainStrategy.includes('BTC Trend') ||
    dbSettings.instructions.mainStrategy.includes('used by the whole application') ||
    dbSettings.instructions.general.includes('Protect the Pine core strategy');

  if (isLegacyDefault || isLegacyStrategyAgent) {
    return seedSettings;
  }

  return {
    ...seedSettings,
    ...dbSettings,
    askBefore: { ...seedSettings.askBefore, ...dbSettings.askBefore },
    instructions: { ...seedSettings.instructions, ...dbSettings.instructions },
    limits: { ...seedSettings.limits, ...dbSettings.limits },
    neverWithoutConfirmation: { ...seedSettings.neverWithoutConfirmation, ...dbSettings.neverWithoutConfirmation },
    permissions: { ...seedSettings.permissions, ...dbSettings.permissions },
    policies: { ...seedSettings.policies, ...dbSettings.policies },
  };
}

function migrateUserPreferences(dbPreferences: UserPreferences | undefined, seedPreferences: UserPreferences): UserPreferences {
  if (!dbPreferences) {
    return seedPreferences;
  }

  const seedBilling = seedPreferences.billingSettings;
  const dbBilling = dbPreferences.billingSettings;
  const seedShortcuts = seedPreferences.keyboardShortcuts;
  const dbShortcuts = dbPreferences.keyboardShortcuts;
  const seedLayouts = seedPreferences.workspaceLayouts;
  const dbLayouts = dbPreferences.workspaceLayouts;
  const fallbackLayouts = seedLayouts?.layouts ?? [];
  const nextLayouts = dbLayouts?.layouts?.length ? dbLayouts.layouts : fallbackLayouts;
  const firstLayoutId = nextLayouts[0]?.id ?? 'single-chart';

  return {
    ...seedPreferences,
    ...dbPreferences,
    billingSettings: {
      billingPeriod: dbBilling?.billingPeriod ?? seedBilling?.billingPeriod ?? 'yearly',
      localReceipts: dbBilling?.localReceipts ?? seedBilling?.localReceipts ?? [],
      nextRenewalAt: dbBilling?.nextRenewalAt ?? seedBilling?.nextRenewalAt,
      planId: dbBilling?.planId ?? seedBilling?.planId ?? 'pro',
      status: dbBilling?.status ?? seedBilling?.status ?? 'active',
      updatedAt: dbBilling?.updatedAt ?? seedBilling?.updatedAt ?? new Date(0).toISOString(),
    },
    keyboardShortcuts: {
      enabled: dbShortcuts?.enabled ?? seedShortcuts?.enabled ?? true,
      shortcuts: dbShortcuts?.shortcuts ?? seedShortcuts?.shortcuts ?? [],
      updatedAt: dbShortcuts?.updatedAt ?? seedShortcuts?.updatedAt ?? new Date(0).toISOString(),
    },
    workspaceLayouts: {
      activeLayoutId: dbLayouts?.activeLayoutId ?? seedLayouts?.activeLayoutId ?? firstLayoutId,
      defaultLayoutId: dbLayouts?.defaultLayoutId ?? seedLayouts?.defaultLayoutId ?? firstLayoutId,
      layouts: nextLayouts,
      panelDocking: dbLayouts?.panelDocking ?? seedLayouts?.panelDocking ?? 'right',
      sidebarBehavior: dbLayouts?.sidebarBehavior ?? seedLayouts?.sidebarBehavior ?? 'expanded',
      updatedAt: dbLayouts?.updatedAt ?? seedLayouts?.updatedAt ?? new Date(0).toISOString(),
    },
  };
}

function sanitizeDbForAppMode(db: ThoonDb): ThoonDb {
  if (getThoonServerEnv().appMode === 'live-enabled') {
    return db;
  }

  return {
    ...db,
    apiKeyRecords: [],
    apiKeySecrets: {},
    exchangeRecords: db.exchangeRecords.map((exchange) => ({
      ...exchange,
      permissions: [],
      status: exchange.status === 'available' ? 'available' : 'disconnected',
    })),
  };
}

function renameCorruptDb(dataFile: string) {
  if (!existsSync(dataFile)) {
    return;
  }

  try {
    const corruptFile = `${dataFile}.corrupt.${Date.now()}`;
    renameSync(dataFile, corruptFile);
    chmodBestEffort(corruptFile, 0o600);
  } catch {
    // Best effort only; the caller will still recreate a seed DB.
  }
}

function shouldFailClosedOnDbCorruption() {
  const env = getThoonServerEnv();

  return env.nodeEnv === 'production' || env.authMode === 'local-required' || env.appMode === 'live-enabled';
}

function chmodBestEffort(path: string, mode: number) {
  try {
    chmodSync(path, mode);
  } catch {
    // Some serverless filesystems do not allow chmod; writes still proceed.
  }
}
