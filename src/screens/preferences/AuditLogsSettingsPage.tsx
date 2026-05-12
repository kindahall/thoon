'use client';

import { Download, ExternalLink, Filter, Search, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Badge, Button, Card, HelpPopover } from '../../components/ui';
import type { AuditEvent } from '../../types/trading';
import { cn } from '../../utils/classNames';

type AuditLogsSettingsPageProps = {
  auditLogs: AuditEvent[];
  initialEventType?: AuditEvent['eventType'];
};

type EventFilter = 'all' | AuditEvent['eventType'];
type ExchangeFilter = 'all' | string;
type BotFilter = 'all' | string;
type StatusFilter = 'all' | AuditEvent['status'];

const eventFilters: Array<{ label: string; value: EventFilter }> = [
  { label: 'All Events', value: 'all' },
  { label: 'API', value: 'api' },
  { label: 'Order', value: 'order' },
  { label: 'Bot', value: 'bot' },
  { label: 'Strategy', value: 'strategy' },
  { label: 'Risk', value: 'risk' },
  { label: 'System', value: 'system' },
];

const statusFilters: Array<{ label: string; value: StatusFilter }> = [
  { label: 'All Status', value: 'all' },
  { label: 'Success', value: 'success' },
  { label: 'Blocked', value: 'blocked' },
  { label: 'Failed', value: 'failed' },
  { label: 'Warning', value: 'warning' },
];

