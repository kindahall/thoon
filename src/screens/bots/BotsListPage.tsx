'use client';

import { Bell, Bot as BotIcon, Copy, ExternalLink, FileText, LineChart, Pause, Pencil, Play, Plus, Search, Square, TerminalSquare } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';

import { Badge, Card, EmptyState, HelpPopover } from '../../components/ui';
import { postJson } from '../../services/api-client';
import type { Alert, Bot as TradingBot, Strategy } from '../../types/trading';
import { formatUsd } from '../../utils/format';

type BotsListPageProps = {
  alerts: Alert[];
  bots: TradingBot[];
  strategies: Strategy[];
};

type BotFilter = 'all' | TradingBot['status'] | TradingBot['mode'];

const filters: Array<{ label: string; value: BotFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Running', value: 'running' },
  { label: 'Paused', value: 'paused' },
  { label: 'Stopped', value: 'stopped' },
  { label: 'Draft', value: 'draft' },
  { label: 'Paper', value: 'paper' },
  { label: 'Live', value: 'live' },
];

export function BotsListPage({ alerts, bots, strategies }: BotsListPageProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<BotFilter>('all');
  const [selectedBotId, setSelectedBotId] = useState(bots[0]?.id ?? '');
  const [statusOverrides, setStatusOverrides] = useState<Partial<Record<string, TradingBot['status']>>>({});

  const visibleBots = useMemo(() => {
    return bots
      .map((bot) => ({ ...bot, status: statusOverrides[bot.id] ?? bot.status }))
      .filter((bot) => {
        if (filter === 'all') {
          return true;
        }

        return bot.status === filter || bot.mode === filter;
      })
      .filter((bot) => {
        const strategy = strategies.find((item) => item.id === bot.strategyId);
        const haystack = `${bot.name} ${bot.symbol} ${bot.exchange} ${bot.mode} ${bot.status} ${strategy?.name ?? ''}`.toLowerCase();

        return haystack.includes(query.toLowerCase());
      });
  }, [bots, filter, query, statusOverrides, strategies]);

  const selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? visibleBots[0] ?? bots[0];
  const selectedBotWithStatus = selectedBot ? { ...selectedBot, status: statusOverrides[selectedBot.id] ?? selectedBot.status } : undefined;
  const activeBots = bots.filter((bot) => (statusOverrides[bot.id] ?? bot.status) === 'running').length;
  const totalPnl = bots.reduce((sum, bot) => sum + bot.pnl, 0);
  const winRate = bots.length ? bots.reduce((sum, bot) => sum + bot.winRate, 0) / bots.length : 0;
  const activeBotAlerts = alerts.filter((alert) => alert.type === 'bot' && alert.status === 'active').length;

  async function setBotStatus(botId: string, nextStatus: TradingBot['status']) {
    const action = nextStatus === 'running' ? 'start' : nextStatus === 'paused' ? 'pause' : 'stop';

    try {
      const updatedBot = await postJson<TradingBot>(`/api/bots/${encodeURIComponent(botId)}/action`, { action });
      setStatusOverrides((current) => ({ ...current, [botId]: updatedBot.status }));
    } catch {
      setStatusOverrides((current) => ({ ...current, [botId]: nextStatus }));
    }

    setSelectedBotId(botId);
  }

  return (
    <section className="bots-list-page" aria-label="Bots list">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Bots</h1>
          <p>Deploy, monitor, and manage your trading bots.</p>
        </div>
        <div className="workspace-header__right">
          <Link className="bot-create-link" href="/backtest">
            <Plus size={15} />
            Backtest avant bot
          </Link>
          <HelpPopover items={['Pause and stop persist through the API.', 'Live bots require confirmation before launch.']} title="Bots" />
        </div>
      </div>

      <div className="bot-summary-grid">
        <BotSummaryCard icon={<BotIcon size={20} />} label="Active Bots" value={`${activeBots}`} meta={`${bots.length} total`} tone="positive" />
        <BotSummaryCard icon={<LineChart size={20} />} label="Total PnL" value={formatUsd(totalPnl)} meta="All bots" tone={totalPnl >= 0 ? 'positive' : 'negative'} />
        <BotSummaryCard icon={<TerminalSquare size={20} />} label="Win Rate" value={`${Math.round(winRate)}%`} meta="Average" tone="primary" />
        <BotSummaryCard icon={<Bell size={20} />} label="Active Alerts" value={String(activeBotAlerts)} meta="Require review" tone={activeBotAlerts > 0 ? 'warning' : 'neutral'} />
      </div>

      <div className="bots-list-layout">
        <Card className="bots-table-card">
          {bots.length === 0 ? (
            <EmptyState
              actionHref="/backtest"
              actionLabel="Backtest avant bot"
              description="Build a paper bot from a verified backtest report."
              icon={<BotIcon size={20} />}
              secondaryActionHref="/strategies"
              secondaryActionLabel="Browse Strategies"
              title="No bots yet"
            />
          ) : (
            <>
              <div className="bots-toolbar">
                <label className="bots-search">
                  <Search size={16} />
                  <input aria-label="Search bots" onChange={(event) => setQuery(event.target.value)} placeholder="Search bots" value={query} />
                </label>
              </div>

              <div className="bots-filters" aria-label="Bot filters">
                {filters.map((item) => (
                  <button className={filter === item.value ? 'is-active' : undefined} key={item.value} onClick={() => setFilter(item.value)} type="button">
                    {item.label}
                    <span>{countByFilter(bots, item.value, statusOverrides)}</span>
                  </button>
                ))}
              </div>

              <div className="bots-table">
                <div className="bots-table__head">
                  <span>Name</span>
                  <span>Strategy</span>
                  <span>Exchange</span>
                  <span>Symbol</span>
                  <span>Mode</span>
                  <span>Status</span>
                  <span>Actions</span>
                </div>
                {visibleBots.length > 0 ? (
                  visibleBots.map((bot) => {
                    const strategy = strategies.find((item) => item.id === bot.strategyId);

                    return (
                      <div className={selectedBotId === bot.id ? 'bot-row is-selected' : 'bot-row'} key={bot.id}>
                        <button className="bot-row__name" onClick={() => setSelectedBotId(bot.id)} type="button">
                          <span>
                            <BotIcon size={18} />
                          </span>
                          <div>
                            <strong>{bot.name}</strong>
                            <small>{bot.id}</small>
                          </div>
                        </button>
                        <span>{strategy?.name ?? bot.strategyId}</span>
                        <span>{bot.exchange}</span>
                        <span>{bot.symbol}</span>
                        <Badge tone={bot.mode === 'live' ? 'positive' : 'primary'}>{bot.mode}</Badge>
                        <Badge tone={statusTone(bot.status)}>{bot.status}</Badge>
                        <div className="bot-actions">
                          <button aria-label={bot.status === 'running' ? `Pause ${bot.name}` : `Resume ${bot.name}`} onClick={() => void setBotStatus(bot.id, bot.status === 'running' ? 'paused' : 'running')} title={bot.status === 'running' ? 'Pause bot' : 'Resume bot'} type="button">
                            {bot.status === 'running' ? <Pause size={15} /> : <Play size={15} />}
                          </button>
                          <button aria-label={`Stop ${bot.name}`} onClick={() => void setBotStatus(bot.id, 'stopped')} title="Stop bot" type="button">
                            <Square size={15} />
                          </button>
                          <Link aria-label={`Edit ${bot.name}`} href={`/bots/new?botId=${encodeURIComponent(bot.id)}`} title="Edit bot">
                            <Pencil size={15} />
                          </Link>
                          <Link aria-label={`Details ${bot.name}`} href={`/bots/${bot.id}`} title="Details">
                            <FileText size={15} />
                          </Link>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <EmptyState
                    actionHref="/backtest"
                    actionLabel="Backtest avant bot"
                    description="Adjust search or create a paper bot from a verified report."
                    icon={<Search size={20} />}
                    title="No match"
                  />
                )}
                  </div>
            </>
          )}
        </Card>

        {selectedBotWithStatus ? <BotPreview alerts={alerts} bot={selectedBotWithStatus} strategies={strategies} /> : null}
      </div>
    </section>
  );
}

function BotSummaryCard({ icon, label, meta, tone, value }: { icon: ReactNode; label: string; meta: string; tone: 'neutral' | 'primary' | 'positive' | 'negative' | 'warning'; value: string }) {
  return (
    <Card className="bot-summary-card">
      <span className={`bot-summary-card__icon ${tone}`}>{icon}</span>
      <div>
        <span>{label}</span>
        <strong className={tone}>{value}</strong>
        <small>{meta}</small>
      </div>
    </Card>
  );
}

function BotPreview({ alerts, bot, strategies }: { alerts: Alert[]; bot: TradingBot; strategies: Strategy[] }) {
  const [previewTab, setPreviewTab] = useState<'overview' | 'performance' | 'logs' | 'settings'>('overview');
  const [copyStatus, setCopyStatus] = useState('Ready');
  const strategy = strategies.find((item) => item.id === bot.strategyId);
  const botAlerts = alerts.filter((alert) => alert.type === 'bot' || alert.symbol === bot.symbol);
  const isLive = bot.mode === 'live';
  const activeAlerts = botAlerts.filter((alert) => alert.status === 'active').length;

  async function copyBotId() {
    const copied = await writeClipboardText(bot.id);

    if (copied) {
      setCopyStatus('Copied');
      return;
    }

    setCopyStatus('Copy blocked');
  }

  return (
    <Card className="bot-preview-card">
      <div className="bot-preview-head">
        <div>
          <h2>{bot.name}</h2>
          <span>
            {bot.id}
            <button aria-label={`Copy ${bot.id}`} onClick={() => void copyBotId()} type="button">
              <Copy size={13} />
            </button>
            <Link aria-label={`Open ${bot.name}`} href={`/bots/${bot.id}`}>
              <ExternalLink size={13} />
            </Link>
          </span>
        </div>
        <Badge tone={isLive && bot.status === 'running' ? 'positive' : statusTone(bot.status)}>{isLive && bot.status === 'running' ? 'LIVE' : bot.status}</Badge>
      </div>

      <div className="bot-preview-tabs" aria-label="Bot details tabs">
        <button className={previewTab === 'overview' ? 'is-active' : undefined} onClick={() => setPreviewTab('overview')} type="button">Overview</button>
        <button className={previewTab === 'performance' ? 'is-active' : undefined} onClick={() => setPreviewTab('performance')} type="button">Performance</button>
        <button className={previewTab === 'logs' ? 'is-active' : undefined} onClick={() => setPreviewTab('logs')} type="button">Logs</button>
        <button className={previewTab === 'settings' ? 'is-active' : undefined} onClick={() => setPreviewTab('settings')} type="button">Settings</button>
      </div>

      {previewTab === 'overview' ? (
        <div className="bot-preview-metrics">
          <PreviewLine label="Capital" value={formatUsd(bot.allocatedCapital)} />
          <PreviewLine label="Unrealized PnL" tone={bot.pnl >= 0 ? 'positive' : 'negative'} value={formatUsd(bot.pnl * 0.34)} />
          <PreviewLine label="Total PnL" tone={bot.pnl >= 0 ? 'positive' : 'negative'} value={formatUsd(bot.pnl)} />
          <PreviewLine label="Win Rate" value={`${bot.winRate}%`} />
          <PreviewLine label="Max Drawdown" tone={bot.maxDrawdown < 0 ? 'negative' : 'neutral'} value={`${bot.maxDrawdown}%`} />
          <PreviewLine label="Risk / Trade" value={`${bot.riskPerTrade}%`} />
          <PreviewLine label="Leverage" value="10x" />
          <PreviewLine label="Position Size" value="0.148 BTC" />
        </div>
      ) : null}

      {previewTab === 'performance' ? (
        <div className="bot-preview-metrics">
          <PreviewLine label="Total PnL" tone={bot.pnl >= 0 ? 'positive' : 'negative'} value={formatUsd(bot.pnl)} />
          <PreviewLine label="Win Rate" value={`${bot.winRate}%`} />
          <PreviewLine label="Max Drawdown" tone="negative" value={`${bot.maxDrawdown}%`} />
          <PreviewLine label="Allocated" value={formatUsd(bot.allocatedCapital)} />
        </div>
      ) : null}

      {previewTab === 'logs' ? (
        <div className="bot-preview-metrics">
          <PreviewLine label="Active Alerts" tone={activeAlerts > 0 ? 'warning' : 'neutral'} value={String(activeAlerts)} />
          <PreviewLine label="Last Signal" tone="positive" value="BUY" />
          <PreviewLine label="Copy State" value={copyStatus} />
          <PreviewLine label="Log Route" value={`/bots/${bot.id}/logs`} />
        </div>
      ) : null}

      {previewTab === 'settings' ? (
        <div className="bot-preview-metrics">
          <PreviewLine label="Mode" tone={isLive ? 'warning' : 'primary'} value={bot.mode} />
          <PreviewLine label="Exchange" value={bot.exchange} />
          <PreviewLine label="Strategy" value={strategy?.name ?? bot.strategyId} />
          <PreviewLine label="Symbol" value={bot.symbol} />
        </div>
      ) : null}

      <div className="bot-signal-card">
        <div>
          <span>Last Signal</span>
          <Badge tone="positive">BUY</Badge>
        </div>
        <strong>May 17, 2024 21:30</strong>
        <p>EMA 9 crossed above EMA 21</p>
      </div>

      <div className="bot-trade-card">
        <div>
          <span>Last Trade</span>
          <Badge tone="positive">Long</Badge>
        </div>
        <strong>May 17, 2024 21:45</strong>
        <dl>
          <div>
            <dt>Entry</dt>
            <dd>67,347.6 USDT</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>0.148 BTC</dd>
          </div>
          <div>
            <dt>PnL</dt>
            <dd className="positive">+84.21 USDT</dd>
          </div>
        </dl>
      </div>

      <div className="bot-connection-list">
        <PreviewLine label="Connection" tone="positive" value="Connected" />
        <PreviewLine label="Exchange" value={bot.exchange} />
        <PreviewLine label="API" tone={isLive ? 'positive' : 'primary'} value={isLive ? 'Main API' : 'Paper API'} />
        <PreviewLine label="Strategy" value={strategy?.name ?? bot.strategyId} />
        <PreviewLine label="Alerts" tone={activeAlerts > 0 ? 'warning' : 'neutral'} value={String(activeAlerts)} />
      </div>

      <div className="bot-preview-actions">
        <Link className="is-primary" href={`/backtest?strategyId=${encodeURIComponent(bot.strategyId)}`}>Open in Backtest</Link>
        <Link href={`/charts?pair=${encodeURIComponent(bot.symbol)}`}>Open Chart</Link>
        <Link href={`/bots/${bot.id}`}>Details</Link>
      </div>
    </Card>
  );
}

async function writeClipboardText(value: string) {
  if (typeof window === 'undefined') {
    return false;
  }

  return legacyClipboardCopy(value);
}

function legacyClipboardCopy(value: string) {
  const textArea = document.createElement('textarea');

  textArea.value = value;
  textArea.setAttribute('readonly', 'true');
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.top = '0';
  document.body.appendChild(textArea);
  textArea.select();

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}

function PreviewLine({ label, tone = 'neutral', value }: { label: string; tone?: 'neutral' | 'primary' | 'positive' | 'negative' | 'warning'; value: string }) {
  return (
    <div className="preview-line">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function countByFilter(bots: TradingBot[], filter: BotFilter, statusOverrides: Partial<Record<string, TradingBot['status']>>) {
  if (filter === 'all') {
    return bots.length;
  }

  return bots.filter((bot) => (statusOverrides[bot.id] ?? bot.status) === filter || bot.mode === filter).length;
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
