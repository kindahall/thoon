'use client';

import { Bot, BrainCircuit, ClipboardList, GitCompare, LineChart, Search, Settings, Target } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import { CodexAgentChat } from '../../components/agent/CodexAgentChat';
import { PaperTestRecommendationActions } from '../../components/agent/PaperTestRecommendationActions';
import { StrategyAgentDrawer } from '../../components/agent/StrategyAgentDrawer';
import { Badge, Card } from '../../components/ui';
import type { KronosIntegrationProfile } from '../../server/kronos-integration';
import type { TradingViewMcpProfile } from '../../server/tradingview-mcp-integration';
import type { AgentChatMessage, AgentQueueTask, AgentReport, AgentRun, AgentSettings, AgentSuggestion, BacktestReport, JournalTrade, KronosForecastRecord, KronosLearningProfile, Strategy, StrategyResearchRecord, StrategyVersion } from '../../types/trading';
import { strategyIdFromResearchRecord } from '../../utils/strategy-catalog';
import { formatUsd } from '../../utils/format';

type AgentDashboardPageProps = {
  aiStatus: {
    configured: boolean;
    endpoint: string;
    model: string;
    provider: string;
    sandbox?: string;
  };
  backtests: BacktestReport[];
  chatMessages: AgentChatMessage[];
  journalTrades: JournalTrade[];
  kronosLearning: {
    profile: KronosLearningProfile;
    records: KronosForecastRecord[];
  };
  kronosProfile: KronosIntegrationProfile;
  reports: AgentReport[];
  runs: AgentRun[];
  queue: AgentQueueTask[];
  researchRecords: StrategyResearchRecord[];
  settings: AgentSettings;
  strategies: Strategy[];
  suggestions: AgentSuggestion[];
  tradingViewMcpProfile: TradingViewMcpProfile;
  versions: StrategyVersion[];
};

const AGENT_PAGE_SIZE = 10;

type AgentTabId = 'backtests' | 'paper-tests' | 'feedback' | 'operations' | 'research' | 'memory';
type AgentTabTone = 'cyan' | 'green' | 'orange' | 'blue' | 'violet' | 'slate';
type BestBacktestCandidate = ReturnType<typeof buildBestBacktestCandidates>[number];
type StrategyFeedbackRow = ReturnType<typeof buildStrategyFeedbackRows>[number];
type AgentStrategyTab = {
  count: number;
  id: string;
  name: string;
  toneIndex: number;
};

const agentTabMeta: Array<{ id: AgentTabId; label: string; tone: AgentTabTone }> = [
  { id: 'backtests', label: 'Best Backtested Strategies', tone: 'cyan' },
  { id: 'paper-tests', label: 'Paper Test Recommendations', tone: 'green' },
  { id: 'feedback', label: 'Strategy Feedback', tone: 'orange' },
  { id: 'operations', label: 'Operations', tone: 'blue' },
  { id: 'research', label: 'Research', tone: 'violet' },
  { id: 'memory', label: 'Memory', tone: 'slate' },
];

const initialAgentPages: Record<AgentTabId, number> = {
  backtests: 0,
  feedback: 0,
  memory: 0,
  operations: 0,
  'paper-tests': 0,
  research: 0,
};

