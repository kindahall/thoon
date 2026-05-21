import { checkBudLiveReadiness, getBudResearchEvaluations, getBudResearchRuns, getBudResearchStrategies } from './bud-backend-client';
import { readThoonDb } from './thoon-db';
import { visibleStrategyRecords } from '../utils/strategy-catalog';

type GateStatus = 'blocked' | 'passed' | 'todo' | 'warning';

type HedgeFundGate = {
  blockers: string[];
  evidence: string[];
  id: string;
  nextActions: string[];
  roadmapStatus: 'DONE' | 'TODO';
  score: number;
  status: GateStatus;
  step: number;
  title: string;
};

type BudResearchSnapshot = {
  errors: string[];
  evaluations: Record<string, unknown>[];
  runs: Record<string, unknown>[];
  strategies: Record<string, unknown>[];
};

export type HedgeFundReadiness = {
  blockers: string[];
  generatedAt: string;
  gates: HedgeFundGate[];
  liveReady: boolean;
  roadmap: string;
  score: number;
  source: 'thoon_hedge_fund_readiness';
  status: 'not_ready' | 'ready';
  summary: {
    activeBacktestedStrategies: number;
    activeStrategies: number;
    auditEvents: number;
    budEvaluations: number;
    budRejectedEvaluations: number;
    budSelectedEvaluations: number;
    calculatedBacktests: number;
    completedPaperSessions: number;
    connectedExchanges: number;
    liveReadyStrategies: number;
    localBacktestReports: number;
    paperSessions: number;
    paperTradesRecorded: number;
    roadmapCompletedSteps: number;
    roadmapTotalSteps: number;
    runningPaperBots: number;
    strategyVersions: number;
    visibleStrategies: number;
  };
  warnings: string[];
};

const roadmapFile = 'ROADMAP_HEDGEFUND_MODULES.md';

