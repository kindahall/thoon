import type { BacktestReport, MetricTone, PreferenceSectionKey, Strategy, WorkspaceRow, WorkspaceSummary, WorkspaceSummaryKey } from '../types/trading';
import { formatCompact, formatCompactUsd, formatPercent, formatUsd } from '../utils/format';
import { readThoonDb } from '../server/thoon-db';
import { getStrategyAgentAiStatus } from '../server/strategy-agent-ai';
import { getKronosIntegrationProfile } from '../server/kronos-integration';
import { getKronosLearningProfile } from '../server/kronos-learning';
import { visibleAgentChatMessages } from '../server/agent-chat';
import { getTradingViewMcpProfile } from '../server/tradingview-mcp-integration';
import { canonicalStrategyId, findVisibleStrategyRecord, visibleStrategyRecords } from '../utils/strategy-catalog';
import { buildEndorsedStrategies } from '../utils/strategy-endorsement';

export function getWorkspaceSummary(key: WorkspaceSummaryKey): WorkspaceSummary {
  const {
    apiKeyRecords,
    backtestReportRecords,
    botRecords,
    fillRecords,
    journalTradeRecords,
    marketOverviewRecord,
    marketPairRecords,
    openOrderRecords,
    plannedOrderRecords,
    riskRulesRecord,
    strategyRecords,
    strategyResearchRecords,
    userPreferencesRecord,
    watchlistRecords,
  } = readThoonDb();
  const canonicalStrategies = visibleStrategyRecords(strategyRecords, strategyResearchRecords);
  const canonicalReports = backtestReportRecords.filter((report) => report.source === 'calculated');

  switch (key) {
    case 'markets':
      return {
        actionLabel: 'Filter',
        eyebrow: 'Market',
        metrics: [
          { label: 'Market Cap', tone: 'positive', value: formatCompactUsd(marketOverviewRecord.marketCap) },
          { label: '24h Volume', tone: 'positive', value: formatCompactUsd(marketOverviewRecord.volume24h) },
          { label: 'BTC Dom.', value: `${marketOverviewRecord.btcDominance.toFixed(2)}%` },
        ],
        rows: marketPairRecords.slice(0, 3).map((pair) => ({
          href: '/charts',
          primary: pair.symbol,
          secondary: `${pair.name} · ${formatCompact(pair.volume24h)} vol`,
          status: formatPercent(pair.change24h),
          tone: toneFromNumber(pair.change24h),
        })),
        title: 'Markets',
      };
    case 'watchlist':
      return {
        actionLabel: 'Add Pair',
        eyebrow: 'Lists',
        metrics: [
          { label: 'Favorites', value: String(watchlistRecords[0].pairSymbols.length) },
          { label: 'Alerts', tone: 'positive', value: String(watchlistRecords.reduce((sum, list) => sum + list.alertCount, 0)) },
          { label: 'Lists', value: String(watchlistRecords.length) },
        ],
        rows: watchlistRecords.map((list) => ({
          href: '/watchlist',
          primary: list.name,
          secondary: `${list.pairSymbols.length} pairs`,
          status: `${list.alertCount} alerts`,
          tone: list.alertCount > 0 ? 'positive' : 'neutral',
        })),
        title: 'Watchlist',
      };
    case 'backtest':
      return {
        actionLabel: 'Run',
        eyebrow: 'Lab',
        metrics: [
          { label: 'Reports', value: String(canonicalReports.length) },
          { label: 'Win Rate', tone: canonicalReports.length ? 'positive' : 'neutral', value: canonicalReports.length ? `${Math.round(average(canonicalReports.map((report) => report.winRate)))}%` : 'Run' },
          { label: 'Max DD', tone: canonicalReports.length ? 'negative' : 'neutral', value: canonicalReports.length ? `${Math.min(...canonicalReports.map((report) => report.drawdown)).toFixed(1)}%` : 'Run' },
        ],
        rows: canonicalReports.map((report) => {
          const strategy = canonicalStrategies.find((item) => item.id === canonicalStrategyId(report.strategyId));

          return {
            href: '/backtest',
            primary: strategy?.name ?? report.strategyId,
            secondary: `${report.period} · ${report.totalTrades} trades`,
            status: formatUsd(report.netProfit),
            tone: toneFromNumber(report.netProfit),
          };
        }),
        title: 'Backtest',
      };
    case 'strategies':
      return {
        actionLabel: 'Create',
        actionHref: '/strategies/new',
        eyebrow: 'Rules',
        metrics: [
          { label: 'Active', tone: 'positive', value: String(canonicalStrategies.filter((strategy) => strategy.status === 'active').length) },
          { label: 'Drafts', value: String(canonicalStrategies.filter((strategy) => strategy.status === 'draft').length) },
          { label: '30D', tone: 'positive', value: formatPercent(average(canonicalStrategies.map((strategy) => strategy.performance30d))) },
        ],
        rows: canonicalStrategies.map((strategy) => ({
          href: `/strategies/${strategy.id}`,
          primary: strategy.name,
          secondary: `${strategy.market} · ${strategy.timeframe}`,
          status: strategy.status,
          tone: strategy.status === 'active' ? 'positive' : 'neutral',
        })),
        title: 'Strategies',
      };
    case 'bots':
      return {
        actionLabel: 'Create',
        actionHref: '/bots/new',
        eyebrow: 'Automation',
        metrics: [
          { label: 'Active', tone: 'positive', value: String(botRecords.filter((bot) => bot.status === 'running').length) },
          { label: 'Paper', value: String(botRecords.filter((bot) => bot.mode === 'paper').length) },
          { label: 'PnL', tone: 'positive', value: formatUsd(sum(botRecords.map((bot) => bot.pnl))) },
        ],
        rows: botRecords.map((bot) => ({
          href: `/bots/${bot.id}`,
          primary: bot.name,
          secondary: `${bot.symbol} · ${bot.exchange}`,
          status: bot.status,
          tone: bot.status === 'running' ? 'positive' : 'neutral',
        })),
        title: 'Bots',
      };
    case 'orders':
      return {
        actionLabel: 'Export',
        eyebrow: 'Execution',
        metrics: [
          { label: 'Open', value: String(openOrderRecords.length) },
          { label: 'Fills', tone: 'positive', value: String(fillRecords.length) },
          { label: 'Risk', value: riskRulesRecord.blockOrdersWithoutStop ? 'Locked' : 'Loose' },
        ],
        rows: [...openOrderRecords, ...plannedOrderRecords].map((order) => ({
          href: '/orders',
          primary: order.symbol,
          secondary: `${order.type} · ${order.side} ${order.size}`,
          status: order.status,
          tone: order.status === 'planned' ? 'warning' : 'neutral',
        })),
        title: 'Orders',
      };
    case 'alerts':
      return getAlertsWorkspaceSummary();
    case 'history':
      return {
        actionLabel: 'Export',
        eyebrow: 'Journal',
        metrics: [
          { label: 'Trades', value: String(journalTradeRecords.length) },
          { label: 'Win Rate', tone: 'positive', value: `${Math.round((journalTradeRecords.filter((trade) => trade.pnl > 0).length / journalTradeRecords.length) * 100)}%` },
          { label: 'PnL', tone: 'positive', value: formatUsd(sum(journalTradeRecords.map((trade) => trade.pnl))) },
        ],
        rows: journalTradeRecords.map((trade) => ({
          href: '/history',
          primary: trade.symbol,
          secondary: `${trade.side} · ${trade.source}`,
          status: `${trade.rMultiple.toFixed(1)} R`,
          tone: toneFromNumber(trade.pnl),
        })),
        title: 'History',
      };
    case 'preferences':
      return {
        actionLabel: 'Save',
        eyebrow: 'Settings',
        metrics: [
          { label: 'Theme', value: userPreferencesRecord.theme },
          { label: 'Risk', value: `${userPreferencesRecord.defaultRiskPerTrade}%` },
          { label: 'API', tone: apiKeyRecords.some((keyRecord) => keyRecord.status === 'active') ? 'positive' : 'negative', value: `${readThoonDb().exchangeRecords.filter((exchange) => exchange.status === 'connected').length} on` },
        ],
        rows: buildPreferenceRows(),
        title: 'Preferences',
      };
  }
}