export function AgentDashboardPage({ aiStatus, backtests, chatMessages, journalTrades, kronosLearning, kronosProfile, reports, runs, queue, researchRecords, settings, strategies, suggestions, tradingViewMcpProfile, versions }: AgentDashboardPageProps) {
  const [activeTab, setActiveTab] = useState<AgentTabId>('backtests');
  const [pageByTab, setPageByTab] = useState<Record<AgentTabId, number>>(initialAgentPages);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedStrategyTab, setSelectedStrategyTab] = useState('all');
  const monitoredStrategies = strategies.filter((strategy) => versions.some((version) => version.strategyId === strategy.id));
  const paperTrades = journalTrades.filter((trade) => trade.source === 'paper');
  const memoryRows = buildLearningMemory(backtests, paperTrades, kronosLearning.records);
  const bestBacktests = buildBestBacktestCandidates(backtests, strategies, settings);
  const paperRecommendations = bestBacktests.filter((candidate) => candidate.decision === 'bot_candidate' || candidate.decision === 'paper_test');
  const feedbackRows = buildStrategyFeedbackRows(reports, backtests, strategies, settings);
  const autonomousTasks = queue.length ? queue : buildAutonomousTasks(strategies, backtests, settings);
  const researchRows = useMemo(() => buildResearchRows(suggestions, researchRecords), [researchRecords, suggestions]);
  const memoryActivityRows = useMemo(() => buildMemoryActivityRows(memoryRows, monitoredStrategies, runs, versions), [memoryRows, monitoredStrategies, runs, versions]);
  const strategyTabs = useMemo(() => buildAgentStrategyTabs(bestBacktests, strategies), [bestBacktests, strategies]);
  const strategyMatches = (strategyId?: string) => selectedStrategyTab === 'all' || strategyId === selectedStrategyTab;
  const visibleBacktests = bestBacktests.filter((candidate) => strategyMatches(candidate.report.strategyId));
  const visiblePaperRecommendations = paperRecommendations.filter((candidate) => strategyMatches(candidate.report.strategyId));
  const visibleFeedbackRows = feedbackRows.filter((row) => strategyMatches(row.strategyId));
  const visibleAutonomousTasks = autonomousTasks.filter((task) => strategyMatches(task.strategyId));
  const visibleResearchRows = researchRows.filter((row) => strategyMatches(row.strategyId));
  const visibleMemoryRows = memoryActivityRows.filter((row) => strategyMatches(row.strategyId));
  const tabCounts: Record<AgentTabId, number> = {
    backtests: visibleBacktests.length,
    feedback: visibleFeedbackRows.length,
    memory: visibleMemoryRows.length,
    operations: visibleAutonomousTasks.length,
    'paper-tests': visiblePaperRecommendations.length,
    research: visibleResearchRows.length,
  };
  const aiProviderLabel = aiStatus.provider === 'codex' ? 'Thoonix' : aiStatus.provider;
  const selectedReport = selectedReportId ? backtests.find((report) => report.id === selectedReportId && isTrustedCalculatedBacktest(report)) : undefined;
  const selectedCandidate = visibleBacktests.find((candidate) => candidate.report.id === selectedReportId) ?? bestBacktests.find((candidate) => candidate.report.id === selectedReportId && strategyMatches(candidate.report.strategyId)) ?? (selectedReport && strategyMatches(selectedReport.strategyId) ? buildBacktestCandidate(selectedReport, strategies, settings) : undefined) ?? visibleBacktests[0] ?? (selectedStrategyTab === 'all' ? bestBacktests[0] : undefined);
  const selectedStrategyReports = selectedCandidate
    ? backtests
        .filter((report) => isTrustedCalculatedBacktest(report) && report.strategyId === selectedCandidate.report.strategyId)
        .sort(sortBacktestReports)
    : [];
  const activeCount = tabCounts[activeTab];
  const activePage = Math.min(pageByTab[activeTab] ?? 0, Math.max(0, Math.ceil(activeCount / AGENT_PAGE_SIZE) - 1));

  function setTabPage(tab: AgentTabId, page: number) {
    setPageByTab((current) => ({
      ...current,
      [tab]: Math.max(0, Math.min(page, Math.max(0, Math.ceil(tabCounts[tab] / AGENT_PAGE_SIZE) - 1))),
    }));
  }

  function selectStrategy(strategyId: string) {
    const candidate = bestBacktests.find((item) => item.report.strategyId === strategyId);

    if (candidate) {
      setSelectedStrategyTab(strategyId);
      setPageByTab(initialAgentPages);
      setSelectedReportId(candidate.report.id);
    }
  }

  function selectStrategyTab(strategyId: string) {
    setSelectedStrategyTab(strategyId);
    setPageByTab(initialAgentPages);

    if (strategyId === 'all') {
      return;
    }

    const candidate = bestBacktests.find((item) => item.report.strategyId === strategyId);

    if (candidate) {
      setSelectedReportId(candidate.report.id);
    }
  }

  function renderActiveTab() {
    if (activeTab === 'backtests') {
      return <BacktestCandidateRows candidates={paginate(visibleBacktests, activePage)} onSelect={(candidate) => setSelectedReportId(candidate.report.id)} selectedReportId={selectedCandidate?.report.id} />;
    }

    if (activeTab === 'paper-tests') {
      return <PaperCandidateRows candidates={paginate(visiblePaperRecommendations, activePage)} onSelect={(candidate) => setSelectedReportId(candidate.report.id)} selectedReportId={selectedCandidate?.report.id} />;
    }

    if (activeTab === 'feedback') {
      return <FeedbackRows rows={paginate(visibleFeedbackRows, activePage)} onSelectReport={setSelectedReportId} selectedReportId={selectedCandidate?.report.id} />;
    }

    if (activeTab === 'operations') {
      return <TaskRows rows={paginate(visibleAutonomousTasks, activePage)} onSelectStrategy={selectStrategy} />;
    }

    if (activeTab === 'research') {
      return <ResearchRows rows={paginate(visibleResearchRows, activePage)} onSelectStrategy={selectStrategy} />;
    }

    return <MemoryRows rows={paginate(visibleMemoryRows, activePage)} onSelectReport={setSelectedReportId} onSelectStrategy={selectStrategy} selectedReportId={selectedCandidate?.report.id} />;
  }

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
        <MetricCard icon={<Target size={18} />} label="Bot Score" value={bestBacktests[0] ? `${bestBacktests[0].botScore}/100` : '-'} />
        <MetricCard icon={<Search size={18} />} label="TV Sources" value={String(researchRecords.length)} />
        <MetricCard icon={<BrainCircuit size={18} />} label="AI Provider" value={aiProviderLabel} />
        <MetricCard icon={<BrainCircuit size={18} />} label="Kronos Weight" value={`${kronosLearning.profile.confidenceWeight.toFixed(2)}x`} />
      </div>

      <CodexAgentChat aiStatus={aiStatus} initialMessages={chatMessages} kronosLearningProfile={kronosLearning.profile} kronosProfile={kronosProfile} tradingViewMcpProfile={tradingViewMcpProfile} />

      <div className="agent-dashboard-main agent-dashboard-main--tabs">
        <Card className="agent-workbench">
          <div className="agent-tabbar" aria-label="Agent strategy tabs" role="tablist">
            {agentTabMeta.map((tab) => (
              <button
                aria-selected={activeTab === tab.id}
                className={`agent-tab-button agent-tab-button--${tab.tone}${activeTab === tab.id ? ' is-active' : ''}`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                type="button"
              >
                <span>{tab.label}</span>
                <strong>{tabCounts[tab.id]}</strong>
              </button>
            ))}
          </div>

          <div className="agent-workbench-grid">
            <div className="agent-list-panel" role="tabpanel">
              <div className="agent-list-panel__head">
                <div>
                  <h2>{agentTabMeta.find((tab) => tab.id === activeTab)?.label}</h2>
                  <span>{activeCount ? `${activePage * AGENT_PAGE_SIZE + 1}-${Math.min(activeCount, (activePage + 1) * AGENT_PAGE_SIZE)} of ${activeCount}` : 'No verified item yet'}{selectedStrategyTab !== 'all' ? ` · ${strategyTabs.find((tab) => tab.id === selectedStrategyTab)?.name ?? selectedStrategyTab}` : ''}</span>
                </div>
                <Badge tone={activeCount ? 'primary' : 'neutral'}>{AGENT_PAGE_SIZE}/page</Badge>
              </div>

              <StrategyFilterTabs onSelect={selectStrategyTab} selectedStrategyId={selectedStrategyTab} tabs={strategyTabs} totalCount={bestBacktests.length} />

              {renderActiveTab()}

              <PaginationControls count={activeCount} onPageChange={(page) => setTabPage(activeTab, page)} page={activePage} />
            </div>

            <StrategyEvidencePanel candidate={selectedCandidate} reports={selectedStrategyReports} />
          </div>
        </Card>
      </div>
    </section>
  );
}

