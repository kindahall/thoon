'use client';

import { Download, ExternalLink, Pause, Pencil, Play, Square } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { StrategyAgentDrawer } from '../../components/agent/StrategyAgentDrawer';
import { Badge, Button, Card, HelpPopover, Modal } from '../../components/ui';
import { postJson } from '../../services/api-client';
import type { AgentReport, AgentRun, AgentSettings, AgentSuggestion, Bot as TradingBot, BotLog, ExchangeConnection, Position, Strategy, StrategyVersion } from '../../types/trading';
import { formatUsd } from '../../utils/format';

type BotDetailPageProps = {
  agentReports: AgentReport[];
  agentRuns: AgentRun[];
  agentSettings: AgentSettings;
  agentSuggestions: AgentSuggestion[];
  agentVersions: StrategyVersion[];
  bot: TradingBot;
  exchanges: ExchangeConnection[];
  logs: BotLog[];
  positions: Position[];
  strategy?: Strategy;
};

type BotDetailTab = 'overview' | 'performance' | 'positions' | 'logs' | 'settings';
type CriticalAction = 'pause' | 'resume' | 'stop' | null;

const tabs: Array<{ id: BotDetailTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'performance', label: 'Performance' },
  { id: 'positions', label: 'Positions' },
  { id: 'logs', label: 'Logs' },
  { id: 'settings', label: 'Settings' },
];

