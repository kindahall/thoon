'use client';

import { Bell, Link2, Mail, Pencil, Play, ScrollText, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button, Card, EmptyState, HelpPopover } from '../components/ui';
import { useBinanceLiveMarkets } from '../hooks/useBinanceLiveMarkets';
import { deleteJson, patchJson, postJson } from '../services/api-client';
import type { MarketPair } from '../types/market';
import type { Alert } from '../types/trading';
import { formatUsd } from '../utils/format';

type AlertsPageProps = {
  alerts: Alert[];
  marketPairs: MarketPair[];
  pair?: string;
};

const alertTabs = ['All Alerts', 'Price', 'Zone', 'Indicator', 'Strategy', 'Bot'] as const;
type AlertTab = (typeof alertTabs)[number];

export function AlertsPage({ alerts: baseAlertRecords, marketPairs, pair }: AlertsPageProps) {
  const { pairs: liveMarketPairs } = useBinanceLiveMarkets(marketPairs);
  const [alertRecords, setAlertRecords] = useState(baseAlertRecords);
  const [activeTab, setActiveTab] = useState<AlertTab>('All Alerts');
  const [trigger, setTrigger] = useState<Alert['trigger']>('once');
  const [channel, setChannel] = useState<Alert['channel']>('app');
  const [selectedPair, setSelectedPair] = useState(pair ?? marketPairs[0]?.symbol ?? 'BTC/USDT');
  const [alertType, setAlertType] = useState<Alert['type']>('price');
  const [condition, setCondition] = useState('crosses above');
  const [alertValue, setAlertValue] = useState('');
  const [createStatus, setCreateStatus] = useState('Ready');
  const pairs = liveMarketPairs;
  const defaultPair = selectedPair;
  const alerts = alertRecords.filter((alert) => {
    const matchesPair = pair ? alert.symbol === pair : true;
    const matchesTab = activeTab === 'All Alerts' || alert.type === alertTypeFromTab(activeTab);

    return matchesPair && matchesTab;
  });
  const activeAlerts = alerts.filter((alert) => alert.status !== 'triggered');
  const triggeredAlerts = alerts.filter((alert) => alert.status === 'triggered');
  const defaultPairPrice = pairs.find((marketPair) => marketPair.symbol === defaultPair)?.lastPrice ?? 0;
  const draftAlertValue = alertValue || String(Math.round(defaultPairPrice * 1.01));

  async function createAlert() {
    const draft = {
      channel,
      condition,
      symbol: defaultPair,
      trigger,
      type: alertType,
      value: draftAlertValue,
    };

    setCreateStatus('Saving');

    try {
      const alert = await postJson<Alert>('/api/alerts', draft);
      setAlertRecords((currentAlerts) => [alert, ...currentAlerts]);
      setCreateStatus('Saved');
    } catch (error) {
      setCreateStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  async function toggleAlert(alert: Alert) {
    const status = alert.status === 'paused' ? 'active' : 'paused';

    try {
      const updatedAlert = await patchJson<Alert>(`/api/alerts/${encodeURIComponent(alert.id)}`, { status });
      setAlertRecords((currentAlerts) => currentAlerts.map((item) => (item.id === alert.id ? updatedAlert : item)));
      setCreateStatus(status === 'active' ? 'Alert active' : 'Alert paused');
    } catch (error) {
      setCreateStatus(error instanceof Error ? error.message : 'Update failed');
    }
  }

  async function deleteAlert(alert: Alert) {
    try {
      await deleteJson(`/api/alerts/${encodeURIComponent(alert.id)}`);
      setAlertRecords((currentAlerts) => currentAlerts.filter((item) => item.id !== alert.id));
      setCreateStatus('Deleted');
    } catch (error) {
      setCreateStatus(error instanceof Error ? error.message : 'Delete failed');
    }
  }

  return (
    <section className="alerts-page" aria-label="Alerts workspace">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Alerts</h1>
          <p>Create, manage and monitor your trading alerts.</p>
        </div>
        <div className="workspace-header__right">
          <Link className="ui-button ui-button--ghost ui-button--sm" href="/preferences/audit-logs?event=system">
            <span className="ui-button__icon">
              <ScrollText size={15} />
            </span>
            Alert Log
          </Link>
          <HelpPopover items={['Alerts can open Charts with the selected pair.', 'Webhook alerts stay visible but inactive until configured.']} title="Alerts" />
        </div>
      </div>

      <div className="alerts-tabs" aria-label="Alert tabs">
        {alertTabs.map((tab) => (
          <button className={activeTab === tab ? 'is-active' : undefined} key={tab} onClick={() => setActiveTab(tab)} type="button">
            {tab}
          </button>
        ))}
      </div>

      <Card className="alert-create-card">
        <h2>Create New Alert</h2>
        <span className="sr-only" aria-live="polite">{createStatus}</span>
        <div className="alert-form-grid">
          <label className="alert-field">
            <span>Market</span>
            <select value={selectedPair} onChange={(event) => setSelectedPair(event.target.value)}>
              {pairs.map((marketPair) => (
                <option key={marketPair.symbol} value={marketPair.symbol}>
                  {marketPair.symbol}
                </option>
              ))}
            </select>
            <small>{pairs.find((marketPair) => marketPair.symbol === defaultPair)?.name ?? 'Market'}</small>
          </label>
          <label className="alert-field">
            <span>Alert Type</span>
            <select value={alertType} onChange={(event) => setAlertType(event.target.value as Alert['type'])}>
              <option value="price">Price</option>
              <option value="zone">Zone</option>
              <option value="indicator">Indicator</option>
              <option value="strategy">Strategy</option>
              <option value="bot">Bot</option>
              <option value="webhook">Webhook</option>
            </select>
            <small>Trigger source</small>
          </label>
          <label className="alert-field">
            <span>Condition</span>
            <select value={condition} onChange={(event) => setCondition(event.target.value)}>
              <option value="crosses above">Price Above</option>
              <option value="crosses below">Price Below</option>
              <option value="enters zone">Enters Zone</option>
              <option value="signal fired">Signal Fired</option>
            </select>
            <small>Trigger rule</small>
          </label>
          <label className="alert-field">
            <span>Price</span>
            <input aria-label="Alert price" onChange={(event) => setAlertValue(event.target.value)} placeholder={formatUsd(defaultPairPrice)} value={alertValue} />
            <small>USDT</small>
          </label>
          <div className="alert-trigger-control">
            <span>Trigger</span>
            <div>
              <button className={trigger === 'once' ? 'is-active' : undefined} onClick={() => setTrigger('once')} type="button">
                Once
              </button>
              <button className={trigger === 'repeat' ? 'is-active' : undefined} onClick={() => setTrigger('repeat')} type="button">Repeat</button>
            </div>
          </div>
          <div className="alert-notify-control">
            <span>Notify</span>
            <div>
              <button className={channel === 'app' ? 'is-active' : undefined} onClick={() => setChannel('app')} type="button">
                App
              </button>
              <button className={channel === 'webhook' ? 'is-active' : undefined} onClick={() => setChannel('webhook')} type="button">
                Webhook
              </button>
            </div>
          </div>
          <Button className="alert-create-button" onClick={createAlert} variant="primary">
            Create Alert
          </Button>
        </div>
      </Card>

      <Card className="alerts-table-card">
        <div className="market-section-header">
          <h2>Active Alerts</h2>
          <span className="orders-count">{activeAlerts.length}</span>
        </div>
        <div className="alerts-table alerts-table--active">
          <div className="alerts-table__header">
            <span>Status</span>
            <span>Symbol</span>
            <span>Condition</span>
            <span>Trigger</span>
            <span>Notify</span>
            <span>Last</span>
            <span>Actions</span>
          </div>
          {activeAlerts.length > 0 ? (
            activeAlerts.map((alert) => <ActiveAlertRow alert={alert} key={alert.id} onDelete={deleteAlert} onToggle={toggleAlert} />)
          ) : (
            <EmptyState
              actionLabel="Create Alert"
              description="Set a price, zone or strategy trigger."
              icon={<Bell size={20} />}
              secondaryActionHref={`/charts?pair=${encodeURIComponent(defaultPair)}`}
              secondaryActionLabel="Open Chart"
              title="No alerts"
            />
          )}
        </div>
      </Card>

      <Card className="alerts-table-card">
        <div className="market-section-header">
          <h2>Triggered Alerts</h2>
          <span className="orders-count">{triggeredAlerts.length}</span>
        </div>
        <div className="alerts-table alerts-table--triggered">
          <div className="alerts-table__header">
            <span>Status</span>
            <span>Symbol</span>
            <span>Condition</span>
            <span>Value</span>
            <span>Triggered</span>
            <span>Notify</span>
            <span>Actions</span>
          </div>
          {triggeredAlerts.length > 0 ? (
            triggeredAlerts.map((alert) => <TriggeredAlertRow alert={alert} key={alert.id} onDelete={deleteAlert} />)
          ) : (
            <EmptyState
              actionLabel="Create Alert"
              description="Triggered alerts will appear here."
              icon={<Bell size={20} />}
              secondaryActionHref="/watchlist"
              secondaryActionLabel="Watchlist"
              title="No triggered alerts"
            />
          )}
        </div>
      </Card>
    </section>
  );
}

function ActiveAlertRow({ alert, onDelete, onToggle }: { alert: Alert; onDelete: (alert: Alert) => void; onToggle: (alert: Alert) => void }) {
  return (
    <div className="alerts-table__row">
      <span className={alert.status === 'active' ? 'alert-status alert-status--active' : 'alert-status'}>{alert.status}</span>
      <Link href={`/charts?pair=${encodeURIComponent(alert.symbol)}`}>{alert.symbol}</Link>
      <span>{formatAlertCondition(alert)}</span>
      <span>{alert.trigger}</span>
      <NotifyIcons channel={alert.channel} />
      <span>{alert.lastTriggeredAt ? formatAlertDate(alert.lastTriggeredAt) : '-'}</span>
      <span className="alert-row-actions">
        <button aria-label={`Toggle ${alert.symbol}`} className={alert.status === 'active' ? 'is-on' : undefined} onClick={() => onToggle(alert)} type="button" />
        <Link aria-label={`Edit ${alert.symbol}`} href={`/alerts?pair=${encodeURIComponent(alert.symbol)}`}>
          <Pencil size={15} />
        </Link>
        <button aria-label={`Delete ${alert.symbol}`} onClick={() => onDelete(alert)} type="button">
          <Trash2 size={15} />
        </button>
      </span>
    </div>
  );
}

function TriggeredAlertRow({ alert, onDelete }: { alert: Alert; onDelete: (alert: Alert) => void }) {
  return (
    <div className="alerts-table__row">
      <span className="alert-status alert-status--triggered">triggered</span>
      <Link href={`/charts?pair=${encodeURIComponent(alert.symbol)}`}>{alert.symbol}</Link>
      <span>{formatAlertCondition(alert)}</span>
      <span>{alert.value}</span>
      <span>{alert.triggeredAt ? formatAlertDate(alert.triggeredAt) : '-'}</span>
      <NotifyIcons channel={alert.channel} />
      <span className="alert-row-actions">
        <Link aria-label={`Replay ${alert.symbol}`} href={`/charts?pair=${encodeURIComponent(alert.symbol)}`}>
          <Play size={15} />
        </Link>
        <button aria-label={`Delete ${alert.symbol}`} onClick={() => onDelete(alert)} type="button">
          <Trash2 size={15} />
        </button>
      </span>
    </div>
  );
}

function NotifyIcons({ channel }: { channel: Alert['channel'] }) {
  return (
    <span className="alert-notify-icons">
      <Bell className={channel === 'app' ? 'is-active' : undefined} size={15} />
      <Mail className={channel === 'email' ? 'is-active' : undefined} size={15} />
      <Link2 className={channel === 'webhook' ? 'is-active' : undefined} size={15} />
    </span>
  );
}

function formatAlertCondition(alert: Alert) {
  return `${alert.type} · ${alert.condition} ${alert.value}`;
}

function alertTypeFromTab(tab: AlertTab): Alert['type'] {
  switch (tab) {
    case 'Price':
      return 'price';
    case 'Zone':
      return 'zone';
    case 'Indicator':
      return 'indicator';
    case 'Strategy':
      return 'strategy';
    case 'Bot':
      return 'bot';
    case 'All Alerts':
      return 'price';
  }
}

function formatAlertDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
