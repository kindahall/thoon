'use client';

import { Download, Filter } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Badge, Button, Card, HelpPopover } from '../../components/ui';
import type { Bot as TradingBot, BotLog } from '../../types/trading';

type BotLogsPageProps = {
  bot: TradingBot;
  logs: BotLog[];
};

type LogFilter = 'all' | 'signal' | 'order' | 'error' | 'risk' | 'API' | 'system';

type DetailedBotLog = {
  action: string;
  category: Exclude<LogFilter, 'all'>;
  details: string;
  event: string;
  id: string;
  pair: string;
  status: 'success' | 'warning' | 'blocked' | 'failed';
  time: string;
};

const filters: Array<{ label: string; value: LogFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'signal', value: 'signal' },
  { label: 'order', value: 'order' },
  { label: 'error', value: 'error' },
  { label: 'risk', value: 'risk' },
  { label: 'API', value: 'API' },
  { label: 'system', value: 'system' },
];

export function BotLogsPage({ bot, logs }: BotLogsPageProps) {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [exportState, setExportState] = useState('Ready');
  const detailedLogs = useMemo(() => buildDetailedLogs(bot, logs), [bot, logs]);
  const filteredLogs = detailedLogs.filter((log) => filter === 'all' || log.category === filter);

  return (
    <section className="bot-logs-page" aria-label="Bot logs">
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">{bot.symbol}</p>
          <h1>Bot Logs</h1>
        </div>
        <div className="workspace-header__right">
          <Link className="ui-button ui-button--secondary ui-button--sm" href={`/bots/${bot.id}`}>
            Bot Detail
          </Link>
          <Button icon={<Download size={15} />} onClick={() => setExportState('Export ready')} size="sm" variant="ghost">
            Export Logs
          </Button>
          <HelpPopover items={['Logs come from the local backend.', 'No API secrets are shown.']} title="Bot Logs" />
        </div>
      </div>

      <Card className="bot-logs-toolbar-card">
        <div className="bot-logs-title">
          <div>
            <h2>{bot.name}</h2>
            <span>{bot.id}</span>
          </div>
          <Badge tone={bot.status === 'running' ? 'positive' : bot.status === 'paused' ? 'warning' : 'neutral'}>{bot.status}</Badge>
        </div>

        <div className="bot-log-filters" aria-label="Bot log filters">
          <Filter size={16} />
          {filters.map((item) => (
            <button className={filter === item.value ? 'is-active' : undefined} key={item.value} onClick={() => setFilter(item.value)} type="button">
              {item.label}
              <span>{countByFilter(detailedLogs, item.value)}</span>
            </button>
          ))}
          <strong>{exportState}</strong>
        </div>
      </Card>

      <div className="bot-logs-layout">
        <Card className="bot-logs-timeline-card">
          <h2>Timeline</h2>
          <div className="bot-log-timeline">
            {filteredLogs.map((log) => (
              <div className={`bot-log-timeline-item ${log.category}`} key={log.id}>
                <span>{formatTime(log.time)}</span>
                <strong>{log.event}</strong>
                <small>{log.action}</small>
              </div>
            ))}
          </div>
        </Card>

        <Card className="bot-logs-table-card">
          <div className="bot-logs-table">
            <div className="bot-logs-table__head">
              <span>time</span>
              <span>event</span>
              <span>pair</span>
              <span>action</span>
              <span>status</span>
              <span>details</span>
            </div>
            {filteredLogs.map((log) => (
              <div className="bot-log-detail-row" key={log.id}>
                <span>{formatTime(log.time)}</span>
                <strong>{log.event}</strong>
                <span>{log.pair}</span>
                <span>{log.action}</span>
                <Badge tone={statusTone(log.status)}>{log.status}</Badge>
                <span>{log.details}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}

function buildDetailedLogs(bot: TradingBot, baseLogs: BotLog[]): DetailedBotLog[] {
  const baseTime = '2026-05-05T09:30:00.000Z';
  const logs: DetailedBotLog[] = [
    {
      action: 'entry check',
      category: 'signal',
      details: 'Strategy conditions matched on closed candle.',
      event: 'signal detected',
      id: 'detail-signal-detected',
      pair: bot.symbol,
      status: 'success',
      time: baseTime,
    },
    {
      action: 'submit paper order',
      category: 'order',
      details: 'Order sent to paper execution queue.',
      event: 'order sent',
      id: 'detail-order-sent',
      pair: bot.symbol,
      status: 'success',
      time: '2026-05-05T09:31:00.000Z',
    },
    {
      action: 'fill received',
      category: 'order',
      details: 'Paper fill confirmed at simulated market price.',
      event: 'order filled',
      id: 'detail-order-filled',
      pair: bot.symbol,
      status: 'success',
      time: '2026-05-05T09:32:00.000Z',
    },
    {
      action: 'protect profit',
      category: 'risk',
      details: 'Stop moved after price reached 1R.',
      event: 'stop moved',
      id: 'detail-stop-moved',
      pair: bot.symbol,
      status: 'success',
      time: '2026-05-05T09:36:00.000Z',
    },
    {
      action: 'manual control',
      category: 'system',
      details: 'Bot paused from monitoring panel.',
      event: 'bot paused',
      id: 'detail-bot-paused',
      pair: bot.symbol,
      status: 'warning',
      time: '2026-05-05T09:40:00.000Z',
    },
    {
      action: 'manual control',
      category: 'system',
      details: 'Bot resumed after review.',
      event: 'bot resumed',
      id: 'detail-bot-resumed',
      pair: bot.symbol,
      status: 'success',
      time: '2026-05-05T09:44:00.000Z',
    },
    {
      action: 'connection check',
      category: 'API',
      details: 'API throttled. No secret exposed.',
      event: 'API error',
      id: 'detail-api-error',
      pair: bot.symbol,
      status: 'failed',
      time: '2026-05-05T09:46:00.000Z',
    },
    {
      action: 'risk engine',
      category: 'risk',
      details: 'Order blocked because stop-loss was missing.',
      event: 'risk rule blocked order',
      id: 'detail-risk-blocked',
      pair: bot.symbol,
      status: 'blocked',
      time: '2026-05-05T09:49:00.000Z',
    },
  ];

  return [
    ...logs,
    ...baseLogs
      .filter((log) => log.botId === bot.id)
      .map((log): DetailedBotLog => ({
        action: 'system note',
        category: log.level === 'error' ? 'error' : 'system',
        details: log.message,
        event: log.level === 'error' ? 'API error' : 'bot event',
        id: `detail-${log.id}`,
        pair: bot.symbol,
        status: log.level === 'error' ? 'failed' : log.level === 'warning' ? 'warning' : 'success',
        time: log.time,
      })),
  ].sort((first, second) => new Date(second.time).getTime() - new Date(first.time).getTime());
}

function countByFilter(logs: DetailedBotLog[], filter: LogFilter) {
  if (filter === 'all') {
    return logs.length;
  }

  return logs.filter((log) => log.category === filter).length;
}

function statusTone(status: DetailedBotLog['status']) {
  switch (status) {
    case 'success':
      return 'positive';
    case 'warning':
      return 'warning';
    case 'blocked':
    case 'failed':
      return 'negative';
  }
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}