export function BotDetailPage({ agentReports, agentRuns, agentSettings, agentSuggestions, agentVersions, bot, exchanges, logs, positions, strategy }: BotDetailPageProps) {
  const [activeTab, setActiveTab] = useState<BotDetailTab>('overview');
  const [status, setStatus] = useState(bot.status);
  const [criticalAction, setCriticalAction] = useState<CriticalAction>(null);
  const [exportState, setExportState] = useState('Ready');
  const exchange = exchanges.find((item) => item.name === bot.exchange.toLowerCase() || item.name === bot.exchange);
  const currentPosition = positions.find((position) => position.symbol === bot.symbol);
  const botLogs = logs.filter((log) => log.botId === bot.id);
  const visibleLogs = botLogs.length ? botLogs : logs.slice(0, 3);
  const unrealizedPnl = currentPosition?.pnl ?? bot.pnl * 0.34;
  const realizedPnl = bot.pnl - unrealizedPnl;
  const apiStatus = bot.exchange === 'Paper' ? 'Paper safe' : exchange?.permissions.includes('trade') ? 'Trade enabled' : 'Read only';
  const connectionStatus = bot.exchange === 'Paper' ? 'Paper' : exchange?.status ?? 'available';
  const performanceSeries = useMemo(() => buildBotPerformanceSeries(bot.pnl), [bot.pnl]);

  function requestAction(action: Exclude<CriticalAction, null>) {
    if (bot.mode === 'live' && (action === 'pause' || action === 'stop')) {
      setCriticalAction(action);
      return;
    }

    void applyAction(action);
  }

  async function applyAction(action: Exclude<CriticalAction, null>) {
    const apiAction = action === 'resume' ? 'start' : action;

    try {
      const updatedBot = await postJson<TradingBot>(`/api/bots/${encodeURIComponent(bot.id)}/action`, { action: apiAction });
      setStatus(updatedBot.status);
      setExportState(`${updatedBot.status} saved`);
    } catch (error) {
      setExportState(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setCriticalAction(null);
    }
  }

  function exportLogs() {
    const payload = {
      botId: bot.id,
      exportedAt: new Date().toISOString(),
      logs: visibleLogs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = href;
    link.download = `thoon-${bot.id}-logs.json`;
    link.click();
    URL.revokeObjectURL(href);
    setExportState('Logs exported');
  }

  return (
    <section className="bot-detail-page" aria-label="Bot detail">
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">{bot.symbol}</p>
          <h1>{bot.name}</h1>
        </div>
        <div className="workspace-header__right">
          <StrategyAgentDrawer context="bot" reports={agentReports} runs={agentRuns} settings={agentSettings} strategyId={bot.strategyId} strategyName={strategy?.name ?? bot.strategyId} suggestions={agentSuggestions} versions={agentVersions} />
          <Button disabled={status !== 'running'} icon={<Pause size={15} />} onClick={() => requestAction('pause')} size="sm" variant="ghost">
            Pause Bot
          </Button>
          <Button disabled={status === 'running'} icon={<Play size={15} />} onClick={() => requestAction('resume')} size="sm" variant="ghost">
            Resume Bot
          </Button>
          <Button icon={<Square size={15} />} onClick={() => requestAction('stop')} size="sm" variant="danger">
            Stop Bot
          </Button>
          <Link className="ui-button ui-button--secondary ui-button--sm" href={`/bots/new?botId=${encodeURIComponent(bot.id)}`}>
            <span className="ui-button__icon">
              <Pencil size={15} />
            </span>
            <span>Edit Bot</span>
          </Link>
          <HelpPopover items={['Live pause and stop require confirmation.', 'Detailed logs are available from the Logs tab.']} title="Bot Detail" />
        </div>
      </div>

      <Card className="bot-detail-hero">
        <div className="bot-detail-title">
          <Badge tone={statusTone(status)}>{status}</Badge>
          <Badge tone={bot.mode === 'live' ? 'warning' : 'primary'}>{bot.mode}</Badge>
          <span>{bot.id}</span>
        </div>
        <div className="bot-detail-meta-grid">
          <DetailMeta label="Exchange" value={bot.exchange} />
          <DetailMeta label="Strategy" value={strategy?.name ?? bot.strategyId} />
          <DetailMeta label="Market / Pair" value={bot.symbol} />
          <DetailMeta label="API" tone={apiStatus.includes('enabled') || apiStatus.includes('safe') ? 'positive' : 'warning'} value={apiStatus} />
        </div>
      </Card>

      <div className="bot-detail-actions-bar">
        <Link href={`/charts?pair=${encodeURIComponent(bot.symbol)}`}>Open on Chart</Link>
        <Link href={`/backtest?strategyId=${encodeURIComponent(bot.strategyId)}`}>Open Backtest</Link>
        <Link href={`/bots/${bot.id}/logs`}>Open Logs</Link>
        <button onClick={exportLogs} type="button">
          <Download size={15} />
          Export Logs
        </button>
        <span>{exportState}</span>
      </div>

      <div className="bot-detail-tabs" aria-label="Bot detail tabs">
        {tabs.map((tab) => (
          <button className={activeTab === tab.id ? 'is-active' : undefined} key={tab.id} onClick={() => setActiveTab(tab.id)} type="button">
            {tab.label}
          </button>
        ))}
      </div>

      <Card className="bot-detail-panel">
        {activeTab === 'overview' ? (
          <div className="bot-overview-grid">
            <OverviewMetric label="Capital allocated" value={formatUsd(bot.allocatedCapital)} />
            <OverviewMetric label="Current position" value={currentPosition ? `${currentPosition.side} ${currentPosition.size}` : 'Flat'} />
            <OverviewMetric label="Unrealized PnL" tone={unrealizedPnl >= 0 ? 'positive' : 'negative'} value={formatUsd(unrealizedPnl)} />
            <OverviewMetric label="Realized PnL" tone={realizedPnl >= 0 ? 'positive' : 'negative'} value={formatUsd(realizedPnl)} />
            <OverviewMetric label="Win rate" value={`${bot.winRate}%`} />
            <OverviewMetric label="Max drawdown" tone={bot.maxDrawdown < 0 ? 'negative' : 'neutral'} value={`${bot.maxDrawdown}%`} />
            <OverviewMetric label="Last signal" tone="positive" value={status === 'running' ? 'BUY' : 'None'} />
            <OverviewMetric label="Last trade" value={currentPosition ? formatShortDate(currentPosition.openedAt) : 'No position'} />
            <OverviewMetric label="Connection" tone={connectionStatus === 'connected' || connectionStatus === 'Paper' ? 'positive' : 'warning'} value={connectionStatus} />
            <OverviewMetric label="API status" tone={apiStatus.includes('enabled') || apiStatus.includes('safe') ? 'positive' : 'warning'} value={apiStatus} />
          </div>
        ) : null}

        {activeTab === 'performance' ? (
          <div className="bot-performance-layout">
            <div className="bot-performance-chart">
              <div>
                <h2>Performance</h2>
                <span>{formatUsd(bot.pnl)}</span>
              </div>
              <BotLineChart values={performanceSeries} />
            </div>
            <div className="bot-performance-side">
              <OverviewMetric label="Total PnL" tone={bot.pnl >= 0 ? 'positive' : 'negative'} value={formatUsd(bot.pnl)} />
              <OverviewMetric label="Win rate" value={`${bot.winRate}%`} />
              <OverviewMetric label="Drawdown" tone="negative" value={`${bot.maxDrawdown}%`} />
            </div>
          </div>
        ) : null}

        {activeTab === 'positions' ? <PositionsPanel position={currentPosition} /> : null}
        {activeTab === 'logs' ? <LogsPanel botId={bot.id} logs={visibleLogs} /> : null}
        {activeTab === 'settings' ? (
          <div className="bot-settings-grid">
            <OverviewMetric label="Mode" value={bot.mode} />
            <OverviewMetric label="Exchange" value={bot.exchange} />
            <OverviewMetric label="Risk / trade" value={`${bot.riskPerTrade}%`} />
            <OverviewMetric label="Allocated" value={formatUsd(bot.allocatedCapital)} />
            <OverviewMetric label="Strategy" value={strategy?.name ?? bot.strategyId} />
            <OverviewMetric label="Market" value={bot.symbol} />
          </div>
        ) : null}
      </Card>

      <Modal onClose={() => setCriticalAction(null)} open={criticalAction !== null} title="Confirm Live Action">
        <div className="bot-action-modal">
          <p>{criticalAction === 'stop' ? 'Stop this live bot now?' : 'Pause this live bot now?'}</p>
          <div>
            <Button onClick={() => setCriticalAction(null)} variant="ghost">
              Cancel
            </Button>
            <Button onClick={() => criticalAction && void applyAction(criticalAction)} variant={criticalAction === 'stop' ? 'danger' : 'primary'}>
              Confirm
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function DetailMeta({ label, tone = 'neutral', value }: { label: string; tone?: 'neutral' | 'positive' | 'warning'; value: string }) {
  return (
    <div className="bot-detail-meta">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function OverviewMetric({ label, tone = 'neutral', value }: { label: string; tone?: 'neutral' | 'positive' | 'negative' | 'warning'; value: string }) {
  return (
    <div className="bot-overview-metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function PositionsPanel({ position }: { position?: Position }) {
  if (!position) {
    return <div className="bot-empty-panel">No active position.</div>;
  }

  return (
    <div className="bot-position-grid">
      <OverviewMetric label="Symbol" value={position.symbol} />
      <OverviewMetric label="Side" value={position.side} />
      <OverviewMetric label="Entry" value={formatUsd(position.entryPrice)} />
      <OverviewMetric label="Mark" value={formatUsd(position.markPrice)} />
      <OverviewMetric label="Size" value={String(position.size)} />
      <OverviewMetric label="PnL" tone={position.pnl >= 0 ? 'positive' : 'negative'} value={formatUsd(position.pnl)} />
      <OverviewMetric label="Stop" value={formatUsd(position.stopLoss)} />
      <OverviewMetric label="Take Profit" value={formatUsd(position.takeProfit)} />
    </div>
  );
}

function LogsPanel({ botId, logs }: { botId: string; logs: BotLog[] }) {
  return (
    <div className="bot-logs-panel">
      <div className="bot-logs-panel__head">
        <h2>Logs</h2>
        <Link href={`/bots/${botId}/logs`}>
          Detailed Logs
          <ExternalLink size={14} />
        </Link>
      </div>
      {logs.map((log) => (
        <div className="bot-log-line" key={log.id}>
          <span>{formatShortDate(log.time)}</span>
          <Badge tone={log.level === 'error' ? 'negative' : log.level === 'warning' ? 'warning' : 'positive'}>{log.level}</Badge>
          <strong>{log.message}</strong>
        </div>
      ))}
    </div>
  );
}

function BotLineChart({ values }: { values: number[] }) {
  const width = 620;
  const height = 150;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * (height - 20) - 10;

      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg aria-hidden="true" className="bot-line-chart" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
      <polyline fill="none" points={points} />
    </svg>
  );
}

function buildBotPerformanceSeries(pnl: number) {
  return Array.from({ length: 24 }, (_, index) => {
    const progress = index / 23;
    const wave = Math.sin(index * 0.8) * Math.max(Math.abs(pnl) * 0.08, 45);

    return pnl * progress + wave;
  });
}

function statusTone(status: TradingBot['status']) {
  switch (status) {
    case 'running':
      return 'positive';
    case 'paused':
      return 'warning';
    case 'stopped':
      return 'negative';
    case 'draft':
      return 'neutral';
  }
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