export function listPositions() {
  return readThoonDb().positionRecords;
}

export function listOpenOrders() {
  return readThoonDb().openOrderRecords;
}

export function listPlannedOrders() {
  return readThoonDb().plannedOrderRecords;
}

export function listFills() {
  return readThoonDb().fillRecords;
}

export function listOrderHistory() {
  return readThoonDb().orderHistoryRecords;
}

export function listBots() {
  return readThoonDb().botRecords;
}

export function getBot(id: string) {
  return readThoonDb().botRecords.find((bot) => bot.id === id);
}

export function listBotLogs() {
  return readThoonDb().botLogRecords;
}

export function listJournalTrades() {
  return readThoonDb().journalTradeRecords;
}

export function listPaperTestSessions() {
  return readThoonDb().paperTestSessionRecords;
}

export function listAlerts() {
  return readThoonDb().alertRecords;
}

export function listWatchlists() {
  return readThoonDb().watchlistRecords;
}

export function getUserProfile() {
  return readThoonDb().userProfileRecord;
}

export function getUserPreferences() {
  return readThoonDb().userPreferencesRecord;
}

export function listApiKeys() {
  return readThoonDb().apiKeyRecords;
}

export function listAuditLogs() {
  return readThoonDb().auditLogRecords;
}

export function listExchangeConnections() {
  return readThoonDb().exchangeRecords;
}

