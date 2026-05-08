import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { JIMMY_LEGACY_STRATEGY_IDS, JIMMY_STRATEGY_ID } from '../config/jimmy-strategy';
import { alerts } from '../mock-data/alerts';
import { botLogs, bots } from '../mock-data/bots';
import { fills, openOrders, orderHistory, plannedOrders, positions } from '../mock-data/execution';
import { journalTrades } from '../mock-data/journal';
import { marketOverview, marketPairs } from '../mock-data/markets';
import { apiKeys, auditLogs, exchanges, riskRules, tradeLimits, userPreferences, userProfile } from '../mock-data/security';
import { agentQueueTasks, agentReports, agentRuns, agentSuggestions, defaultAgentSettings, strategyVersions } from '../mock-data/strategy-agent';
import { backtestReports, strategies } from '../mock-data/strategies';
import { watchlists } from '../mock-data/watchlists';
import type { MarketPair } from '../types/market';
import type {
  AgentQueueTask,
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
  Order,
  Position,
  RiskRules,
  Strategy,
  StrategyResearchRecord,
  StrategyVersion,
  TradeLimits,
  UserPreferences,
  UserProfile,
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
  id: string;
  indicators?: unknown;
  markers: unknown[];
  name: string;
  notes: string;
  pair: string;
  plannedOrders: Order[];
  riskSettings: unknown;
  savedAt: string;
  timeframe: string;
};

type MarketOverview = typeof marketOverview;

export type ApiKeySecretRecord = {
  encryptedKey?: EncryptedPayload;
  encryptedSecret?: EncryptedPayload;
};

export type ThoonDb = {
  alertRecords: Alert[];
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
  marketOverviewRecord: MarketOverview;
  marketPairRecords: MarketPair[];
  openOrderRecords: Order[];
  orderHistoryRecords: Order[];
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
  watchlistRecords: Watchlist[];
};

export function createSeedDb(): ThoonDb {
  return sanitizeDbForAppMode({
    alertRecords: alerts,
    agentQueueRecords: agentQueueTasks,
    agentReportRecords: agentReports,
    agentRunRecords: agentRuns,
    agentSettingsRecord: defaultAgentSettings,
    agentSuggestionRecords: agentSuggestions,
    apiKeyRecords: apiKeys,
    apiKeySecrets: {},
    auditLogRecords: auditLogs,
    backtestReportRecords: backtestReports,
    botLogRecords: botLogs,
    botRecords: bots,
    exchangeRecords: exchanges,
    fillRecords: [],
    journalTradeRecords: journalTrades,
    marketOverviewRecord: marketOverview,
    marketPairRecords: marketPairs,
    openOrderRecords: [],
    orderHistoryRecords: [],
    plannedOrderRecords: [],
    positionRecords: [],
    riskRulesRecord: riskRules,
    savedSetupRecords: [],
    schemaVersion: 1,
    sessionRecords: [],
    strategyRecords: strategies,
    strategyResearchRecords: [],
    strategyVersionRecords: strategyVersions,
    tradeLimitsRecord: tradeLimits,
    updatedAt: new Date().toISOString(),
    userPreferencesRecord: userPreferences,
    userProfileRecord: userProfile,
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

  mkdirSync(dirname(dataFile), { recursive: true });
  writeFileSync(tempFile, `${JSON.stringify(nextDb, null, 2)}\n`);
  renameSync(tempFile, dataFile);
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
  const strategyRecords = mergeSeedRecords(seed.strategyRecords, db.strategyRecords).filter((strategy) => !JIMMY_LEGACY_STRATEGY_IDS.includes(strategy.id));
  const visibleStrategyIds = new Set(strategyRecords.map((strategy) => strategy.id));

  return {
    ...seed,
    ...db,
    agentQueueRecords: mergeSeedRecords(seed.agentQueueRecords, db.agentQueueRecords).filter((record) => hasVisibleStrategyId(record.strategyId, visibleStrategyIds) && !isRemovedSeedAgentRecord(record.id)),
    agentReportRecords: mergeSeedRecords(seed.agentReportRecords, db.agentReportRecords).filter((record) => visibleStrategyIds.has(record.strategyId) && !isRemovedSeedAgentRecord(record.id)),
    agentRunRecords: mergeSeedRecords(seed.agentRunRecords, db.agentRunRecords).filter((record) => !record.strategyId || visibleStrategyIds.has(record.strategyId)),
    agentSettingsRecord: migrateAgentSettings(db.agentSettingsRecord, seed.agentSettingsRecord),
    agentSuggestionRecords: mergeSeedRecords(seed.agentSuggestionRecords, db.agentSuggestionRecords).filter((record) => visibleStrategyIds.has(record.strategyId) && !isRemovedSeedAgentRecord(record.id)),
    apiKeySecrets: db.apiKeySecrets ?? {},
    backtestReportRecords: mergeSeedRecords(seed.backtestReportRecords, db.backtestReportRecords).filter((record) => isTrustedBacktestReportRecord(record, visibleStrategyIds)),
    botLogRecords: stripLegacyBotLogs(db.botLogRecords),
    botRecords: normalizeBotRecords(db.botRecords ?? seed.botRecords, visibleStrategyIds),
    fillRecords: stripSeedRecords(fills, db.fillRecords),
    openOrderRecords: stripSeedRecords(openOrders, db.openOrderRecords),
    orderHistoryRecords: stripSeedRecords(orderHistory, db.orderHistoryRecords),
    plannedOrderRecords: stripSeedRecords(plannedOrders, db.plannedOrderRecords),
    positionRecords: stripSeedRecords(positions, db.positionRecords),
    savedSetupRecords: db.savedSetupRecords ?? [],
    sessionRecords: db.sessionRecords ?? [],
    strategyRecords,
    strategyResearchRecords: db.strategyResearchRecords ?? [],
    strategyVersionRecords: mergeSeedRecords(seed.strategyVersionRecords, db.strategyVersionRecords).filter((record) => visibleStrategyIds.has(record.strategyId)),
    schemaVersion: 1,
  };
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
    record.engine === 'jimmy-pine-v5-candle-engine' &&
    Boolean(record.dataWindow?.candleChecksum) &&
    Boolean(record.dataWindow?.firstCandleAt) &&
    Boolean(record.dataWindow?.lastCandleAt) &&
    Number.isFinite(record.candleCount) &&
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

function normalizeBotRecords(records: Bot[] | undefined, visibleStrategyIds: Set<string>): Bot[] {
  const legacyMockBotIds = new Set(['bot-btc-trend-paper', 'bot-eth-breakout-paper', 'bot-sol-reversion-draft']);

  return (records ?? [])
    .filter((bot) => !legacyMockBotIds.has(bot.id))
    .map((bot) => ({
      ...bot,
      strategyId: canonicalStrategyId(bot.strategyId, visibleStrategyIds),
    }));
}

function stripLegacyBotLogs(records: BotLog[] | undefined): BotLog[] {
  const legacyMockBotIds = new Set(['bot-btc-trend-paper', 'bot-eth-breakout-paper', 'bot-sol-reversion-draft']);

  return (records ?? []).filter((log) => !legacyMockBotIds.has(log.botId));
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
    renameSync(dataFile, `${dataFile}.corrupt.${Date.now()}`);
  } catch {
    // Best effort only; the caller will still recreate a seed DB.
  }
}
