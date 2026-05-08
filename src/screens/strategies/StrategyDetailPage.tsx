'use client';

import { Archive, Bot, Copy, Edit3, FileText, LineChart, Play, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';

import { StrategyAgentDrawer } from '../../components/agent/StrategyAgentDrawer';
import { Badge, Button, Card, HelpPopover, Modal } from '../../components/ui';
import { deleteJson, patchJson, postJson } from '../../services/api-client';
import type { AgentReport, AgentRun, AgentSettings, AgentSuggestion, BacktestReport, Bot as TradingBot, RiskRules, Strategy, StrategyVersion } from '../../types/trading';
import { formatPercent, formatUsd } from '../../utils/format';

type StrategyDetailPageProps = {
  agentReports: AgentReport[];
  agentRuns: AgentRun[];
  agentSettings: AgentSettings;
  agentSuggestions: AgentSuggestion[];
  agentVersions: StrategyVersion[];
  bots: TradingBot[];
  reports: BacktestReport[];
  riskRules: RiskRules;
  strategy: Strategy;
};

type StrategyTab = 'overview' | 'conditions' | 'backtests' | 'bots' | 'versions' | 'settings';
type ConfirmationKind = 'archive' | 'delete' | null;

const tabs: StrategyTab[] = ['overview', 'conditions', 'backtests', 'bots', 'versions', 'settings'];

export function StrategyDetailPage({ agentReports, agentRuns, agentSettings, agentSuggestions, agentVersions, bots, reports, riskRules, strategy }: StrategyDetailPageProps) {
  const router = useRouter();
  const [strategyRecord, setStrategyRecord] = useState(strategy);
  const [activeTab, setActiveTab] = useState<StrategyTab>('overview');
  const [confirmation, setConfirmation] = useState<ConfirmationKind>(null);
  const [actionStatus, setActionStatus] = useState('Ready');
  const linkedBots = bots.filter((bot) => bot.strategyId === strategyRecord.id);
  const strategyReports = reports.filter((report) => report.strategyId === strategyRecord.id);
  const latestReport = strategyReports[0];
  const conditions = useMemo(() => buildStrategyConditions(strategyRecord), [strategyRecord]);

  async function duplicateStrategy() {
    setActionStatus('Duplicating');

    try {
      const nextStrategy = await postJson<Strategy>(`/api/strategies/${encodeURIComponent(strategyRecord.id)}/duplicate`);
      router.push(`/strategies/${nextStrategy.id}`);
      router.refresh();
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Duplicate failed');
    }
  }

  async function confirmStrategyAction() {
    if (!confirmation) {
      return;
    }

    setActionStatus(confirmation === 'delete' ? 'Deleting' : 'Archiving');

    try {
      if (confirmation === 'delete') {
        await deleteJson(`/api/strategies/${encodeURIComponent(strategyRecord.id)}`);
        router.push('/strategies');
        router.refresh();
      } else {
        const updatedStrategy = await patchJson<Strategy>(`/api/strategies/${encodeURIComponent(strategyRecord.id)}`, { status: 'archived' });
        setStrategyRecord(updatedStrategy);
        setActionStatus('Archived');
      }

      setConfirmation(null);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Action failed');
    }
  }

  return (
    <section className="strategy-detail-page" aria-label="Strategy detail">
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">{strategyRecord.market}</p>
          <h1>{strategyRecord.name}</h1>
        </div>
        <div className="workspace-header__right">
          <StrategyAgentDrawer context="strategy" reports={agentReports} runs={agentRuns} settings={agentSettings} strategyId={strategyRecord.id} strategyName={strategyRecord.name} suggestions={agentSuggestions} versions={agentVersions} />
          <Link className="ui-button ui-button--ghost ui-button--sm" href={`/strategies/new?strategyId=${encodeURIComponent(strategyRecord.id)}`}>
            <span className="ui-button__icon">
              <Edit3 size={15} />
            </span>
            Edit
          </Link>
          <Button icon={<Copy size={15} />} onClick={duplicateStrategy} size="sm" variant="ghost">
            Duplicate
          </Button>
          <Link className="ui-button ui-button--secondary ui-button--sm" href={`/backtest?strategyId=${encodeURIComponent(strategyRecord.id)}`}>
            <span className="ui-button__icon">
              <LineChart size={15} />
            </span>
            <span>Backtest</span>
          </Link>
          <Link className="ui-button ui-button--primary ui-button--sm" href={`/bots/new?strategyId=${encodeURIComponent(strategyRecord.id)}`}>
            <span className="ui-button__icon">
              <Bot size={15} />
            </span>
            <span>Create Bot</span>
          </Link>
          <HelpPopover items={['Archive and delete require confirmation.', 'Bots inherit risk rules from this strategy.']} title="Strategy Detail" />
        </div>
      </div>

      <div className="strategy-detail-layout">
        <Card className="strategy-detail-hero">
          <div>
            <Badge tone={strategyRecord.status === 'active' ? 'positive' : strategyRecord.status === 'draft' ? 'warning' : 'neutral'}>{strategyRecord.status}</Badge>
            <h2>{strategyRecord.name}</h2>
            <span>
              {formatStrategyType(strategyRecord.type)} · {strategyRecord.timeframe}
            </span>
          </div>
          <div className="strategy-detail-metrics">
            <StrategyMetric label="Performance" tone={strategyRecord.performance30d >= 0 ? 'positive' : 'negative'} value={formatPercent(strategyRecord.performance30d)} />
            <StrategyMetric label="Linked bots" value={String(linkedBots.length)} />
            <StrategyMetric label="Win rate" value={latestReport ? `${Math.round(latestReport.winRate)}%` : 'No run'} />
            <StrategyMetric label="Updated" value={formatShortDate(strategyRecord.updatedAt)} />
          </div>
        </Card>

        <Card className="strategy-detail-actions-card">
          <Link href={`/charts?pair=${encodeURIComponent(strategyRecord.market)}`}>
            <Play size={15} />
            Open on Chart
          </Link>
          <button onClick={() => setConfirmation('archive')} type="button">
            <Archive size={15} />
            Archive
          </button>
          <button className="is-danger" onClick={() => setConfirmation('delete')} type="button">
            <Trash2 size={15} />
            Delete
          </button>
          <span>{actionStatus}</span>
        </Card>
      </div>

      <div className="strategy-tabs" aria-label="Strategy tabs">
        {tabs.map((tab) => (
          <button className={activeTab === tab ? 'is-active' : undefined} key={tab} onClick={() => setActiveTab(tab)} type="button">
            {formatTab(tab)}
          </button>
        ))}
      </div>

      <Card className="strategy-tab-panel">
        {activeTab === 'overview' ? (
          <div className="strategy-overview-grid">
            <DetailBlock title="Backtest Summary">
              <DetailLine label="Net Profit" value={latestReport ? formatUsd(latestReport.netProfit) : 'No report'} />
              <DetailLine label="Profit Factor" value={latestReport ? latestReport.profitFactor.toFixed(2) : '-'} />
              <DetailLine label="Max Drawdown" value={latestReport ? `${latestReport.drawdown}%` : '-'} />
              <DetailLine label="Total Trades" value={latestReport ? String(latestReport.totalTrades) : '-'} />
            </DetailBlock>
            <DetailBlock title="Risk Rules">
              <DetailLine label="Risk / trade" value={`${strategyRecord.riskPerTrade}%`} />
              <DetailLine label="Max risk" value={`${riskRules.maxRiskPerTrade}%`} />
              <DetailLine label="Stop-loss" value={riskRules.blockOrdersWithoutStop ? 'Required' : 'Optional'} />
              <DetailLine label="Live confirm" value={riskRules.confirmLiveOrders ? 'Enabled' : 'Disabled'} />
            </DetailBlock>
            <DetailBlock title="Notes">
              <p>{strategyRecord.setupSnapshot?.notes || (strategyRecord.status === 'draft' ? 'Draft strategy awaiting backtest validation.' : 'Validated for paper automation and manual review.')}</p>
              {strategyRecord.sourceSetupId ? <DetailLine label="Source setup" value={strategyRecord.sourceSetupId} /> : null}
              {strategyRecord.positionDraft ? <DetailLine label="Chart draft" value={`${strategyRecord.positionDraft.direction} · ${strategyRecord.positionDraft.riskPercent}% risk`} /> : null}
            </DetailBlock>
          </div>
        ) : null}

        {activeTab === 'conditions' ? (
          <div className="conditions-detail-grid">
            <ConditionList title="Entry conditions" values={conditions.entry} />
            <ConditionList title="Exit conditions" values={conditions.exit} />
          </div>
        ) : null}

        {activeTab === 'backtests' ? <BacktestList reports={strategyReports} /> : null}
        {activeTab === 'bots' ? <LinkedBotsList bots={linkedBots} /> : null}
        {activeTab === 'versions' ? <VersionHistory strategy={strategyRecord} versions={agentVersions} /> : null}
        {activeTab === 'settings' ? (
          <div className="strategy-settings-grid">
            <DetailLine label="Market" value={strategyRecord.market} />
            <DetailLine label="Timeframe" value={strategyRecord.timeframe} />
            <DetailLine label="Type" value={formatStrategyType(strategyRecord.type)} />
            <DetailLine label="Last updated" value={formatShortDate(strategyRecord.updatedAt)} />
          </div>
        ) : null}
      </Card>

      <Modal onClose={() => setConfirmation(null)} open={confirmation !== null} title={confirmation === 'delete' ? 'Delete Strategy' : 'Archive Strategy'}>
        <div className="confirmation-modal-body">
          <p>{confirmation === 'delete' ? 'Deleting this strategy will remove its draft configuration in a real backend flow.' : 'Archiving pauses edits and hides the strategy from active lists.'}</p>
          <div>
            <Button onClick={() => setConfirmation(null)} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button onClick={confirmStrategyAction} size="sm" variant={confirmation === 'delete' ? 'danger' : 'primary'}>
              Confirm
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function StrategyMetric({ label, tone = 'neutral', value }: { label: string; tone?: 'neutral' | 'positive' | 'negative'; value: string }) {
  return (
    <div className="strategy-metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function DetailBlock({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="detail-block">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ConditionList({ title, values }: { title: string; values: string[] }) {
  return (
    <DetailBlock title={title}>
      <div className="condition-detail-list">
        {values.map((value) => (
          <span key={value}>
            <FileText size={14} />
            {value}
          </span>
        ))}
      </div>
    </DetailBlock>
  );
}

function BacktestList({ reports }: { reports: BacktestReport[] }) {
  return (
    <div className="strategy-list-panel">
      {reports.map((report) => (
        <div key={report.id}>
          <strong>{report.period}</strong>
          <span>{formatUsd(report.netProfit)}</span>
          <span>{report.winRate}% win</span>
          <span>{report.totalTrades} trades</span>
        </div>
      ))}
    </div>
  );
}

function LinkedBotsList({ bots }: { bots: TradingBot[] }) {
  return (
    <div className="strategy-list-panel">
      {bots.map((bot) => (
        <Link href={`/bots/${bot.id}`} key={bot.id}>
          <strong>{bot.name}</strong>
          <span>{bot.mode}</span>
          <span>{bot.status}</span>
          <span>{formatUsd(bot.pnl)}</span>
        </Link>
      ))}
    </div>
  );
}

function VersionHistory({ strategy, versions }: { strategy: Strategy; versions: StrategyVersion[] }) {
  if (versions.length) {
    return (
      <div className="strategy-list-panel">
        {versions.map((version) => (
          <div key={version.id}>
            <strong>{version.version}</strong>
            <span>{version.protectedOriginal ? 'Original Protected' : version.changeSummary}</span>
            <span>{version.stage.replace(/_/g, ' ')}</span>
            <span>{version.robustnessScore}/100</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="strategy-list-panel">
      <div>
        <strong>No real versions yet</strong>
        <span>{formatShortDate(strategy.updatedAt)}</span>
        <span>Run the agent to create a tracked variant.</span>
      </div>
    </div>
  );
}

function buildStrategyConditions(strategy: Strategy) {
  if (strategy.entryConditions?.length || strategy.exitConditions?.length) {
    return {
      entry: (strategy.entryConditions?.length ? strategy.entryConditions : []).map(formatStrategyCondition),
      exit: (strategy.exitConditions?.length ? strategy.exitConditions : []).map(formatStrategyCondition),
    };
  }

  if (strategy.type === 'mean-reversion') {
    return {
      entry: ['IF RSI less than 35', 'AND price near lower range', 'AND volume above 20D average'],
      exit: ['IF RSI greater than 65', 'OR price reaches 2R', 'OR stop-loss hit'],
    };
  }

  if (strategy.type === 'breakout') {
    return {
      entry: ['IF price breaks previous high', 'AND volume greater than 20D average', 'AND candle closes above range'],
      exit: ['IF price loses breakout level', 'OR trailing stop hit', 'OR 2.5R reached'],
    };
  }

  return {
    entry: ['IF price crosses above EMA 50', 'AND higher low confirmed', 'AND market trend is positive'],
    exit: ['IF price crosses below EMA 20', 'OR take-profit reached', 'OR stop-loss hit'],
  };
}

function formatStrategyCondition(condition: NonNullable<Strategy['entryConditions']>[number]) {
  return `${condition.connector} ${condition.field} ${condition.operator.replace('-', ' ')} ${condition.value}`;
}

function formatStrategyType(type: Strategy['type']) {
  switch (type) {
    case 'mean-reversion':
      return 'Mean Reversion';
    case 'breakout':
      return 'Breakout';
    case 'trend':
      return 'Trend';
    case 'grid':
      return 'Grid';
  }
}

function formatTab(tab: StrategyTab) {
  return tab[0].toUpperCase() + tab.slice(1);
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value));
}