export function listWalletConnections() {
  return readThoonDb().walletRecords;
}

export function getRiskRules() {
  return readThoonDb().riskRulesRecord;
}

export function getTradeLimits() {
  return readThoonDb().tradeLimitsRecord;
}

export function listBotIds(): string[] {
  return readThoonDb().botRecords.map((bot) => bot.id);
}

export function listStrategyIds(): string[] {
  return listStrategies().map((strategy) => strategy.id);
}

export function listStrategies() {
  const { strategyRecords, strategyResearchRecords } = readThoonDb();

  return visibleStrategyRecords(strategyRecords, strategyResearchRecords);
}

export function listChartStrategies(): Strategy[] {
  return listStrategies().map((strategy) => ({
    id: strategy.id,
    market: strategy.market,
    name: strategy.name,
    performance30d: strategy.performance30d,
    positionDraft: strategy.positionDraft,
    riskPerTrade: strategy.riskPerTrade,
    status: strategy.status,
    timeframe: strategy.timeframe,
    type: strategy.type,
    updatedAt: strategy.updatedAt,
  }));
}

export function getStrategy(id: string) {
  const { strategyRecords, strategyResearchRecords } = readThoonDb();

  return findVisibleStrategyRecord(strategyRecords, strategyResearchRecords, id);
}

export function listBacktestReports() {
  return readThoonDb().backtestReportRecords.filter((report) => report.source === 'calculated');
}

export function listBacktestReportSummaries(): BacktestReport[] {
  return listBacktestReports().map(toBacktestReportSummary);
}

export function listChartBacktestReports(): BacktestReport[] {
  return listBacktestReports().map(toBacktestReportSummary);
}

function toBacktestReportSummary(report: BacktestReport): BacktestReport {
  return {
    buyHoldReturn: report.buyHoldReturn,
    candleCount: report.candleCount,
    dataWindow: report.dataWindow,
    drawdown: report.drawdown,
    engine: report.engine,
    executionSettings: report.executionSettings,
    feesPct: report.feesPct,
    exchangeId: report.exchangeId,
    exchangeName: report.exchangeName,
    generatedAt: report.generatedAt,
    id: report.id,
    initialCapital: report.initialCapital,
    losingTrades: report.losingTrades,
    market: report.market,
    marketDataSource: report.marketDataSource,
    netProfit: report.netProfit,
    openPosition: report.openPosition,
    period: report.period,
    profitFactor: report.profitFactor,
    slippagePct: report.slippagePct,
    source: report.source,
    strategyId: report.strategyId,
    timeframe: report.timeframe,
    totalTrades: report.totalTrades,
    warnings: report.warnings,
    winRate: report.winRate,
    winningTrades: report.winningTrades,
  };
}