function StrategyFilterTabs({ onSelect, selectedStrategyId, tabs, totalCount }: { onSelect: (strategyId: string) => void; selectedStrategyId: string; tabs: AgentStrategyTab[]; totalCount: number }) {
  return (
    <div className="agent-strategy-tabs" aria-label="Strategy filters" role="tablist">
      <button aria-selected={selectedStrategyId === 'all'} className={selectedStrategyId === 'all' ? 'is-active' : undefined} onClick={() => onSelect('all')} role="tab" type="button">
        <span>All strategies</span>
        <strong>{totalCount}</strong>
      </button>
      {tabs.map((tab) => (
        <button
          aria-selected={selectedStrategyId === tab.id}
          className={selectedStrategyId === tab.id ? 'is-active' : undefined}
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          role="tab"
          style={{ '--agent-strategy-tab-color': strategyTabColor(tab.toneIndex) } as CSSProperties}
          type="button"
        >
          <span>{tab.name}</span>
          <strong>{tab.count}</strong>
        </button>
      ))}
    </div>
  );
}

function BacktestCandidateRows({ candidates, onSelect, selectedReportId }: { candidates: BestBacktestCandidate[]; onSelect: (candidate: BestBacktestCandidate) => void; selectedReportId?: string }) {
  if (!candidates.length) {
    return <div className="agent-empty-line">No trusted calculated backtest yet.</div>;
  }

  return (
    <div className="agent-result-list">
      {candidates.map((candidate) => (
        <button
          aria-pressed={candidate.report.id === selectedReportId}
          className={`agent-result-row agent-result-row--${candidate.tone}${candidate.report.id === selectedReportId ? ' is-selected' : ''}`}
          key={`${candidate.report.id}:${candidate.report.market ?? 'market'}:${candidate.report.timeframe ?? 'tf'}`}
          onClick={() => onSelect(candidate)}
          type="button"
        >
          <span className="agent-result-row__main">
            <strong>{candidate.strategy?.name ?? candidate.report.strategyId}</strong>
            <span>{candidate.detail}</span>
            <small>{candidate.evidence}</small>
          </span>
          <span className="agent-score-pill">{candidate.botScore}/100</span>
          <Badge tone={candidate.tone}>{candidate.badge}</Badge>
        </button>
      ))}
    </div>
  );
}

function PaperCandidateRows({ candidates, onSelect, selectedReportId }: { candidates: BestBacktestCandidate[]; onSelect: (candidate: BestBacktestCandidate) => void; selectedReportId?: string }) {
  if (!candidates.length) {
    return <div className="agent-empty-line">No strategy passes the paper-test gate yet.</div>;
  }

  return (
    <div className="agent-result-list">
      {candidates.map((candidate) => (
        <div className={`agent-paper-row agent-paper-row--${candidate.tone}${candidate.report.id === selectedReportId ? ' is-selected' : ''}`} key={`${candidate.report.id}:paper`}>
          <button onClick={() => onSelect(candidate)} type="button">
            <span className="agent-result-row__main">
              <strong>{candidate.strategy?.name ?? candidate.report.strategyId}</strong>
              <span>{candidate.suggestion}</span>
              <small>{candidate.evidence}</small>
            </span>
            <span className="agent-score-pill">{candidate.botScore}/100</span>
          </button>
          <PaperTestRecommendationActions reportId={candidate.report.id} strategyId={candidate.report.strategyId} />
        </div>
      ))}
    </div>
  );
}