export async function getHedgeFundReadiness(signal?: AbortSignal): Promise<HedgeFundReadiness> {
  const db = readThoonDb();
  const strategies = visibleStrategyRecords(db.strategyRecords, db.strategyResearchRecords);
  const activeStrategies = strategies.filter((strategy) => strategy.status === 'active');
  const localBacktests = db.backtestReportRecords;
  const calculatedBacktests = localBacktests.filter((report) => report.source === 'calculated' || report.source === 'agent');
  const backtestedStrategyIds = new Set(calculatedBacktests.map((report) => report.strategyId));
  const activeBacktestedStrategies = activeStrategies.filter((strategy) => backtestedStrategyIds.has(strategy.id)).length;
  const completedPaperSessions = db.paperTestSessionRecords.filter((session) => session.status === 'completed');
  const runningPaperBots = db.botRecords.filter((bot) => bot.mode === 'paper' && bot.status === 'running').length;
  const connectedExchanges = db.exchangeRecords.filter((exchange) => exchange.status === 'connected').length;
  const activeTradeKeys = db.apiKeyRecords.filter((key) => key.status === 'active' && key.permissions.includes('trade'));
  const maxPaperDurationDays = Math.max(0, ...completedPaperSessions.map((session) => durationDays(session.createdAt, session.updatedAt)));
  const paperTradesRecorded = db.paperTestSessionRecords.reduce((total, session) => total + session.tradesRecorded, 0);
  const protectedStrategies = activeStrategies.filter((strategy) => strategy.agentSource?.protectedCore).length;
  const budResearch = await readBudResearch(signal);
  const budLiveReadiness = await readBudLiveReadiness(signal);
  const budSelectedEvaluations = budResearch.evaluations.filter((evaluation) => isDecisionStatus(evaluation, ['accepted', 'approved', 'selected'])).length;
  const budRejectedEvaluations = budResearch.evaluations.filter((evaluation) => isDecisionStatus(evaluation, ['rejected'])).length;
  const strictRiskRules =
    db.riskRulesRecord.blockOrdersWithoutStop &&
    db.riskRulesRecord.confirmLiveOrders &&
    db.riskRulesRecord.cancelOnDisconnect &&
    db.riskRulesRecord.maxRiskPerTrade <= 1 &&
    db.riskRulesRecord.maxLeverage <= 5 &&
    db.tradeLimitsRecord.maxOpenPositions <= 3;
  const liveReadyStrategies = 0;

  const gates: HedgeFundGate[] = [
    gate({
      id: 'long-term-performance-evidence',
      title: 'Performance Evidence Long Terme',
      step: 11,
      status: completedPaperSessions.length > 0 && maxPaperDurationDays >= 14 && activeBacktestedStrategies > 0 ? 'passed' : 'blocked',
      evidence: [
        `${completedPaperSessions.length} paper sessions completed`,
        `${maxPaperDurationDays} max paper days`,
        `${activeBacktestedStrategies} active strategies with calculated backtests`,
      ],
      blockers: [
        completedPaperSessions.length ? '' : 'paper_validation_missing',
        maxPaperDurationDays >= 14 ? '' : 'multi_week_paper_track_record_missing',
        activeBacktestedStrategies ? '' : 'no_active_strategy_with_calculated_backtest',
      ],
      nextActions: ['Start multi-week paper validation for selected strategies.', 'Compare paper results against BTC, ETH and cash benchmarks.'],
    }),
    gate({
      id: 'strategy-governance',
      title: 'Strategy Governance',
      step: 12,
      status: db.strategyVersionRecords.length > 0 && protectedStrategies > 0 ? 'warning' : 'blocked',
      evidence: [`${db.strategyVersionRecords.length} strategy versions`, `${protectedStrategies} protected core strategy`, `${db.auditLogRecords.length} audit events`],
      blockers: [db.strategyVersionRecords.length ? '' : 'immutable_strategy_versions_missing', db.auditLogRecords.length ? '' : 'strategy_approval_audit_missing', 'approval_workflow_not_enforced'],
      nextActions: ['Add approve/reject/retire workflow before any paper-to-live promotion.', 'Persist governance audit decisions per strategy version.'],
    }),
    gate({
      id: 'research-factory-massive',
      title: 'Research Factory Massive',
      step: 13,
      status: budResearch.evaluations.length >= 50 && budSelectedEvaluations > 0 ? 'passed' : budResearch.evaluations.length > 0 ? 'warning' : 'blocked',
      evidence: [`${budResearch.strategies.length} Bud candidates`, `${budResearch.evaluations.length} Bud evaluations`, `${budSelectedEvaluations} selected evaluations`, `${budRejectedEvaluations} rejected evaluations`],
      blockers: [
        budResearch.evaluations.length >= 50 ? '' : 'research_factory_sample_too_small',
        budSelectedEvaluations > 0 ? '' : 'no_strategy_selected_by_research_factory',
        ...budResearch.errors.map((error) => `bud_research_unavailable:${error}`),
      ],
      nextActions: ['Run larger controlled candidate sweeps across symbols and timeframes.', 'Promote only candidates that pass walk-forward and out-of-sample filters.'],
    }),
    gate({
      id: 'portfolio-risk-professional',
      title: 'Portfolio Risk Professionnel',
      step: 14,
      status: strictRiskRules ? 'warning' : 'blocked',
      evidence: [
        `risk per trade ${db.riskRulesRecord.maxRiskPerTrade}%`,
        `max leverage ${db.riskRulesRecord.maxLeverage}x`,
        `max open positions ${db.tradeLimitsRecord.maxOpenPositions}`,
        `${connectedExchanges} connected exchanges`,
      ],
      blockers: [strictRiskRules ? 'portfolio_level_var_cvar_not_proven' : 'base_risk_rules_not_strict', 'strategy_risk_contribution_missing', 'drawdown_budget_missing'],
      nextActions: ['Add portfolio exposure and contribution checks before bot launch.', 'Block launch when correlation, concentration or drawdown budget fails.'],
    }),
    gate({
      id: 'execution-quality-professional',
      title: 'Execution Quality Professionnelle',
      step: 15,
      status: db.fillRecords.length > 20 ? 'warning' : 'blocked',
      evidence: [`${db.fillRecords.length} fills`, `${db.orderHistoryRecords.length} historical orders`, `${calculatedBacktests.length} cost-aware local backtests`],
      blockers: [db.fillRecords.length > 20 ? 'post_trade_execution_quality_not_graded' : 'realized_fill_history_missing', 'realized_vs_estimated_slippage_missing', 'venue_comparison_missing'],
      nextActions: ['Persist realized slippage and spread capture for every paper/live order.', 'Compare Binance, Bybit and DEX venues after execution.'],
    }),
    gate({
      id: 'institutional-data-quality',
      title: 'Data Quality Institutionnelle',
      step: 16,
      status: calculatedBacktests.some((report) => report.dataWindow?.candleChecksum) ? 'warning' : 'blocked',
      evidence: [`${calculatedBacktests.length} calculated backtests`, `${calculatedBacktests.filter((report) => report.dataWindow?.candleChecksum).length} reports with candle checksum`, `${db.kronosForecastRecords.length} forecast records`],
      blockers: ['decision_data_lineage_not_complete', 'dataset_snapshot_replay_not_proven', 'stale_data_gate_not_enforced_for_all_decisions'],
      nextActions: ['Attach data lineage and replay snapshot to each decision.', 'Block decisions if source freshness or exchange sanity checks fail.'],
    }),
    gate({
      id: 'model-risk-management',
      title: 'Model Risk Management',
      step: 17,
      status: db.agentRunRecords.length > 0 ? 'warning' : 'blocked',
      evidence: [`${db.agentRunRecords.length} agent runs`, `agent mode ${db.agentSettingsRecord.mode}`, `${db.agentReportRecords.length} agent reports`],
      blockers: ['model_registry_missing', 'prompt_version_audit_missing', 'llm_output_drift_checks_missing'],
      nextActions: ['Record model, prompt and schema version for every agent decision.', 'Block live decisions when model risk score is high.'],
    }),
    gate({
      id: 'operations-24-7',
      title: 'Operations 24/7',
      step: 18,
      status: 'blocked',
      evidence: [`Bud live readiness response ${budLiveReadiness.available ? 'available' : 'unavailable'}`, `${db.alertRecords.length} alert rules`, `kill switch ${db.riskRulesRecord.emergencyKillSwitch ? 'active' : 'clear'}`],
      blockers: ['24_7_alerting_not_proven', 'operator_reports_missing', 'incident_runbook_not_executable'],
      nextActions: ['Add operator daily/weekly reports and alert routing.', 'Test restart, degraded mode and maintenance mode flows.'],
    }),
    gate({
      id: 'institutional-security-secrets',
      title: 'Security Et Secrets Institutionnels',
      step: 19,
      status: activeTradeKeys.length === 0 && db.riskRulesRecord.confirmLiveOrders ? 'warning' : 'blocked',
      evidence: [`${db.apiKeyRecords.length} saved API keys`, `${activeTradeKeys.length} active trade keys`, `confirm live orders ${String(db.riskRulesRecord.confirmLiveOrders)}`],
      blockers: [activeTradeKeys.length === 0 ? 'trade_keys_not_configured_for_live_review' : 'active_trade_keys_require_rotation_review', 'secret_rotation_status_missing', 'access_audit_missing'],
      nextActions: ['Add secrets status endpoint and key rotation evidence.', 'Keep withdrawal permissions disabled and audit every access.'],
    }),
    gate({
      id: 'compliance-audit',
      title: 'Compliance Et Audit',
      step: 20,
      status: db.auditLogRecords.length > 0 ? 'warning' : 'blocked',
      evidence: [`${db.auditLogRecords.length} audit events`, `${db.orderHistoryRecords.length} order lifecycle records`, `${db.journalTradeRecords.length} journal trades`],
      blockers: [db.auditLogRecords.length ? 'audit_export_search_not_proven' : 'audit_trail_empty', 'decision_snapshots_missing', 'retention_policy_not_enforced'],
      nextActions: ['Persist immutable decision, risk and order snapshots.', 'Add audit export/search before live promotion.'],
    }),
    gate({
      id: 'disaster-recovery',
      title: 'Disaster Recovery',
      step: 21,
      status: 'blocked',
      evidence: [`data file is local`, `${db.savedSetupRecords.length} saved setups`, `${db.strategyRecords.length} canonical strategies`],
      blockers: ['postgres_backup_not_verified', 'restore_test_missing', 'duplicate_order_recovery_not_proven'],
      nextActions: ['Run backup and restore drill against strategy registry and audit logs.', 'Verify restart from last safe state without duplicate orders.'],
    }),
    gate({
      id: 'final-live-readiness',
      title: 'Live Trading Readiness Final',
      step: 22,
      status: 'blocked',
      evidence: [`Bud live_ready ${String(budLiveReadiness.liveReady)}`, `${liveReadyStrategies} live-ready strategies`, `${activeBacktestedStrategies} active backtested strategies`],
      blockers: ['final_review_not_approved', 'human_approval_missing', ...(budLiveReadiness.blockers.length ? budLiveReadiness.blockers : ['bud_live_readiness_not_confirmed'])],
      nextActions: ['Approve final review only after every previous gate passes.', 'Start with explicit capital limits and human approval.'],
    }),
  ];

  const score = Math.round((gates.reduce((total, item) => total + item.score, 0) / gates.length) * 100);
  const blockers = Array.from(new Set(gates.flatMap((item) => item.blockers))).filter(Boolean).slice(0, 40);
  const warnings = gates.filter((item) => item.status === 'warning').map((item) => item.title);
  const ready = gates.every((item) => item.status === 'passed') && budLiveReadiness.liveReady;

  return {
    blockers,
    generatedAt: new Date().toISOString(),
    gates,
    liveReady: ready,
    roadmap: roadmapFile,
    score,
    source: 'thoon_hedge_fund_readiness',
    status: ready ? 'ready' : 'not_ready',
    summary: {
      activeBacktestedStrategies,
      activeStrategies: activeStrategies.length,
      auditEvents: db.auditLogRecords.length,
      budEvaluations: budResearch.evaluations.length,
      budRejectedEvaluations,
      budSelectedEvaluations,
      calculatedBacktests: calculatedBacktests.length,
      completedPaperSessions: completedPaperSessions.length,
      connectedExchanges,
      liveReadyStrategies,
      localBacktestReports: localBacktests.length,
      paperSessions: db.paperTestSessionRecords.length,
      paperTradesRecorded,
      roadmapCompletedSteps: 10,
      roadmapTotalSteps: 22,
      runningPaperBots,
      strategyVersions: db.strategyVersionRecords.length,
      visibleStrategies: strategies.length,
    },
    warnings,
  };
}