export function listEndorsedStrategies() {
  const db = readThoonDb();

  return buildEndorsedStrategies({
    backtests: db.backtestReportRecords.filter((report) => report.source === 'calculated'),
    paperSessions: db.paperTestSessionRecords,
    settings: db.agentSettingsRecord,
    strategies: visibleStrategyRecords(db.strategyRecords, db.strategyResearchRecords),
  });
}

export function getAgentSettings() {
  return readThoonDb().agentSettingsRecord;
}

export function getAgentAiStatus() {
  return getStrategyAgentAiStatus();
}

export function listAgentChatMessages() {
  return visibleAgentChatMessages(readThoonDb().agentChatRecords);
}

export function getKronosProfile() {
  return getKronosIntegrationProfile();
}

export function getKronosLearningState() {
  const records = readThoonDb().kronosForecastRecords;

  return {
    profile: getKronosLearningProfile(records),
    records,
  };
}

export function getTradingViewMcpIntegrationProfile() {
  return getTradingViewMcpProfile();
}

export function listStrategyVersions(strategyId?: string) {
  const versions = readThoonDb().strategyVersionRecords;

  return strategyId ? versions.filter((version) => version.strategyId === strategyId) : versions;
}

export function listAgentSuggestions(strategyId?: string) {
  const suggestions = readThoonDb().agentSuggestionRecords;

  return strategyId ? suggestions.filter((suggestion) => suggestion.strategyId === strategyId) : suggestions;
}

export function listAgentRuns(strategyId?: string) {
  const runs = readThoonDb().agentRunRecords;

  return strategyId ? runs.filter((run) => run.strategyId === strategyId) : runs;
}

export function listAgentReports(strategyId?: string) {
  const reports = readThoonDb().agentReportRecords;

  return strategyId ? reports.filter((report) => report.strategyId === strategyId) : reports;
}

export function listAgentQueueTasks(strategyId?: string) {
  const tasks = readThoonDb().agentQueueRecords;

  return strategyId ? tasks.filter((task) => task.strategyId === strategyId) : tasks;
}

export function listStrategyResearchRecords(strategyId?: string) {
  const records = readThoonDb().strategyResearchRecords;

  return strategyId ? records.filter((record) => record.strategyId === strategyId) : records;
}

export function getAlertsWorkspaceSummary(pair?: string): WorkspaceSummary {
  const filteredAlerts = pair ? readThoonDb().alertRecords.filter((alert) => alert.symbol === pair) : readThoonDb().alertRecords;

  return {
    actionLabel: 'Create',
    eyebrow: pair ?? 'Triggers',
    metrics: [
      { label: 'Active', tone: 'positive', value: String(filteredAlerts.filter((alert) => alert.status === 'active').length) },
      { label: 'Price', value: String(filteredAlerts.filter((alert) => alert.type === 'price').length) },
      { label: 'Strategy', value: String(filteredAlerts.filter((alert) => alert.type === 'strategy').length) },
    ],
    rows: filteredAlerts.slice(0, 4).map((alert) => ({
      href: `/charts?pair=${encodeURIComponent(alert.symbol)}`,
      primary: alert.symbol,
      secondary: `${alert.type} · ${alert.condition}`,
      status: alert.value,
      tone: alert.status === 'active' ? 'positive' : 'neutral',
    })),
    title: pair ? 'Alerts Filtered' : 'Alerts',
  };
}

export function getCreateStrategySummary(pair?: string): WorkspaceSummary {
  const { riskRulesRecord } = readThoonDb();

  return {
    actionLabel: 'Backtest',
    actionHref: '/backtest',
    eyebrow: 'Strategy',
    metrics: [
      { label: 'Mode', value: 'Draft' },
      { label: 'Risk', value: `${riskRulesRecord.maxRiskPerTrade}%` },
      { label: 'Stop', tone: 'positive', value: 'Required' },
    ],
    rows: [
      { primary: 'Market', secondary: pair ?? 'BTC/USDT default', status: pair ? 'prefilled' : 'select', href: '/markets' },
      { primary: 'Entry', secondary: 'Conditions builder', status: 'ready' },
      { primary: 'Risk', secondary: 'Stop-loss required', status: 'locked', tone: 'positive' },
    ],
    title: 'Create Strategy',
  };
}