function FeedbackRows({ rows, onSelectReport, selectedReportId }: { rows: StrategyFeedbackRow[]; onSelectReport: (reportId: string) => void; selectedReportId?: string }) {
  if (!rows.length) {
    return <div className="agent-empty-line">No agent strategy feedback from real tests yet.</div>;
  }

  return (
    <div className="agent-result-list">
      {rows.map((row, index) => {
        const content = (
          <>
            <span className="agent-result-row__main">
              <strong>{row.title}</strong>
              <span>{row.summary}</span>
              <small>{row.evidence}</small>
            </span>
            <Badge tone={row.tone}>{row.status}</Badge>
          </>
        );

        return row.reportId ? (
          <button
            aria-pressed={row.reportId === selectedReportId}
            className={`agent-result-row agent-result-row--${row.tone}${row.reportId === selectedReportId ? ' is-selected' : ''}`}
            key={`${row.id}:${index}`}
            onClick={() => onSelectReport(row.reportId as string)}
            type="button"
          >
            {content}
          </button>
        ) : (
          <Link className={`agent-result-row agent-result-row--${row.tone}`} href={row.href} key={`${row.id}:${index}`}>
            {content}
          </Link>
        );
      })}
    </div>
  );
}

function TaskRows({ rows, onSelectStrategy }: { rows: AgentQueueTask[]; onSelectStrategy: (strategyId: string) => void }) {
  if (!rows.length) {
    return <div className="agent-empty-line">No autonomous task eligible right now.</div>;
  }

  return (
    <div className="agent-result-list">
      <div className="agent-goal-lanes">
        <AgentGoal label="Hourly" value="Backtest gaps" />
        <AgentGoal label="Daily" value="Rank candidates" />
        <AgentGoal label="Weekly" value="Paper shortlist" />
      </div>
      {rows.map((task) => {
        const tone = task.status === 'blocked' || task.status === 'failed' ? 'negative' : task.status === 'completed' ? 'positive' : task.priority === 'high' ? 'warning' : 'neutral';

        return (
          <button
            className={`agent-result-row agent-result-row--${tone}`}
            disabled={!task.strategyId}
            key={task.id}
            onClick={() => task.strategyId && onSelectStrategy(task.strategyId)}
            type="button"
          >
            <span className="agent-result-row__main">
              <strong>{task.action.replace('_', ' ')}</strong>
              <span>{task.nextAction}</span>
              <small>{task.result ?? task.createdAt}</small>
            </span>
            <Badge tone={tone}>{task.status}</Badge>
          </button>
        );
      })}
    </div>
  );
}

type AgentResearchRow =
  | {
      badge: string;
      detail: string;
      id: string;
      kind: 'suggestion';
      strategyId?: string;
      title: string;
      tone: 'negative' | 'positive' | 'warning';
    }
  | {
      badge: string;
      detail: string;
      href: string;
      id: string;
      kind: 'tradingview';
      strategyId: string;
      title: string;
      tone: 'neutral' | 'positive' | 'warning';
    };

