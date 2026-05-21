import { researchTradingViewStrategies } from './tradingview-research';
import { readThoonDb, updateThoonDb } from './thoon-db';
import { strategyIdFromResearchRecord } from '../utils/strategy-catalog';
import type { AgentDecision, AgentQueueTask, AgentRun, AuditEvent, StrategyResearchRecord } from '../types/trading';

export type DeterministicStrategyAgentSpec = {
  description: string;
  id: string;
  name: string;
  queries: string[];
  submitsTo: Array<'research_registry' | 'backtest_queue' | 'paper_queue'>;
};

export type DeterministicStrategyAgentRun = {
  agentId: string;
  errors: string[];
  fetchedAt: string;
  newRecords: number;
  queries: string[];
  records: StrategyResearchRecord[];
  savedRecords: number;
  submitted: Array<{ strategyId: string; title: string; url: string }>;
};

export const deterministicStrategyAgents: DeterministicStrategyAgentSpec[] = [
  {
    description: 'Momentum, breakout, TRIX, Donchian and ATR trail concepts from public TradingView metadata.',
    id: 'tv-momentum-breakout',
    name: 'TV Momentum Breakout',
    queries: ['trix donchian crypto strategy', 'breakout atr trailing stop crypto strategy', 'ema volume breakout crypto strategy'],
    submitsTo: ['research_registry', 'backtest_queue'],
  },
  {
    description: 'Mean-reversion, RSI, Bollinger and volatility-filtered concepts from public TradingView metadata.',
    id: 'tv-risk-reversion',
    name: 'TV Risk Reversion',
    queries: ['rsi atr mean reversion crypto strategy', 'bollinger atr stop crypto strategy', 'stochastic rsi crypto strategy'],
    submitsTo: ['research_registry', 'backtest_queue', 'paper_queue'],
  },
];

export function getDeterministicStrategyAgentsStatus() {
  const db = readThoonDb();
  const latestRuns = db.agentRunRecords.filter((run) => run.notes.includes('deterministic TradingView'));
  const queued = db.agentQueueRecords.filter((task) => task.action === 'run_backtest' && task.status === 'queued');

  return {
    agents: deterministicStrategyAgents.map((agent) => ({
      ...agent,
      lastRun: latestRuns.find((run) => run.notes.includes(agent.id)),
    })),
    queue: queued.slice(0, 20),
    source: 'thoon_deterministic_strategy_agents',
    tradingViewResearchRecords: db.strategyResearchRecords.length,
  };
}

export async function runDeterministicStrategyAgents(options: { agentId?: string; limit?: number; queryLimit?: number } = {}) {
  const limit = Math.max(1, Math.min(8, Math.floor(options.limit ?? 3)));
  const queryLimit = Math.max(1, Math.min(3, Math.floor(options.queryLimit ?? 2)));
  const agents = options.agentId ? deterministicStrategyAgents.filter((agent) => agent.id === options.agentId) : deterministicStrategyAgents;

  if (!agents.length) {
    throw new Error(`Unknown deterministic strategy agent: ${options.agentId}`);
  }

  const startedAt = new Date().toISOString();
  const runs: DeterministicStrategyAgentRun[] = [];

  for (const agent of agents) {
    const errors: string[] = [];
    const records: StrategyResearchRecord[] = [];
    const queries = agent.queries.slice(0, queryLimit);

    for (const query of queries) {
      try {
        const result = await researchTradingViewStrategies({ limit, query });
        errors.push(...result.errors);
        records.push(...result.records);
      } catch (error) {
        errors.push(`${query}: ${error instanceof Error ? error.message : 'TradingView deterministic research failed'}`);
      }
    }

    const uniqueRecords = uniqueBy(records, (record) => record.url).slice(0, limit * queryLimit);
    const saved = saveDeterministicAgentRun(agent, uniqueRecords, errors, startedAt);
    runs.push({
      agentId: agent.id,
      errors,
      fetchedAt: startedAt,
      newRecords: saved.newRecords,
      queries,
      records: uniqueRecords,
      savedRecords: saved.savedRecords,
      submitted: uniqueRecords.map((record) => ({
        strategyId: strategyIdFromResearchRecord(record),
        title: record.title,
        url: record.url,
      })),
    });
  }

  return {
    agents: deterministicStrategyAgents,
    completedAt: new Date().toISOString(),
    runs,
    source: 'thoon_deterministic_strategy_agents',
    startedAt,
  };
}