export function getStrategyDetailSummary(id: string): WorkspaceSummary | undefined {
  const { backtestReportRecords, botRecords, strategyRecords, strategyResearchRecords } = readThoonDb();
  const strategy = findVisibleStrategyRecord(strategyRecords, strategyResearchRecords, id);

  if (!strategy) {
    return undefined;
  }

  const linkedBots = botRecords.filter((bot) => canonicalStrategyId(bot.strategyId) === strategy.id);
  const report = backtestReportRecords.find((item) => canonicalStrategyId(item.strategyId) === strategy.id);

  return {
    actionLabel: 'Backtest',
    actionHref: '/backtest',
    eyebrow: strategy.market,
    metrics: [
      { label: 'Status', tone: strategy.status === 'active' ? 'positive' : 'neutral', value: strategy.status },
      { label: '30D', tone: toneFromNumber(strategy.performance30d), value: formatPercent(strategy.performance30d) },
      { label: 'Bots', value: String(linkedBots.length) },
    ],
    rows: [
      { href: '/charts', primary: 'Open on Chart', secondary: `${strategy.market} · ${strategy.timeframe}`, status: 'chart' },
      { href: '/bots/new', primary: 'Create Bot', secondary: strategy.name, status: 'ready' },
      {
        href: '/backtest',
        primary: 'Backtest',
        secondary: report ? `${report.period} · ${report.totalTrades} trades` : 'No report',
        status: report ? `${report.profitFactor.toFixed(2)} PF` : 'run',
        tone: report && report.profitFactor > 1 ? 'positive' : 'neutral',
      },
    ],
    title: strategy.name,
  };
}

export function getCreateBotSummary(): WorkspaceSummary {
  const { riskRulesRecord } = readThoonDb();

  return {
    actionLabel: 'Save Draft',
    eyebrow: 'Automation',
    metrics: [
      { label: 'Mode', value: 'Paper' },
      { label: 'Max DD', tone: 'negative', value: `${riskRulesRecord.stopBotsAtDrawdown}%` },
      { label: 'Risk', value: `${riskRulesRecord.maxRiskPerTrade}%` },
    ],
    rows: [
      { href: '/strategies', primary: 'Strategy', secondary: 'Choose source rules', status: 'required' },
      { href: '/exchanges', primary: 'Exchange', secondary: 'Paper first', status: 'safe', tone: 'positive' },
      { href: '/preferences/risk-rules', primary: 'Risk Engine', secondary: 'Stop-loss required', status: 'locked', tone: 'positive' },
    ],
    title: 'Create Bot',
  };
}

export function getBotDetailSummary(id: string): WorkspaceSummary | undefined {
  const { botRecords, strategyRecords, strategyResearchRecords } = readThoonDb();
  const bot = botRecords.find((item) => item.id === id);

  if (!bot) {
    return undefined;
  }

  const strategy = findVisibleStrategyRecord(strategyRecords, strategyResearchRecords, bot.strategyId);

  return {
    actionLabel: 'Open Chart',
    actionHref: '/charts',
    eyebrow: bot.symbol,
    metrics: [
      { label: 'Status', tone: bot.status === 'running' ? 'positive' : 'neutral', value: bot.status },
      { label: 'PnL', tone: toneFromNumber(bot.pnl), value: formatUsd(bot.pnl) },
      { label: 'Win Rate', value: `${bot.winRate}%` },
    ],
    rows: [
      { href: strategy ? `/strategies/${strategy.id}` : '/strategies', primary: 'Strategy', secondary: strategy?.name ?? bot.strategyId, status: 'linked' },
      { href: '/orders', primary: 'Positions', secondary: `${bot.exchange} · ${bot.mode}`, status: bot.status },
      { href: '/preferences/audit-logs', primary: 'Logs', secondary: bot.id, status: 'open' },
    ],
    title: bot.name,
  };
}