function gate(input: Omit<HedgeFundGate, 'roadmapStatus' | 'score'>): HedgeFundGate {
  const blockers = input.blockers.filter(Boolean);
  const status = blockers.length && input.status === 'passed' ? 'warning' : input.status;

  return {
    ...input,
    blockers,
    roadmapStatus: 'TODO',
    score: statusScore(status),
    status,
  };
}

async function readBudResearch(signal?: AbortSignal): Promise<BudResearchSnapshot> {
  const [runs, strategies, evaluations] = await Promise.allSettled([
    getBudResearchRuns(100, signal),
    getBudResearchStrategies(100, signal),
    getBudResearchEvaluations(100, signal),
  ]);

  return {
    errors: [errorFromSettled(runs), errorFromSettled(strategies), errorFromSettled(evaluations)].filter((error): error is string => Boolean(error)),
    evaluations: valuesFromSettled(evaluations),
    runs: valuesFromSettled(runs),
    strategies: valuesFromSettled(strategies),
  };
}

async function readBudLiveReadiness(signal?: AbortSignal) {
  try {
    const result = await checkBudLiveReadiness(
      {
        check_api_permissions: true,
        check_live_positions: true,
        exchanges: ['binance', 'bybit', 'bitget', 'hyperliquid', 'dydx'],
        max_allowed_live_positions: 0,
        min_paper_trades: 10,
        min_safety_score: 0.9,
        paper_symbol: 'BTCUSDT',
        require_audit_trail: true,
        require_paper_promotion_evidence: true,
        symbols: ['BTCUSDT', 'ETHUSDT'],
      },
      signal,
    );

    return {
      available: true,
      blockers: readStringArray(result.blockers),
      liveReady: result.live_ready === true,
    };
  } catch (error) {
    return {
      available: false,
      blockers: [`bud_live_readiness_unavailable:${error instanceof Error ? error.message : 'unknown'}`],
      liveReady: false,
    };
  }
}

function valuesFromSettled(result: PromiseSettledResult<Record<string, unknown>[]>) {
  return result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : [];
}

function errorFromSettled(result: PromiseSettledResult<unknown>) {
  return result.status === 'rejected' ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : '';
}

function isDecisionStatus(record: Record<string, unknown>, values: string[]) {
  const normalizedValues = new Set(values);
  const candidates = ['selection_status', 'selectionStatus', 'decision', 'status', 'final_decision'];

  return candidates.some((key) => {
    const value = record[key];

    return typeof value === 'string' && normalizedValues.has(value.trim().toLowerCase());
  });
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function durationDays(start: string, end: string) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }

  return Math.floor((endMs - startMs) / 86_400_000);
}

function statusScore(status: GateStatus) {
  if (status === 'passed') {
    return 1;
  }

  if (status === 'warning') {
    return 0.4;
  }

  return 0;
}