function ResearchRows({ rows, onSelectStrategy }: { rows: AgentResearchRow[]; onSelectStrategy: (strategyId: string) => void }) {
  if (!rows.length) {
    return <div className="agent-empty-line">No public TradingView research or agent suggestion saved yet.</div>;
  }

  return (
    <div className="agent-result-list">
      {rows.map((row) => (
        <div className={`agent-research-row agent-result-row--${row.tone}`} key={`${row.kind}:${row.id}`}>
          <div>
            <strong>{row.title}</strong>
            <span>{row.detail}</span>
          </div>
          <Badge tone={row.tone}>{row.badge}</Badge>
          <div className="agent-row-actions">
            {'href' in row ? (
              <a href={row.href} rel="noopener noreferrer" target="_blank">
                Source
              </a>
            ) : null}
            {row.strategyId ? (
              <button onClick={() => onSelectStrategy(row.strategyId as string)} type="button">
                Details
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

type AgentMemoryRow = {
  badge: string;
  detail: string;
  href?: string;
  id: string;
  reportId?: string;
  strategyId?: string;
  title: string;
  tone: 'negative' | 'neutral' | 'positive' | 'warning';
};

function buildAgentStrategyTabs(bestBacktests: BestBacktestCandidate[], strategies: Strategy[]): AgentStrategyTab[] {
  const counts = new Map<string, number>();

  function add(strategyId?: string) {
    if (!strategyId) {
      return;
    }

    counts.set(strategyId, (counts.get(strategyId) ?? 0) + 1);
  }

  bestBacktests.forEach((candidate) => add(candidate.report.strategyId));

  return Array.from(counts.entries())
    .map(([id, count], index) => ({
      count,
      id,
      name: strategies.find((strategy) => strategy.id === id)?.name ?? id,
      toneIndex: index,
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

const strategyTabColors = ['#06b6d4', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#94a3b8'];

function strategyTabColor(index: number) {
  return strategyTabColors[index % strategyTabColors.length];
}

function MemoryRows({ rows, onSelectReport, onSelectStrategy, selectedReportId }: { rows: AgentMemoryRow[]; onSelectReport: (reportId: string) => void; onSelectStrategy: (strategyId: string) => void; selectedReportId?: string }) {
  if (!rows.length) {
    return <div className="agent-empty-line">No real backtest, paper-trade, strategy, or agent log history yet.</div>;
  }

  return (
    <div className="agent-result-list">
      {rows.map((row) => {
        const content = (
          <>
            <span className="agent-result-row__main">
              <strong>{row.title}</strong>
              <span>{row.detail}</span>
            </span>
            <Badge tone={row.tone}>{row.badge}</Badge>
          </>
        );

        if (row.reportId) {
          return (
            <button
              aria-pressed={row.reportId === selectedReportId}
              className={`agent-result-row agent-result-row--${row.tone}${row.reportId === selectedReportId ? ' is-selected' : ''}`}
              key={row.id}
              onClick={() => onSelectReport(row.reportId as string)}
              type="button"
            >
              {content}
            </button>
          );
        }

        if (row.strategyId) {
          return (
            <button className={`agent-result-row agent-result-row--${row.tone}`} key={row.id} onClick={() => onSelectStrategy(row.strategyId as string)} type="button">
              {content}
            </button>
          );
        }

        return row.href ? (
          <Link className={`agent-result-row agent-result-row--${row.tone}`} href={row.href} key={row.id}>
            {content}
          </Link>
        ) : (
          <div className={`agent-result-row agent-result-row--${row.tone}`} key={row.id}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

function StrategyEvidencePanel({ candidate, reports }: { candidate?: BestBacktestCandidate; reports: BacktestReport[] }) {
  if (!candidate) {
    return (
      <aside className="agent-strategy-detail">
        <div className="agent-empty-line">Select a verified strategy to see exact report evidence.</div>
      </aside>
    );
  }

  const report = candidate.report;
  const execution = report.executionSettings;
  const strategyName = candidate.strategy?.name ?? report.strategyId;

  return (
    <aside className={`agent-strategy-detail agent-strategy-detail--${candidate.tone}`}>
      <div className="agent-detail-head">
        <Target size={18} />
        <div>
          <h2>{strategyName}</h2>
          <span>{candidate.suggestion}</span>
        </div>
        <Badge tone={candidate.tone}>{candidate.botScore}/100</Badge>
      </div>

      <div className="agent-detail-actions">
        <Link className="ui-button ui-button--ghost ui-button--sm" href={`/strategies/${encodeURIComponent(report.strategyId)}`}>
          Strategy
        </Link>
        <Link className="ui-button ui-button--ghost ui-button--sm" href={buildBacktestReportHref(report, candidate.strategy)}>
          Backtest
        </Link>
        <Link className="ui-button ui-button--primary ui-button--sm" href={buildBotDraftHref(candidate)}>
          <span className="ui-button__icon">
            <Bot size={15} />
          </span>
          Transformer en bot
        </Link>
      </div>

      <div className="agent-detail-grid">
        <AgentDetailStat label="Market" value={report.market ?? candidate.strategy?.market ?? '-'} />
        <AgentDetailStat label="Timeframe" value={report.timeframe ?? candidate.strategy?.timeframe ?? '-'} />
        <AgentDetailStat label="Period" value={report.period} />
        <AgentDetailStat label="Trades" value={String(report.totalTrades)} />
        <AgentDetailStat label="Win Rate" tone={report.winRate >= 80 || (report.winRate < 50 && report.netProfit > 0) ? 'positive' : 'warning'} value={`${report.winRate.toFixed(1)}%`} />
        <AgentDetailStat label="Profit Factor" tone={report.profitFactor >= 1.15 ? 'positive' : 'negative'} value={`${report.profitFactor.toFixed(2)} PF`} />
        <AgentDetailStat label="Net PnL" tone={report.netProfit > 0 ? 'positive' : 'negative'} value={formatUsd(report.netProfit)} />
        <AgentDetailStat label="Drawdown" tone={Math.abs(report.drawdown) <= 8 ? 'positive' : 'warning'} value={`${report.drawdown.toFixed(2)}%`} />
      </div>

      <div className="agent-reference-box">
        <strong>Exact bot references</strong>
        <span>Report: {report.id}</span>
        <span>Source: {report.marketDataSource ?? 'unknown'} · {report.candleCount ?? 0} candles</span>
        <span>Checksum: {report.dataWindow?.candleChecksum ?? 'missing'}</span>
        <span>Window: {report.dataWindow?.firstCandleAt ?? 'unknown'} to {report.dataWindow?.lastCandleAt ?? 'unknown'}</span>
        <span>Execution: {formatExecutionSettings(execution)}</span>
      </div>

      <div className="agent-detail-backtests">
        <div className="agent-detail-subhead">
          <strong>Backtests realises</strong>
          <span>{reports.length} verified reports</span>
        </div>
        <div className="agent-backtest-history">
          {reports.map((item) => (
            <Link className={item.id === report.id ? 'is-active' : undefined} href={buildBacktestReportHref(item)} key={item.id}>
              <strong>{item.market ?? '-'} · {item.timeframe ?? '-'} · {item.period}</strong>
              <span>{item.totalTrades} trades · WR {item.winRate.toFixed(1)}% · PF {item.profitFactor.toFixed(2)} · DD {item.drawdown.toFixed(1)}% · {formatUsd(item.netProfit)}</span>
              <small>{item.marketDataSource ?? 'source'} · checksum {item.dataWindow?.candleChecksum?.slice(0, 12) ?? 'missing'}</small>
            </Link>
          ))}
        </div>
      </div>
    </aside>
  );
}

function AgentDetailStat({ label, tone = 'neutral', value }: { label: string; tone?: 'negative' | 'neutral' | 'positive' | 'warning'; value: string }) {
  return (
    <div className={`agent-detail-stat agent-detail-stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PaginationControls({ count, onPageChange, page }: { count: number; onPageChange: (page: number) => void; page: number }) {
  const totalPages = Math.max(1, Math.ceil(count / AGENT_PAGE_SIZE));

  return (
    <div className="agent-pagination">
      <button disabled={page <= 0} onClick={() => onPageChange(page - 1)} type="button">
        Previous
      </button>
      <span>Page {Math.min(page + 1, totalPages)} / {totalPages}</span>
      <button disabled={page + 1 >= totalPages} onClick={() => onPageChange(page + 1)} type="button">
        Next
      </button>
    </div>
  );
}

function paginate<T>(items: T[], page: number) {
  const start = page * AGENT_PAGE_SIZE;

  return items.slice(start, start + AGENT_PAGE_SIZE);
}

function buildResearchRows(suggestions: AgentSuggestion[], researchRecords: StrategyResearchRecord[]): AgentResearchRow[] {
  const suggestionRows: AgentResearchRow[] = suggestions.map((suggestion) => ({
    badge: suggestion.risk,
    detail: suggestion.reason,
    id: suggestion.id,
    kind: 'suggestion',
    strategyId: suggestion.strategyId,
    title: suggestion.title,
    tone: suggestion.risk === 'low' ? 'positive' : suggestion.risk === 'medium' ? 'warning' : 'negative',
  }));
  const tradingViewRows: AgentResearchRow[] = researchRecords.map((record) => ({
    badge: formatSourceVisibility(record.sourceVisibility),
    detail: [record.author, ...record.concepts.slice(0, 4)].filter(Boolean).join(' · ') || record.publicDescription,
    href: record.url,
    id: record.id,
    kind: 'tradingview',
    strategyId: strategyIdFromResearchRecord(record),
    title: record.title,
    tone: record.sourceVisibility === 'open_source' ? 'positive' : record.sourceVisibility === 'protected_source' ? 'warning' : 'neutral',
  }));

  return [...suggestionRows, ...tradingViewRows];
}

function buildMemoryActivityRows(memoryRows: ReturnType<typeof buildLearningMemory>, monitoredStrategies: Strategy[], runs: AgentRun[], versions: StrategyVersion[]): AgentMemoryRow[] {
  const memoryActivityRows: AgentMemoryRow[] = memoryRows.map((row) => ({ ...row }));
  const strategyRows: AgentMemoryRow[] = monitoredStrategies.map((strategy) => {
    const version = versions.find((item) => item.strategyId === strategy.id);

    return {
      badge: version ? `${version.robustnessScore}` : '-',
      detail: `${strategy.market} · ${version?.stage ?? 'not validated'}`,
      id: `strategy:${strategy.id}`,
      strategyId: strategy.id,
      title: strategy.name,
      tone: version && version.robustnessScore >= 70 ? 'positive' : 'warning',
    };
  });
  const runRows: AgentMemoryRow[] = runs.map((run) => ({
    badge: run.result,
    detail: run.notes,
    id: `run:${run.id}`,
    strategyId: run.strategyId,
    title: run.action.replace('_', ' '),
    tone: run.result === 'completed' ? 'positive' : run.result === 'blocked' || run.result === 'failed' ? 'negative' : 'warning',
  }));

  return [...memoryActivityRows, ...strategyRows, ...runRows];
}

function sortBacktestReports(left: BacktestReport, right: BacktestReport) {
  const scoreDiff = assessReportScore(right) - assessReportScore(left);

  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  return new Date(right.generatedAt ?? '').getTime() - new Date(left.generatedAt ?? '').getTime();
}

function assessReportScore(report: BacktestReport) {
  return report.profitFactor * 20 + report.winRate + report.totalTrades / 4 + Math.max(0, report.netProfit / 20) - Math.abs(report.drawdown);
}

function buildBotDraftHref(candidate: BestBacktestCandidate) {
  const report = candidate.report;
  const params = new URLSearchParams({
    reportId: report.id,
    strategyId: report.strategyId,
  });
  const pair = report.market ?? candidate.strategy?.market;

  if (pair) {
    params.set('pair', pair);
  }

  if (report.timeframe ?? candidate.strategy?.timeframe) {
    params.set('timeframe', report.timeframe ?? candidate.strategy?.timeframe ?? '');
  }

  return `/bots/new?${params.toString()}`;
}

function buildBacktestReportHref(report: BacktestReport, strategy?: Strategy) {
  const params = new URLSearchParams({
    reportId: report.id,
    strategyId: report.strategyId,
  });
  const pair = report.market ?? strategy?.market;
  const timeframe = report.timeframe ?? strategy?.timeframe;

  if (pair) {
    params.set('pair', pair);
  }

  if (timeframe) {
    params.set('timeframe', timeframe);
  }

  return `/backtest?${params.toString()}`;
}

function formatExecutionSettings(settings: BacktestReport['executionSettings']) {
  if (!settings) {
    return 'missing';
  }

  return `${settings.marketType} · ${settings.directionMode} · ${settings.riskPerTradePct}% risk · ${settings.leverage}x leverage · SL ${settings.stopLossEnabled ? `${settings.stopLossAtr} ATR` : 'off'} · TP ${settings.takeProfitEnabled ? `${settings.takeProfitR}R` : 'off'} · trail ${settings.trailingStopEnabled ? `${settings.trailingStopAtr} ATR` : 'off'}`;
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

function AgentGoal({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildLearningMemory(backtests: BacktestReport[], paperTrades: JournalTrade[], kronosForecasts: KronosForecastRecord[]) {
  const backtestRows = backtests.map((report) => ({
    badge: `${report.profitFactor.toFixed(2)} PF`,
    detail: `${report.market ?? 'Market'} · ${report.timeframe ?? '-'} · ${report.period} · ${report.totalTrades} trades · ${formatUsd(report.netProfit)}`,
    href: `/backtest?strategyId=${encodeURIComponent(report.strategyId)}`,
    id: report.id,
    reportId: report.id,
    strategyId: report.strategyId,
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
  const kronosRows = kronosForecasts.slice(0, 80).map((record) => ({
    badge: record.status === 'evaluated' ? (record.hit ? 'forecast hit' : 'forecast miss') : 'pending',
    detail:
      record.status === 'evaluated'
        ? `${record.market} · ${record.timeframe} · ${record.predictedDirection} -> ${record.realizedDirection ?? 'unknown'} · ${record.realizedReturnPct?.toFixed(2) ?? '0.00'}%`
        : `${record.market} · ${record.timeframe} · ${record.predictedDirection} · confidence ${(record.confidence * 100).toFixed(0)}% · weight ${record.weightAtCreation.toFixed(2)}x`,
    id: record.id,
    strategyId: record.strategyId,
    time: record.realizedAt ?? record.createdAt,
    title: 'Kronos forecast',
    tone: record.status === 'pending' ? ('neutral' as const) : record.hit ? ('positive' as const) : ('warning' as const),
  }));

  return [...backtestRows, ...paperRows, ...kronosRows].sort((left, right) => new Date(right.time).getTime() - new Date(left.time).getTime());
}

function buildBestBacktestCandidates(backtests: BacktestReport[], strategies: Strategy[], settings: AgentSettings) {
  const latestByStrategy = new Map<string, BacktestReport>();

  for (const report of backtests.filter(isTrustedCalculatedBacktest).sort((left, right) => new Date(right.generatedAt ?? '').getTime() - new Date(left.generatedAt ?? '').getTime())) {
    const key = `${report.strategyId}:${report.market ?? 'market'}:${report.timeframe ?? 'tf'}`;

    if (!latestByStrategy.has(key)) {
      latestByStrategy.set(key, report);
    }
  }

  return Array.from(latestByStrategy.values())
    .map((report) => buildBacktestCandidate(report, strategies, settings))
    .sort((left, right) => right.score - left.score);
}

function buildBacktestCandidate(report: BacktestReport, strategies: Strategy[], settings: AgentSettings) {
  const strategy = strategies.find((item) => item.id === report.strategyId);
  const assessment = assessBotReadiness(report, settings);
  const needsRetest = report.totalTrades < settings.limits.minTrades;

  return {
    badge: `${report.profitFactor.toFixed(2)} PF`,
    botScore: assessment.score,
    decision: assessment.decision,
    detail: `${report.market ?? strategy?.market ?? 'Market'} · ${report.timeframe ?? strategy?.timeframe ?? '-'} · ${report.period} · ${report.totalTrades} trades · WR ${report.winRate.toFixed(1)}% · DD ${report.drawdown.toFixed(1)}% · ${formatUsd(report.netProfit)}`,
    evidence: `${report.marketDataSource ?? 'source'} · ${report.candleCount ?? 0} candles · checksum ${report.dataWindow?.candleChecksum?.slice(0, 12) ?? 'missing'}`,
    report,
    score: assessment.score,
    strategy,
    suggestion: assessment.decision === 'bot_candidate' || assessment.decision === 'paper_test' ? assessment.usagePlan[0] : needsRetest ? 'Retest: sample too small before bot.' : assessment.reason,
    tone: assessment.tone,
  };
}

function buildStrategyFeedbackRows(reports: AgentReport[], backtests: BacktestReport[], strategies: Strategy[], settings: AgentSettings) {
  const reportRows = reports.map((report) => {
    const strategy = strategies.find((item) => item.id === report.strategyId);
    const backtest = backtests.find((item) => item.strategyId === report.strategyId);
    const summary = report.summary.join(' ');
    const evidence = backtest?.dataWindow?.candleChecksum
      ? `${backtest.marketDataSource ?? 'source'} · ${backtest.candleCount ?? 0} candles · checksum saved`
      : report.periodTested === 'Not tested'
        ? 'No calculated evidence yet'
        : `${report.periodTested} · evidence incomplete`;

    return {
      evidence,
      href: strategy ? `/strategies/${strategy.id}` : '/agent',
      id: report.id,
      reportId: backtest?.id,
      strategyId: report.strategyId,
      status: report.botScore ? `${report.botScore}/100` : report.status.replace('_', ' '),
      summary: report.usagePlan?.[0] ? `${summary} ${report.usagePlan[0]}` : summary,
      time: report.createdAt,
      title: strategy?.name ?? report.strategyId,
      tone: report.botDecision === 'bot_candidate' || report.botDecision === 'paper_test' || report.status === 'paper_candidate' || report.status === 'bot_candidate' ? ('positive' as const) : report.botDecision === 'do_not_use' || report.status === 'reject' || report.status === 'archive' ? ('negative' as const) : ('warning' as const),
    };
  });

  const backtestRows = backtests.filter(isTrustedCalculatedBacktest).map((report) => {
    const strategy = strategies.find((item) => item.id === report.strategyId);
    const assessment = assessBotReadiness(report, settings);

    return {
      evidence: `${report.marketDataSource ?? 'source'} · ${report.candleCount ?? 0} candles · ${report.dataWindow?.firstCandleAt ?? 'unknown'} to ${report.dataWindow?.lastCandleAt ?? 'unknown'}`,
      href: `/backtest?strategyId=${encodeURIComponent(report.strategyId)}`,
      id: report.id,
      reportId: report.id,
      strategyId: report.strategyId,
      status: `${assessment.score}/100`,
      summary: `${assessment.decision.replace('_', ' ')} · ${report.market ?? strategy?.market ?? 'Market'} · ${report.timeframe ?? strategy?.timeframe ?? '-'} · ${report.totalTrades} trades · WR ${report.winRate.toFixed(1)}% · PF ${report.profitFactor.toFixed(2)} · DD ${report.drawdown.toFixed(1)}% · ${formatUsd(report.netProfit)}`,
      time: report.generatedAt ?? report.dataWindow?.lastCandleAt ?? '',
      title: strategy?.name ?? report.strategyId,
      tone: assessment.tone,
    };
  });

  return [...reportRows, ...backtestRows].sort((left, right) => new Date(right.time).getTime() - new Date(left.time).getTime());
}

function buildAutonomousTasks(strategies: Strategy[], backtests: BacktestReport[], settings: AgentSettings): AgentQueueTask[] {
  if (!settings.enabled || settings.queuePaused) {
    return [
      {
        action: 'analyze_strategy',
        createdAt: new Date().toISOString(),
        id: 'agent-auto-paused',
        nextAction: settings.enabled ? 'Queue is paused in Agent preferences.' : 'Enable Strategy Agent in preferences.',
        priority: 'normal',
        status: 'blocked',
      },
    ];
  }

  const latestReports = new Map(backtests.filter(isTrustedCalculatedBacktest).map((report) => [report.strategyId, report]));
  const tasks: AgentQueueTask[] = [];

  for (const strategy of strategies) {
    if ((settings.limits.allowedMarkets.length > 0 && !settings.limits.allowedMarkets.includes(strategy.market)) || !settings.limits.allowedTimeframes.includes(strategy.timeframe)) {
      continue;
    }

    const report = latestReports.get(strategy.id);

    if (!report) {
      tasks.push({
        action: 'run_backtest',
        createdAt: new Date().toISOString(),
        id: `agent-auto-backtest-${strategy.id}`,
        nextAction: `Cron goal: test this strategy across top cryptos and multiple timeframes.`,
        priority: 'high',
        status: 'queued',
        strategyId: strategy.id,
      });
      continue;
    }

    if (report.totalTrades < settings.limits.minTrades) {
      tasks.push({
        action: 'run_backtest',
        createdAt: new Date().toISOString(),
        id: `agent-auto-sample-${strategy.id}`,
        nextAction: `Cron goal: expand sample size beyond ${report.totalTrades}/${settings.limits.minTrades} trades.`,
        priority: 'normal',
        status: 'queued',
        strategyId: strategy.id,
      });
      continue;
    }

    const assessment = assessBotReadiness(report, settings);

    if (assessment.decision === 'bot_candidate' || assessment.decision === 'paper_test') {
      tasks.push({
        action: 'run_paper_test',
        createdAt: new Date().toISOString(),
        id: `agent-auto-paper-${strategy.id}`,
        nextAction: `Cron goal: paper validate score ${assessment.score}/100 before any bot.`,
        priority: 'high',
        status: 'queued',
        strategyId: strategy.id,
      });
    }
  }

  return tasks.slice(0, 100);
}

function isTrustedCalculatedBacktest(report: BacktestReport) {
  return report.source === 'calculated' && Boolean(report.dataWindow?.candleChecksum) && Array.isArray(report.equityCurve) && report.equityCurve.length > 0 && Boolean(report.executionSettings);
}

function assessBotReadiness(report: BacktestReport, settings: AgentSettings) {
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

  return {
    decision,
    reason:
      decision === 'bot_candidate'
        ? 'Worth paper-bot testing under strict risk controls.'
        : decision === 'paper_test'
          ? 'Worth paper validation, not live automation.'
          : decision === 'watch'
            ? 'Promising enough to watch, but not eligible for a bot yet.'
            : 'Not worth using as a bot from current evidence.',
    score: Math.max(0, Math.min(100, score)),
    tone: decision === 'bot_candidate' || decision === 'paper_test' ? ('positive' as const) : decision === 'watch' ? ('warning' as const) : ('negative' as const),
    usagePlan:
      decision === 'bot_candidate' || decision === 'paper_test'
        ? [`Paper bot only on ${report.market ?? 'tested market'} ${report.timeframe ?? 'tested timeframe'} with the exact report settings.`]
        : ['Do not run as bot yet. Keep testing.'],
  };
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