export function getPreferenceSectionSummary(section: PreferenceSectionKey): WorkspaceSummary {
  const config = preferenceSectionConfig()[section];

  return {
    actionLabel: 'Save',
    eyebrow: 'Preferences',
    metrics: config.metrics,
    rows: config.rows,
    title: config.title,
  };
}

function buildPreferenceRows(): WorkspaceRow[] {
  const { apiKeyRecords, auditLogRecords, tradeLimitsRecord, userPreferencesRecord, userProfileRecord } = readThoonDb();

  return [
    { href: '/preferences/profile', primary: 'Profile', secondary: userProfileRecord.timezone, status: userProfileRecord.language },
    { href: '/preferences/appearance', primary: 'Appearance', secondary: userPreferencesRecord.density, status: userPreferencesRecord.theme },
    { href: '/preferences/trading-defaults', primary: 'Trading Defaults', secondary: `${userPreferencesRecord.defaultLeverage}x leverage`, status: `${userPreferencesRecord.defaultRiskPerTrade}%` },
    { href: '/preferences/security', primary: 'Security', secondary: 'Confirm critical actions', status: 'locked', tone: 'positive' },
    { href: '/exchanges', primary: 'Exchanges', secondary: `${apiKeyRecords.length} masked keys · CEX/DEX`, status: 'open' },
    { href: '/preferences/data-privacy', primary: 'Data & Privacy', secondary: 'Local JSON DB', status: 'clean', tone: 'positive' },
    { href: '/preferences/risk-rules', primary: 'Risk Rules', secondary: 'Stop-loss required', status: 'locked', tone: 'positive' },
    { href: '/preferences/trade-limits', primary: 'Trade Limits', secondary: `${tradeLimitsRecord.maxOrdersPerDay} orders/day`, status: 'set' },
    { href: '/preferences/audit-logs', primary: 'Audit Logs', secondary: `${auditLogRecords.length} latest`, status: 'open' },
  ];
}