export function AuditLogsSettingsPage({ auditLogs, initialEventType }: AuditLogsSettingsPageProps) {
  const orderedLogs = useMemo(() => [...auditLogs].sort(sortByTime), [auditLogs]);
  const [query, setQuery] = useState('');
  const [eventType, setEventType] = useState<EventFilter>(initialEventType ?? 'all');
  const [exchange, setExchange] = useState<ExchangeFilter>('all');
  const [bot, setBot] = useState<BotFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selectedLogId, setSelectedLogId] = useState(orderedLogs[0]?.id ?? '');
  const [exportStatus, setExportStatus] = useState('Ready');

  const exchangeOptions = useMemo(() => Array.from(new Set(orderedLogs.map((log) => log.exchange).filter(Boolean))) as string[], [orderedLogs]);
  const botOptions = useMemo(() => Array.from(new Set(orderedLogs.map((log) => log.botId).filter(Boolean))) as string[], [orderedLogs]);

  const filteredLogs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return orderedLogs.filter((log) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [log.action, log.actor, log.details, log.eventType, log.exchange, log.id, log.ipAddress, log.status, log.symbol, log.botId]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));
      const matchesEvent = eventType === 'all' || log.eventType === eventType;
      const matchesExchange = exchange === 'all' || log.exchange === exchange;
      const matchesBot = bot === 'all' || log.botId === bot;
      const matchesStatus = status === 'all' || log.status === status;

      return matchesQuery && matchesEvent && matchesExchange && matchesBot && matchesStatus;
    });
  }, [bot, eventType, exchange, orderedLogs, query, status]);

  const selectedLog = filteredLogs.find((log) => log.id === selectedLogId) ?? filteredLogs[0] ?? orderedLogs[0];
  const summary = useMemo(() => buildSummary(filteredLogs), [filteredLogs]);

  function exportLogs() {
    setExportStatus('Export ready');
  }

  return (
    <section className="audit-logs-settings-page" aria-label="Audit logs settings">
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">Preferences</p>
          <h1>Audit Logs</h1>
        </div>
        <div className="workspace-header__right">
          <Button icon={<Download size={15} />} onClick={exportLogs} size="sm" variant="primary">
            Export Logs
          </Button>
          <HelpPopover items={['API secrets never appear in logs.', 'Sensitive actions remain confirmation gated.']} title="Audit Logs" />
        </div>
      </div>

      <div className="preferences-layout">
        <PreferencesSectionNav active="audit-logs" />

        <div className="audit-logs-layout">
          <Card className="audit-summary-card">
            {summary.map((item) => (
              <div className="audit-summary-item" key={item.label}>
                <span>{item.icon}</span>
                <div>
                  <strong className={item.tone}>{item.value}</strong>
                  <small>{item.label}</small>
                </div>
              </div>
            ))}
          </Card>

          <Card className="audit-toolbar-card">
            <label className="audit-search-field">
              <Search size={16} />
              <input aria-label="Search logs" onChange={(event) => setQuery(event.target.value)} placeholder="Search logs" value={query} />
            </label>

            <div className="audit-filter-row" aria-label="Audit filters">
              <Filter size={16} />
              <select aria-label="Filter by event" value={eventType} onChange={(event) => setEventType(event.target.value as EventFilter)}>
                {eventFilters.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <select aria-label="Filter by exchange" value={exchange} onChange={(event) => setExchange(event.target.value)}>
                <option value="all">All Exchanges</option>
                {exchangeOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <select aria-label="Filter by bot" value={bot} onChange={(event) => setBot(event.target.value)}>
                <option value="all">All Bots</option>
                {botOptions.map((item) => (
                  <option key={item} value={item}>
                    {botLabel(item)}
                  </option>
                ))}
              </select>
              <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
                {statusFilters.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <strong>{exportStatus}</strong>
            </div>
          </Card>

          <div className="audit-logs-grid">
            <Card className="audit-table-card">
              <div className="audit-table">
                <div className="audit-table__head">
                  <span>Date / Time</span>
                  <span>Event</span>
                  <span>Actor</span>
                  <span>Exchange</span>
                  <span>Pair</span>
                  <span>Action</span>
                  <span>Status</span>
                  <span>IP</span>
                  <span>Details</span>
                </div>

                {filteredLogs.length > 0 ? (
                  filteredLogs.map((log) => (
                    <button className={cn('audit-row', selectedLog?.id === log.id && 'is-selected')} key={log.id} onClick={() => setSelectedLogId(log.id)} type="button">
                      <span>{formatAuditTime(log.time)}</span>
                      <span>{titleCase(log.eventType)}</span>
                      <span>{titleCase(log.actor)}</span>
                      <span>{log.exchange ?? '-'}</span>
                      <span>{log.symbol ?? '-'}</span>
                      <strong>{log.action}</strong>
                      <span>
                        <Badge tone={statusTone(log.status)}>{log.status}</Badge>
                      </span>
                      <span>{log.ipAddress}</span>
                      <span>{log.details}</span>
                    </button>
                  ))
                ) : (
                  <div className="audit-empty-row">No logs match.</div>
                )}
              </div>
            </Card>

            {selectedLog ? <AuditDetailCard log={selectedLog} /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function AuditDetailCard({ log }: { log: AuditEvent }) {
  return (
    <Card className="audit-detail-card">
      <div className="audit-card-head">
        <div>
          <h2>Log Detail</h2>
          <span>{log.id}</span>
        </div>
        <Badge tone={statusTone(log.status)}>{log.status}</Badge>
      </div>

      <div className="audit-detail-list">
        <DetailLine label="Time" value={formatAuditTime(log.time)} />
        <DetailLine label="Event Type" value={titleCase(log.eventType)} />
        <DetailLine label="Actor" value={titleCase(log.actor)} />
        <DetailLine label="Exchange" value={log.exchange ?? '-'} />
        <DetailLine label="Pair" value={log.symbol ?? '-'} />
        <DetailLine label="Bot" value={log.botId ? botLabel(log.botId) : '-'} />
        <DetailLine label="IP Address" value={log.ipAddress} />
      </div>

      <div className="audit-detail-body">
        <strong>{log.action}</strong>
        <p>{log.details}</p>
      </div>

      <Link className="audit-source-link" href={sourceHref(log)}>
        Open Source
        <ExternalLink size={14} />
      </Link>
    </Card>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildSummary(logs: AuditEvent[]) {
  const blocked = logs.filter((log) => log.status === 'blocked').length;
  const failed = logs.filter((log) => log.status === 'failed').length;
  const warnings = logs.filter((log) => log.status === 'warning').length;

  return [
    { icon: <ShieldCheck size={18} />, label: 'Events', value: String(logs.length) },
    { icon: <ShieldCheck size={18} />, label: 'Blocked', tone: 'negative', value: String(blocked) },
    { icon: <ShieldCheck size={18} />, label: 'Failed', tone: 'negative', value: String(failed) },
    { icon: <ShieldCheck size={18} />, label: 'Warnings', tone: 'warning', value: String(warnings) },
  ];
}

function sourceHref(log: AuditEvent) {
  switch (log.eventType) {
    case 'api':
      return '/exchanges';
    case 'risk':
      return '/preferences/risk-rules';
    case 'bot':
      return log.botId ? `/bots/${log.botId}` : '/bots';
    case 'strategy':
      return '/strategies';
    case 'order':
      return '/orders';
    case 'system':
      return '/preferences/security';
  }
}

function statusTone(status: AuditEvent['status']) {
  switch (status) {
    case 'success':
      return 'positive';
    case 'blocked':
    case 'failed':
      return 'negative';
    case 'warning':
      return 'warning';
  }
}

function sortByTime(first: AuditEvent, second: AuditEvent) {
  return new Date(second.time).getTime() - new Date(first.time).getTime();
}

function formatAuditTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(value));
}

function titleCase(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function botLabel(botId: string) {
  return botId
    .replace('bot-', '')
    .split('-')
    .map(titleCase)
    .join(' ');
}
