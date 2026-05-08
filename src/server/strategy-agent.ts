import { defaultAgentSettings } from '../mock-data/strategy-agent';
import type {
  AgentAction,
  AgentActionPolicy,
  AgentDecision,
  AgentPermission,
  AgentReport,
  AgentSettings,
  AgentSuggestion,
  BacktestReport,
  Bot,
  JournalTrade,
  MarketRegime,
  RobustnessLabel,
  Strategy,
  StrategyChangeType,
  StrategyVersion,
} from '../types/trading';
import type { ThoonDb } from './thoon-db';

const dangerousActions: AgentAction[] = ['archive_variant', 'execute_live_trade', 'launch_live_bot', 'promote_version'];
const passiveActions: AgentAction[] = ['analyze_strategy', 'compare_versions', 'create_report', 'read_backtest', 'research_tradingview'];

const actionPermissions: Partial<Record<AgentAction, AgentPermission>> = {
  analyze_strategy: 'analyze_strategy',
  archive_variant: 'archive_variant',
  create_draft_bot: 'create_draft_bot',
  create_report: 'create_report',
  create_variant: 'create_variant',
  execute_live_trade: 'execute_live_trade',
  launch_live_bot: 'launch_live_bot',
  compare_versions: 'analyze_strategy',
  prepare_backtest: 'run_backtest',
  prepare_bot: 'prepare_bot',
  promote_version: 'promote_version',
  read_backtest: 'analyze_strategy',
  research_tradingview: 'analyze_strategy',
  run_backtest: 'run_backtest',
  run_paper_test: 'run_paper_test',
  send_to_paper: 'run_paper_test',
  write_journal_note: 'write_journal_note',
};

export function normalizeAgentSettings(value?: Partial<AgentSettings>): AgentSettings {
  return {
    ...defaultAgentSettings,
    ...value,
    askBefore: { ...defaultAgentSettings.askBefore, ...value?.askBefore },
    instructions: { ...defaultAgentSettings.instructions, ...value?.instructions },
    limits: { ...defaultAgentSettings.limits, ...value?.limits },
    neverWithoutConfirmation: { ...defaultAgentSettings.neverWithoutConfirmation, ...value?.neverWithoutConfirmation },
    permissions: { ...defaultAgentSettings.permissions, ...value?.permissions },
    policies: { ...defaultAgentSettings.policies, ...value?.policies },
  };
}

export function getAgentActionPolicy(settings: AgentSettings, action: AgentAction): AgentActionPolicy {
  const permission = actionPermissions[action];

  if (!settings.enabled || (permission && !settings.permissions[permission])) {
    return 'forbidden';
  }

  if (action === 'execute_live_trade' || action === 'launch_live_bot') {
    return 'forbidden';
  }

  if (settings.neverWithoutConfirmation[action] || dangerousActions.includes(action)) {
    return 'always_confirm';
  }

  if (settings.mode === 'manual') {
    return passiveActions.includes(action) ? 'auto_allowed' : 'ask_first';
  }

  if (settings.askBefore[action]) {
    return 'ask_first';
  }

  return settings.policies[action] ?? (passiveActions.includes(action) ? 'auto_allowed' : 'ask_first');
}

