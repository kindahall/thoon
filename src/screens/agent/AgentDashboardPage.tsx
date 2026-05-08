import { Bot, BrainCircuit, ClipboardList, Database, GitCompare, LineChart, Search, Settings } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { StrategyAgentDrawer } from '../../components/agent/StrategyAgentDrawer';
import { Badge, Card } from '../../components/ui';
import type { AgentQueueTask, AgentReport, AgentRun, AgentSettings, AgentSuggestion, BacktestReport, JournalTrade, Strategy, StrategyResearchRecord, StrategyVersion } from '../../types/trading';
import { strategyIdFromResearchRecord } from '../../utils/strategy-catalog';
import { formatUsd } from '../../utils/format';

type AgentDashboardPageProps = {
  aiStatus: {
    configured: boolean;
    endpoint: string;
    model: string;
    provider: string;
  };
  backtests: BacktestReport[];
  journalTrades: JournalTrade[];
  reports: AgentReport[];
  runs: AgentRun[];
  queue: AgentQueueTask[];
  researchRecords: StrategyResearchRecord[];
  settings: AgentSettings;
  strategies: Strategy[];
  suggestions: AgentSuggestion[];
  versions: StrategyVersion[];
};

export function AgentDashboardPage({ aiStatus, backtests, journalTrades, reports, runs, queue, researchRecords, settings, strategies, suggestions, versions }: AgentDashboardPageProps) {
  const monitoredStrategies = strategies.filter((strategy) => versions.some((version) => version.strategyId === strategy.id));
  const latestSuggestion = suggestions[0];
  const paperTrades = journalTrades.filter((trade) => trade.source === 'paper');
  const memoryRows = buildLearningMemory(backtests, paperTrades);

  return (
    <section className="agent-dashboard-page" aria-label="Strategy Agent dashboard">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Strategy Agent</h1>
          <p>Compact control for strategy validation and guarded actions.</p>
        </div>
        <div className="workspace-header__right">
          <Badge tone={settings.enabled ? 'positive' : 'neutral'}>{settings.mode.replace('_', ' ')}</Badge>
          <Link className="ui-button ui-button--ghost ui-button--sm" href="/preferences/agent">
            <span className="ui-button__icon">
              <Settings size={15} />
            </span>
            Preferences
          </Link>
          <StrategyAgentDrawer context="strategy" reports={reports} runs={runs} settings={settings} suggestions={suggestions} versions={versions} strategyId={monitoredStrategies[0]?.id} strategyName={monitoredStrategies[0]?.name} />
        </div>
      </div>

      <div className="agent-dashboard-grid">
        <MetricCard icon={<BrainCircuit size={18} />} label="Status" value={settings.enabled ? 'Enabled' : 'Disabled'} />
        <MetricCard icon={<ClipboardList size={18} />} label="Active Tasks" value={String(queue.filter((task) => task.status !== 'completed').length)} />
        <MetricCard icon={<GitCompare size={18} />} label="Versions" value={String(versions.length)} />
        <MetricCard icon={<LineChart size={18} />} label="Reports" value={String(reports.length)} />
        <MetricCard icon={<Search size={18} />} label="TV Sources" value={String(researchRecords.length)} />
        <MetricCard icon={<BrainCircuit size={18} />} label="AI Provider" value={aiStatus.provider} />
      </div>

      <div className="agent-dashboard-main">
        <Card className="agent-dashboard-card">
          <div className="agent-card-head">
            <BrainCircuit size={18} />
            <div>
              <h2>Latest Suggestions</h2>
              <span>{latestSuggestion?.title ?? 'No suggestion'}</span>
            </div>
          </div>
          <div className="agent-compact-list">
            {suggestions.length ? (
              suggestions.slice(0, 4).map((suggestion) => (
                <div key={suggestion.id}>
                  <strong>{suggestion.title}</strong>
                  <span>{suggestion.reason}</span>
                  <Badge tone={suggestion.risk === 'low' ? 'positive' : suggestion.risk === 'medium' ? 'warning' : 'negative'}>{suggestion.risk}</Badge>
                </div>
              ))
            ) : (
              <div className="agent-empty-line">No real suggestion yet.</div>
            )}
          </div>
        </Card>

        <Card className="agent-dashboard-card">
          <div className="agent-card-head">
            <Search size={18} />
            <div>
              <h2>TradingView Research</h2>
              <span>{researchRecords.length} public records</span>
            </div>
          </div>
          <div className="agent-compact-list agent-research-list">
            {researchRecords.length ? (
              researchRecords.slice(0, 5).map((record) => {
                const strategyId = strategyIdFromResearchRecord(record);

                return (
                  <div className="agent-research-item" key={record.id}>
                    <a href={record.url} rel="noreferrer" target="_blank">
                      <strong>{record.title}</strong>
                      <span>{[record.author, ...record.concepts.slice(0, 3)].filter(Boolean).join(' · ') || record.publicDescription}</span>
                    </a>
                    <div className="agent-research-actions">
                      <Badge tone={record.sourceVisibility === 'protected_source' ? 'warning' : record.sourceVisibility === 'open_source' ? 'positive' : 'neutral'}>{formatSourceVisibility(record.sourceVisibility)}</Badge>
                      <Link href={`/strategies/${strategyId}`}>Strategy</Link>
                      <Link href={`/backtest?strategyId=${strategyId}`}>Backtest</Link>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="agent-empty-line">No public TradingView research saved yet.</div>
            )}
          </div>
        </Card>

        <Card className="agent-dashboard-card">
          <div className="agent-card-head">
            <Database size={18} />
            <div>
              <h2>Learning Memory</h2>
              <span>{backtests.length} backtests · {paperTrades.length} paper trades</span>
            </div>
          </div>
          <div className="agent-compact-list">
            {memoryRows.length ? (
              memoryRows.slice(0, 5).map((row) => (
                <Link href={row.href} key={row.id}>
                  <strong>{row.title}</strong>
                  <span>{row.detail}</span>
                  <Badge tone={row.tone}>{row.badge}</Badge>
                </Link>
              ))
            ) : (
              <div className="agent-empty-line">No real backtest or paper-trade history yet.</div>
            )}
          </div>
        </Card>

        <Card className="agent-dashboard-card">
          <div className="agent-card-head">
            <ClipboardList size={18} />
            <div>
              <h2>Optimizer Queue</h2>
              <span>{queue.length} tasks</span>
            </div>
          </div>
          <div className="agent-compact-list">
            {queue.length ? (
              queue.map((task) => (
                <div key={task.id}>
                  <strong>{task.action.replace('_', ' ')}</strong>
                  <span>{task.nextAction}</span>
                  <Badge tone={task.status === 'blocked' ? 'negative' : task.status === 'completed' ? 'positive' : 'warning'}>{task.status}</Badge>
                </div>
              ))
            ) : (
              <div className="agent-empty-line">No real task yet.</div>
            )}
          </div>
        </Card>

        <Card className="agent-dashboard-card">
          <div className="agent-card-head">
            <Bot size={18} />
            <div>
              <h2>Monitored Strategies</h2>
              <span>{monitoredStrategies.length} linked</span>
            </div>
          </div>
          <div className="agent-compact-list">
            {monitoredStrategies.length ? (
              monitoredStrategies.map((strategy) => {
                const version = versions.find((item) => item.strategyId === strategy.id);

                return (
                  <Link href={`/strategies/${strategy.id}`} key={strategy.id}>
                    <strong>{strategy.name}</strong>
                    <span>{strategy.market} · {version?.stage ?? 'not validated'}</span>
                    <Badge tone={version && version.robustnessScore >= 70 ? 'positive' : 'warning'}>{version ? `${version.robustnessScore}` : '-'}</Badge>
                  </Link>
                );
              })
            ) : (
              <div className="agent-empty-line">No validated strategy run yet.</div>
            )}
          </div>
        </Card>

        <Card className="agent-dashboard-card">
          <div className="agent-card-head">
            <LineChart size={18} />
            <div>
              <h2>Recent Logs</h2>
              <span>{runs.length} runs</span>
            </div>
          </div>
          <div className="agent-compact-list">
            {runs.length ? (
              runs.slice(0, 5).map((run) => (
                <div key={run.id}>
                  <strong>{run.action.replace('_', ' ')}</strong>
                  <span>{run.notes}</span>
                  <Badge tone={run.result === 'completed' ? 'positive' : run.result === 'blocked' ? 'negative' : 'warning'}>{run.result}</Badge>
                </div>
              ))
            ) : (
              <div className="agent-empty-line">No real agent action yet.</div>
            )}
          </div>
        </Card>
      </div>
    </section>
  );
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card className="agent-dashboard-metric">
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </Card>
  );
}

function buildLearningMemory(backtests: BacktestReport[], paperTrades: JournalTrade[]) {
  const backtestRows = backtests.map((report) => ({
    badge: `${report.profitFactor.toFixed(2)} PF`,
    detail: `${report.market ?? 'Market'} · ${report.timeframe ?? '-'} · ${report.period} · ${report.totalTrades} trades · ${formatUsd(report.netProfit)}`,
    href: `/backtest?strategyId=${encodeURIComponent(report.strategyId)}`,
    id: report.id,
    time: report.generatedAt ?? report.dataWindow?.lastCandleAt ?? '',
    title: 'Backtest',
    tone: report.netProfit >= 0 ? ('positive' as const) : ('negative' as const),
  }));
  const paperRows = paperTrades.map((trade) => ({
    badge: trade.pnl >= 0 ? 'paper win' : 'paper loss',
    detail: `${trade.symbol} · ${trade.side} · ${formatUsd(trade.pnl)} · ${trade.rMultiple.toFixed(2)}R`,
    href: `/history?pair=${encodeURIComponent(trade.symbol)}`,
    id: trade.id,
    time: trade.closedAt,
    title: 'Paper trade',
    tone: trade.pnl >= 0 ? ('positive' as const) : ('negative' as const),
  }));

  return [...backtestRows, ...paperRows].sort((left, right) => new Date(right.time).getTime() - new Date(left.time).getTime());
}

function formatSourceVisibility(value: StrategyResearchRecord['sourceVisibility']) {
  switch (value) {
    case 'open_source':
      return 'open';
    case 'protected_source':
      return 'concept';
    case 'public_description':
      return 'public';
    case 'unknown':
      return 'unknown';
  }
}