function preferenceSectionConfig(): Record<PreferenceSectionKey, Pick<WorkspaceSummary, 'metrics' | 'rows' | 'title'>> {
  const {
    auditLogRecords,
    riskRulesRecord,
    tradeLimitsRecord,
    userPreferencesRecord,
    userProfileRecord,
  } = readThoonDb();

  return {
    profile: {
      metrics: [
        { label: 'Name', value: userProfileRecord.name },
        { label: 'Currency', value: userProfileRecord.mainCurrency },
        { label: 'Timezone', value: userProfileRecord.timezone },
      ],
      rows: [
        { primary: 'Username', secondary: userProfileRecord.email, status: userProfileRecord.username },
        { primary: 'Language', secondary: userProfileRecord.country, status: userProfileRecord.language },
        { primary: 'Experience', secondary: 'Used for defaults only', status: userProfileRecord.tradingExperience },
      ],
      title: 'Profile',
    },
    appearance: {
      metrics: [
        { label: 'Theme', value: userPreferencesRecord.theme },
        { label: 'Accent', value: userPreferencesRecord.accent },
        { label: 'Density', value: userPreferencesRecord.density },
      ],
      rows: [
        { primary: 'Chart Preset', secondary: 'Dark terminal', status: 'active' },
        { primary: 'Sidebar', secondary: 'Compact main nav', status: 'auto' },
        { primary: 'Motion', secondary: 'Minimal transitions', status: 'on' },
      ],
      title: 'Appearance',
    },
    'trading-defaults': {
      metrics: [
        { label: 'Risk', value: `${userPreferencesRecord.defaultRiskPerTrade}%` },
        { label: 'Leverage', value: `${userPreferencesRecord.defaultLeverage}x` },
        { label: 'Order', value: userPreferencesRecord.orderType },
      ],
      rows: [
        { primary: 'Stop-loss', secondary: 'Required before live order', status: 'locked', tone: 'positive' },
        { primary: 'Take Profit', secondary: 'Single target default', status: 'TP1' },
        { primary: 'Exchange', secondary: 'Default execution venue', status: userPreferencesRecord.defaultExchange },
      ],
      title: 'Trading Defaults',
    },
    security: {
      metrics: [
        { label: 'Live Confirm', tone: 'positive', value: riskRulesRecord.confirmLiveOrders ? 'On' : 'Off' },
        { label: 'Kill Switch', value: riskRulesRecord.emergencyKillSwitch ? 'On' : 'Off' },
        { label: 'Disconnect', tone: 'positive', value: riskRulesRecord.cancelOnDisconnect ? 'Cancel' : 'Hold' },
      ],
      rows: [
        { primary: 'Critical Actions', secondary: 'Live order, bots, API revoke', status: 'confirm' },
        { primary: 'API', secondary: 'Masked keys only in UI', status: 'safe', tone: 'positive' },
        { primary: 'Withdrawals', secondary: 'Always disabled', status: 'off', tone: 'positive' },
      ],
      title: 'Security',
    },
    'data-privacy': {
      metrics: [
        { label: 'Exports', value: 'Manual' },
        { label: 'Storage', value: 'Local DB' },
        { label: 'Secrets', tone: 'positive', value: 'Hidden' },
      ],
      rows: [
        { primary: 'API Keys', secondary: 'Never exposed client-side', status: 'masked', tone: 'positive' },
        { primary: 'Trading Logs', secondary: 'Audit trail required', status: 'on' },
        { primary: 'Data Delete', secondary: 'Confirmation required', status: 'guarded' },
      ],
      title: 'Data & Privacy',
    },
    'risk-rules': {
      metrics: [
        { label: 'Risk', value: `${riskRulesRecord.maxRiskPerTrade}%` },
        { label: 'Daily Loss', tone: 'negative', value: `${riskRulesRecord.dailyLossLimit}%` },
        { label: 'Leverage', value: `${riskRulesRecord.maxLeverage}x` },
      ],
      rows: [
        { primary: 'Stop-loss', secondary: 'Block live orders without stop', status: 'on', tone: 'positive' },
        { primary: 'Drawdown', secondary: 'Stop bots at max drawdown', status: `${riskRulesRecord.stopBotsAtDrawdown}%` },
        { primary: 'Kill Switch', secondary: 'Manual emergency stop', status: riskRulesRecord.emergencyKillSwitch ? 'on' : 'off' },
      ],
      title: 'Risk Rules',
    },
    'trade-limits': {
      metrics: [
        { label: 'Orders / day', value: String(tradeLimitsRecord.maxOrdersPerDay) },
        { label: 'Open Pos.', value: String(tradeLimitsRecord.maxOpenPositions) },
        { label: 'Exposure', value: formatCompactUsd(tradeLimitsRecord.maxTotalExposure) },
      ],
      rows: [
        { primary: 'Orders / hour', secondary: 'Execution throttle', status: String(tradeLimitsRecord.maxOrdersPerHour) },
        { primary: 'Bot Slots', secondary: 'Active automation cap', status: String(tradeLimitsRecord.maxBotSlotsActive) },
        { primary: 'API Errors', secondary: 'Pause after repeated errors', status: String(tradeLimitsRecord.maxApiErrorsBeforePause) },
      ],
      title: 'Trade Limits',
    },
    'audit-logs': {
      metrics: [
        { label: 'Events', value: String(auditLogRecords.length) },
        { label: 'Blocked', tone: 'negative', value: String(auditLogRecords.filter((log) => log.status === 'blocked').length) },
        { label: 'Warnings', tone: 'warning', value: String(auditLogRecords.filter((log) => log.status === 'warning').length) },
      ],
      rows: auditLogRecords.map((log) => ({
        primary: log.action,
        secondary: `${log.actor} · ${log.eventType}`,
        status: log.status,
        tone: log.status === 'success' ? 'positive' : log.status === 'blocked' ? 'negative' : 'warning',
      })),
      title: 'Audit Logs',
    },
  };
}

function average(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function toneFromNumber(value: number): MetricTone {
  if (value > 0) {
    return 'positive';
  }

  if (value < 0) {
    return 'negative';
  }

  return 'neutral';
}