export function evaluateAgentAction(
  db: ThoonDb,
  action: AgentAction,
  context: { confirmed?: boolean; strategyId?: string; versionId?: string } = {},
): AgentDecision {
  const settings = normalizeAgentSettings(db.agentSettingsRecord);
  const permission = actionPermissions[action];
  const policy = getAgentActionPolicy(settings, action);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const version = context.versionId ? db.strategyVersionRecords.find((item) => item.id === context.versionId) : undefined;
  const strategy = context.strategyId ? db.strategyRecords.find((item) => item.id === context.strategyId) : version ? db.strategyRecords.find((item) => item.id === version.strategyId) : undefined;

  if (!settings.enabled) {
    blockers.push('Strategy Agent is disabled.');
  }

  if (policy === 'forbidden') {
    blockers.push('This action is forbidden by Strategy Agent permissions.');
  }

  if (permission && !settings.permissions[permission]) {
    blockers.push(`Missing permission: ${permission}.`);
  }

  if (!strategy && action !== 'compare_versions') {
    blockers.push('No linked strategy was found.');
  }

  if (version?.protectedOriginal && (action === 'archive_variant' || action === 'promote_version')) {
    blockers.push('The protected original strategy version cannot be archived or replaced.');
  }

  if (strategy && !settings.limits.allowedMarkets.includes(strategy.market)) {
    blockers.push(`${strategy.market} is outside the Strategy Agent allowed market scope.`);
  }

  if (strategy && !settings.limits.allowedTimeframes.includes(strategy.timeframe)) {
    blockers.push(`${strategy.timeframe} is outside the Strategy Agent allowed timeframe scope.`);
  }

  if (strategy && strategy.riskPerTrade > db.riskRulesRecord.maxRiskPerTrade) {
    blockers.push('Strategy risk per trade is above Risk Rules.');
  }

  if (action === 'promote_version') {
    if (settings.limits.paperRequiredBeforeLive && version?.stage !== 'paper_tested' && version?.stage !== 'candidate' && version?.stage !== 'bot_draft') {
      blockers.push('Paper validation is required before promotion.');
    }

    if ((version?.backtestSummary?.totalTrades ?? 0) < settings.limits.minTrades) {
      blockers.push(`Minimum ${settings.limits.minTrades} trades required before promotion.`);
    }

    if (Math.abs(version?.backtestSummary?.drawdown ?? 0) > settings.limits.maxDrawdownCandidate) {
      blockers.push('Drawdown is above candidate limit.');
    }
  }

  if (action === 'run_backtest') {
    const runsToday = db.agentRunRecords.filter((run) => run.action === 'run_backtest' && run.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;

    if (runsToday >= settings.limits.maxBacktestsPerDay) {
      blockers.push('Daily Strategy Agent backtest limit reached.');
    }
  }

  if (action === 'create_variant') {
    const variantsToday = db.strategyVersionRecords.filter((item) => item.createdBy === 'agent' && item.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;

    if (variantsToday >= settings.limits.maxVariantsPerDay) {
      blockers.push('Daily Strategy Agent variant limit reached.');
    }
  }

  if (action === 'run_paper_test' || action === 'send_to_paper') {
    warnings.push('Paper testing is simulated and never sends live orders.');
  }

  if (action === 'research_tradingview') {
    warnings.push('Only public TradingView metadata and visible concepts are saved; protected/private source code is never copied.');
  }

  if (action === 'prepare_bot' || action === 'create_draft_bot') {
    warnings.push('Bot mode stays paper by default. Live launch remains blocked by confirmation and Risk Engine.');
  }

  if (version?.overfittingWarnings.length) {
    warnings.push(...version.overfittingWarnings.slice(0, 2));
  }

  const requiredConfirmation = (policy === 'ask_first' || policy === 'always_confirm') && !context.confirmed;

  return {
    action,
    allowed: blockers.length === 0,
    blockers,
    permission,
    policy,
    requiredConfirmation,
    riskEngineResult: {
      allowed: blockers.length === 0,
      checked: ['permission', 'autonomy mode', 'risk rules', 'core protection', 'paper requirement'],
    },
    suggestedSafeAction: blockers.length ? 'Review agent permissions, scope and Risk Rules before retrying.' : undefined,
    warnings,
  };
}

export function buildAgentSuggestions(db: ThoonDb, strategyId?: string): AgentSuggestion[] {
  const strategies = strategyId ? db.strategyRecords.filter((strategy) => strategy.id === strategyId) : db.strategyRecords;
  const generated = strategies.flatMap((strategy) => {
    const report = latestBacktest(db, strategy.id);
    const version = latestVersion(db, strategy.id);
    const suggestions: AgentSuggestion[] = [];

    if (!report) {
      suggestions.push(makeSuggestion(strategy, version, 'test_timeframe', 'Run first backtest', 'No backtest is linked yet.', 'prepare_backtest', false));
      return suggestions;
    }

    if (report.totalTrades < db.agentSettingsRecord.limits.minTrades) {
      suggestions.push(makeSuggestion(strategy, version, 'test_market', 'Add out-of-sample test', 'Sample size is below the minimum trade threshold.', 'run_backtest', true, 'minor'));
    }

    if (Math.abs(report.drawdown) > db.agentSettingsRecord.limits.maxDrawdownCandidate) {
      suggestions.push(makeSuggestion(strategy, version, 'reduce_risk', 'Reduce risk before retest', 'Drawdown is above candidate limit.', 'create_variant', true, 'minor'));
    }

    if (report.profitFactor >= db.agentSettingsRecord.limits.minProfitFactor && report.totalTrades >= db.agentSettingsRecord.limits.minTrades) {
      suggestions.push(makeSuggestion(strategy, version, 'send_to_paper', 'Prepare paper validation', 'Backtest passes the first robustness gate.', 'run_paper_test', true));
    }

    if (report.profitFactor < 1) {
      suggestions.push(makeSuggestion(strategy, version, 'archive_weak_variant', 'Keep variant under review', 'Profit factor is below 1.0.', 'create_report', false));
    }

    return suggestions;
  });

  return generated.slice(0, 3);
}

export function createVariant(db: ThoonDb, strategy: Strategy, parentVersion?: StrategyVersion): StrategyVersion {
  const baseVersion = parentVersion ?? latestVersion(db, strategy.id);
  const nextVersion = nextMinorVersion(baseVersion?.version ?? 'v1.0');
  const report = latestBacktest(db, strategy.id);
  const robustness = calculateRobustness(report, undefined, db.agentSettingsRecord.limits.minTrades);

  return {
    backtestSummary: report ? toBacktestSummary(report) : undefined,
    changeSummary: 'Agent draft variant: keep jimmy logic, tighten validation scope and reduce weak-regime exposure.',
    changeType: 'minor',
    createdAt: new Date().toISOString(),
    createdBy: 'agent',
    id: `ver-${slug(strategy.id)}-${slug(nextVersion)}-${Date.now()}`,
    marketRegimeTags: [detectMarketRegime(strategy, report)],
    marketsTested: [strategy.market],
    overfittingWarnings: overfittingWarnings(report),
    parentVersionId: baseVersion?.id,
    protectedOriginal: false,
    riskProfile: {
      maxDrawdownAllowed: db.agentSettingsRecord.limits.maxDrawdownCandidate,
      maxLeverage: db.riskRulesRecord.maxLeverage,
      riskPerTrade: Math.min(strategy.riskPerTrade, db.riskRulesRecord.maxRiskPerTrade),
      stopLossRequired: db.riskRulesRecord.blockOrdersWithoutStop,
    },
    robustnessLabel: robustness.label,
    robustnessScore: robustness.score,
    stage: 'draft',
    status: 'draft',
    strategyId: strategy.id,
    timeframesTested: [strategy.timeframe],
    version: nextVersion,
  };
}

export function compareVersions(versions: StrategyVersion[]) {
  return versions
    .slice()
    .sort((left, right) => right.robustnessScore - left.robustnessScore)
    .map((version) => ({
      id: version.id,
      label: version.version,
      score: version.robustnessScore,
      stage: version.stage,
      status: version.status,
    }));
}

export function promoteVersion(version: StrategyVersion): StrategyVersion {
  return {
    ...version,
    stage: version.stage === 'paper_tested' ? 'candidate' : version.stage,
    status: version.stage === 'paper_tested' ? 'candidate' : version.status,
  };
}

export function archiveVersion(version: StrategyVersion): StrategyVersion {
  if (version.protectedOriginal) {
    return version;
  }

  return {
    ...version,
    stage: 'archived',
    status: 'archived',
  };
}

export function createAgentReport(db: ThoonDb, strategy: Strategy, version?: StrategyVersion): AgentReport {
  const report = version?.backtestSummary ?? latestBacktest(db, strategy.id);
  const paper = version?.paperSummary;
  const risks = [...(version?.overfittingWarnings ?? [])];

  if (!paper && db.agentSettingsRecord.limits.paperRequiredBeforeLive) {
    risks.push('Paper validation missing.');
  }

  return {
    backtestSummary: report ? toBacktestSummary(report) : undefined,
    createdAt: new Date().toISOString(),
    details: [
      `${strategy.name} remains linked to ${strategy.market} on ${strategy.timeframe}.`,
      version?.changeSummary ?? 'No variant change summary available.',
      `Risk per trade stays capped at ${Math.min(strategy.riskPerTrade, db.riskRulesRecord.maxRiskPerTrade)}%.`,
    ],
    id: `agent-report-${slug(strategy.id)}-${Date.now()}`,
    marketsTested: version?.marketsTested ?? [strategy.market],
    nextAction: paper ? 'Compare paper results with backtest before bot draft.' : 'Prepare paper validation.',
    paperSummary: paper,
    periodTested: report?.period ?? 'Not tested',
    recommendations: buildAgentSuggestions(db, strategy.id).map((suggestion) => suggestion.title),
    risks,
    status: paper ? 'bot_candidate' : report ? 'paper_candidate' : 'needs_test',
    strategyId: strategy.id,
    strengths: report && report.profitFactor >= 1.25 ? ['Profit factor above minimum', 'Risk rules respected'] : ['jimmy logic preserved'],
    summary: [
      `${strategy.name} analyzed.`,
      report ? `${report.profitFactor.toFixed(2)} PF over ${report.totalTrades} trades.` : 'Backtest needed.',
      paper ? `${paper.durationDays} paper days recorded.` : 'Paper validation missing.',
      risks.length ? 'Warnings require review.' : 'No critical warning.',
    ],
    timeframesTested: version?.timeframesTested ?? [strategy.timeframe],
    versionId: version?.id,
    weaknesses: risks.length ? risks : ['Needs more validation before live-ready.'],
  };
}

export function createAgentJournalNote(strategy: Strategy, report?: AgentReport): JournalTrade {
  return {
    closedAt: new Date().toISOString(),
    id: `journal-agent-${slug(strategy.id)}-${Date.now()}`,
    lessons: report?.nextAction ?? 'Monitor before automation.',
    notes: `Agent: ${report?.summary.slice(0, 2).join(' ') ?? `${strategy.name} reviewed.`}`,
    pnl: 0,
    rMultiple: 0,
    side: 'long',
    source: 'paper',
    symbol: strategy.market,
    tag: 'Agent',
  };
}

export function createDraftBotFromVersion(strategy: Strategy, version?: StrategyVersion): Bot {
  return {
    allocatedCapital: 5000,
    exchange: 'Paper',
    id: `bot-agent-${slug(strategy.id)}-${Date.now()}`,
    maxDrawdown: 0,
    mode: 'paper',
    name: `${strategy.name} ${version?.version ?? 'Agent'} Draft`,
    pnl: 0,
    riskPerTrade: Math.min(strategy.riskPerTrade, version?.riskProfile.riskPerTrade ?? strategy.riskPerTrade),
    status: 'draft',
    strategyId: strategy.id,
    symbol: strategy.market,
    winRate: 0,
  };
}

export function updateVersionWithBacktest(version: StrategyVersion, report: BacktestReport, minTrades: number): StrategyVersion {
  const robustness = calculateRobustness(report, version.paperSummary, minTrades);

  return {
    ...version,
    backtestSummary: toBacktestSummary(report),
    marketRegimeTags: Array.from(new Set([...version.marketRegimeTags, detectMarketRegime({ market: version.marketsTested[0] ?? 'BTC/USDT', timeframe: version.timeframesTested[0] ?? '15m' } as Strategy, report)])),
    overfittingWarnings: overfittingWarnings(report),
    robustnessLabel: robustness.label,
    robustnessScore: robustness.score,
    stage: version.stage === 'draft' ? 'backtested' : version.stage,
    status: version.status === 'draft' ? 'testing' : version.status,
  };
}

function makeSuggestion(
  strategy: Strategy,
  version: StrategyVersion | undefined,
  type: AgentSuggestion['type'],
  title: string,
  reason: string,
  actionType: AgentAction,
  confirmationRequired: boolean,
  changeType?: StrategyChangeType,
): AgentSuggestion {
  return {
    action: title,
    actionType,
    changeType,
    confidence: type === 'send_to_paper' ? 0.74 : 0.66,
    confirmationRequired,
    createdAt: new Date().toISOString(),
    details: ['jimmy logic remains protected.', 'Risk Engine has final priority.'],
    id: `agent-sug-${slug(strategy.id)}-${slug(title)}-${Date.now()}`,
    impact: confirmationRequired ? 'Requires review before execution.' : 'Passive analysis only.',
    reason,
    risk: type === 'reduce_risk' ? 'medium' : 'low',
    strategyId: strategy.id,
    title,
    type,
    versionId: version?.id,
  };
}

function latestBacktest(db: ThoonDb, strategyId: string) {
  return db.backtestReportRecords.find((report) => report.strategyId === strategyId);
}

function latestVersion(db: ThoonDb, strategyId: string) {
  return db.strategyVersionRecords.find((version) => version.strategyId === strategyId && !version.protectedOriginal) ?? db.strategyVersionRecords.find((version) => version.strategyId === strategyId);
}

function toBacktestSummary(report: BacktestReport | StrategyVersion['backtestSummary']) {
  return report
    ? {
        drawdown: report.drawdown,
        netProfit: report.netProfit,
        period: report.period,
        profitFactor: report.profitFactor,
        totalTrades: report.totalTrades,
        winRate: report.winRate,
      }
    : undefined;
}

function detectMarketRegime(strategy: Strategy, report?: BacktestReport | StrategyVersion['backtestSummary']): MarketRegime {
  if (report && Math.abs(report.drawdown) > 10) {
    return 'high_volatility';
  }

  if (strategy.type === 'breakout') {
    return 'breakout';
  }

  if (strategy.type === 'mean-reversion') {
    return 'range';
  }

  return strategy.performance30d >= 0 ? 'trend_up' : 'trend_down';
}

function calculateRobustness(report: BacktestReport | StrategyVersion['backtestSummary'] | undefined, paper: StrategyVersion['paperSummary'], minTrades: number): { label: RobustnessLabel; score: number } {
  if (!report) {
    return { label: 'weak', score: 20 };
  }

  let score = 45;
  score += Math.min(25, report.profitFactor * 12);
  score += Math.min(15, report.winRate / 5);
  score += report.totalTrades >= minTrades ? 12 : -12;
  score -= Math.min(20, Math.abs(report.drawdown));

  if (paper) {
    score += paper.respectsRules ? 8 : -10;
    score += paper.trades >= minTrades ? 5 : -6;
  }

  const normalized = Math.max(0, Math.min(100, Math.round(score)));

  return { label: robustnessLabel(normalized), score: normalized };
}

function overfittingWarnings(report?: BacktestReport | StrategyVersion['backtestSummary']) {
  if (!report) {
    return ['No backtest evidence yet'];
  }

  const warnings: string[] = [];

  if (report.totalTrades < 30) {
    warnings.push('Too few trades');
  }

  if (report.profitFactor > 3 && report.totalTrades < 40) {
    warnings.push('High profit factor with short sample');
  }

  if (Math.abs(report.drawdown) < 2 && report.totalTrades < 25) {
    warnings.push('Suspiciously low drawdown with short sample');
  }

  if (Math.abs(report.drawdown) > 10) {
    warnings.push('Drawdown above robust candidate threshold');
  }

  return warnings;
}

function robustnessLabel(score: number): RobustnessLabel {
  if (score >= 85) {
    return 'candidate';
  }

  if (score >= 75) {
    return 'strong';
  }

  if (score >= 60) {
    return 'acceptable';
  }

  if (score >= 40) {
    return 'unstable';
  }

  return 'weak';
}

function nextMinorVersion(version: string) {
  const match = version.match(/^v(\d+)\.(\d+)$/);

  if (!match) {
    return 'v1.1';
  }

  return `v${match[1]}.${Number(match[2]) + 1}`;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