function saveDeterministicAgentRun(agent: DeterministicStrategyAgentSpec, records: StrategyResearchRecord[], errors: string[], startedAt: string) {
  return updateThoonDb((db) => {
    const existingUrls = new Set(db.strategyResearchRecords.map((record) => record.url));
    const existingByUrl = new Map(db.strategyResearchRecords.map((record) => [record.url, record]));
    let newRecords = 0;

    for (const record of records) {
      const nextRecord = {
        ...record,
        query: `${agent.id}:${record.query}`,
      };

      if (!existingUrls.has(record.url)) {
        newRecords += 1;
      }

      existingByUrl.set(record.url, nextRecord);
    }

    const submitted = records.map((record) => strategyIdFromResearchRecord(record));
    const nextTasks = submitted.map((strategyId, index): AgentQueueTask => ({
      action: 'run_backtest',
      createdAt: startedAt,
      id: `agent-task-${slug(agent.id)}-${slug(strategyId)}-${Date.now()}-${index}`,
      nextAction: 'Implement concept if needed, then run strict candle backtest before any paper bot.',
      priority: agent.submitsTo.includes('paper_queue') ? 'high' : 'normal',
      result: 'Queued by deterministic non-LLM TradingView agent.',
      status: 'queued',
      strategyId,
    }));
    const existingQueued = new Set(db.agentQueueRecords.map((task) => `${task.action}:${task.strategyId}:${task.status}`));
    const dedupedTasks = nextTasks.filter((task) => !existingQueued.has(`${task.action}:${task.strategyId}:${task.status}`));
    const decision = makeDecision(records.length > 0, errors);
    const run: AgentRun = {
      action: 'research_tradingview',
      createdAt: startedAt,
      decision,
      id: `agent-run-${slug(agent.id)}-${Date.now()}`,
      mode: db.agentSettingsRecord.mode,
      notes: `${agent.id} deterministic TradingView run saved ${records.length} records and queued ${dedupedTasks.length} backtests.`,
      permission: 'analyze_strategy',
      result: records.length ? 'completed' : 'failed',
      userConfirmed: false,
    };

    db.strategyResearchRecords = Array.from(existingByUrl.values())
      .sort((left, right) => new Date(right.fetchedAt).getTime() - new Date(left.fetchedAt).getTime())
      .slice(0, 120);
    db.agentQueueRecords = [...dedupedTasks, ...db.agentQueueRecords].slice(0, 80);
    db.agentRunRecords = [run, ...db.agentRunRecords].slice(0, 120);
    const auditEvent: AuditEvent = {
      action: 'Deterministic TradingView agent run',
      actor: 'system',
      details: `${agent.id}: ${records.length} records, ${dedupedTasks.length} queued, ${errors.length} errors.`,
      eventType: 'strategy',
      id: `audit-${Date.now()}-${slug(agent.id)}`,
      ipAddress: 'server',
      status: records.length ? 'success' : 'failed',
      time: startedAt,
    };

    db.auditLogRecords = [auditEvent, ...db.auditLogRecords].slice(0, 1000);

    return {
      newRecords,
      savedRecords: records.length,
    };
  });
}

function makeDecision(allowed: boolean, errors: string[]): AgentDecision {
  return {
    action: 'research_tradingview',
    allowed,
    blockers: allowed ? [] : ['tradingview_public_research_failed'],
    permission: 'analyze_strategy',
    policy: 'auto_allowed',
    requiredConfirmation: false,
    riskEngineResult: {
      allowed,
      checked: ['deterministic_non_llm', 'public_tradingview_metadata_only', 'paper_and_backtest_only'],
    },
    suggestedSafeAction: allowed ? 'Run strict backtests before any paper bot.' : 'Retry with another public TradingView query.',
    warnings: [
      'Public TradingView metadata is imported as a concept only; no performance is assumed.',
      ...errors.slice(0, 4),
    ],
  };
}

function uniqueBy<T>(items: T[], keyFor: (item: T) => string) {
  const map = new Map<string, T>();

  for (const item of items) {
    map.set(keyFor(item), item);
  }

  return Array.from(map.values());
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
