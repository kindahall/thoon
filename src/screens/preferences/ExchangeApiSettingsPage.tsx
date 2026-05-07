'use client';

import { Activity, CheckCircle2, ExternalLink, KeyRound, PlugZap, Save, ShieldCheck, Timer, Trash2, Webhook, Wifi } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Badge, Button, Card, EmptyState, HelpPopover, Modal } from '../../components/ui';
import { deleteJson, postJson } from '../../services/api-client';
import type { ApiKeyRecord, AuditEvent, ExchangeConnection } from '../../types/trading';

type ExchangeApiSettingsPageProps = {
  apiKeys: ApiKeyRecord[];
  auditLogs: AuditEvent[];
  exchanges: ExchangeConnection[];
};

type Permission = 'read' | 'trade';

type ApiKeyForm = {
  apiKey: string;
  exchangeId: string;
  ipWhitelist: string;
  keyName: string;
  passphrase: string;
  permissions: Permission[];
  secretKey: string;
};

const emptyForm: ApiKeyForm = {
  apiKey: '',
  exchangeId: 'binance',
  ipWhitelist: '192.0.2.14',
  keyName: '',
  passphrase: '',
  permissions: ['read'],
  secretKey: '',
};

export function ExchangeApiSettingsPage({ apiKeys, auditLogs, exchanges }: ExchangeApiSettingsPageProps) {
  const [form, setForm] = useState<ApiKeyForm>(emptyForm);
  const [savedKeys, setSavedKeys] = useState<ApiKeyRecord[]>(apiKeys);
  const [exchangeRecords, setExchangeRecords] = useState(exchanges);
  const [testStatus, setTestStatus] = useState('Idle');
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRecord | null>(null);
  const selectedExchange = exchangeRecords.find((exchange) => exchange.id === form.exchangeId) ?? exchangeRecords[0];
  const activeKeys = savedKeys.filter((keyRecord) => keyRecord.status === 'active');
  const connectedExchanges = exchangeRecords.filter((exchange) => exchange.status === 'connected');
  const latestApiActivity = auditLogs.find((event) => event.eventType === 'api');
  const health = useMemo(
    () => [
      { icon: <Wifi size={18} />, label: 'Status', value: connectedExchanges.length > 0 ? 'Connected' : 'Sandbox' },
      { icon: <Timer size={18} />, label: 'Latency', value: '42 ms' },
      { icon: <ShieldCheck size={18} />, label: 'Connected', value: `${connectedExchanges.length}/${exchangeRecords.length}` },
      { icon: <Webhook size={18} />, label: 'Webhooks', value: 'Sandbox on' },
    ],
    [connectedExchanges.length, exchangeRecords.length],
  );

  function updateForm(update: Partial<ApiKeyForm>) {
    setForm((currentForm) => ({ ...currentForm, ...update }));
  }

  function togglePermission(permission: Permission) {
    setForm((currentForm) => {
      const permissions = currentForm.permissions.includes(permission)
        ? currentForm.permissions.filter((item) => item !== permission)
        : [...currentForm.permissions, permission];

      return { ...currentForm, permissions: permissions.length > 0 ? permissions : ['read'] };
    });
  }

  async function testConnection(exchangeId = selectedExchange.id) {
    setTestStatus('Testing');

    try {
      const result = await postJson<{ exchange: ExchangeConnection; ok: boolean }>('/api/exchanges/test', { exchangeId });
      setExchangeRecords((currentExchanges) => currentExchanges.map((exchange) => (exchange.id === result.exchange.id ? result.exchange : exchange)));
      setTestStatus(result.ok ? `${result.exchange.name} sandbox OK` : `${result.exchange.name} needs key`);
    } catch (error) {
      setTestStatus(error instanceof Error ? error.message : 'Test failed');
    }
  }

  async function saveKey() {
    if (!form.keyName || !form.apiKey || !form.secretKey) {
      setTestStatus('Missing fields');
      return;
    }

    setTestStatus('Saving');

    try {
      const nextKey = await postJson<ApiKeyRecord>('/api/exchanges/api-keys', {
        apiKey: form.apiKey,
        apiSecret: form.secretKey,
        exchangeId: selectedExchange.id,
        ipWhitelist: form.ipWhitelist
          .split(',')
          .map((ip) => ip.trim())
          .filter(Boolean),
        label: form.keyName,
        passphrase: form.passphrase,
        permissions: form.permissions,
      });

      setSavedKeys((currentKeys) => [nextKey, ...currentKeys]);
      setExchangeRecords((currentExchanges) =>
        currentExchanges.map((exchange) => (exchange.id === nextKey.exchangeId ? { ...exchange, permissions: nextKey.permissions, status: 'connected' } : exchange)),
      );
      setForm({ ...emptyForm, exchangeId: form.exchangeId, permissions: ['read'] });
      setTestStatus('Key saved encrypted');
    } catch (error) {
      setTestStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  async function revokeKey() {
    if (!revokeTarget) {
      return;
    }

    try {
      const disabledKey = await deleteJson<ApiKeyRecord>(`/api/exchanges/api-keys/${encodeURIComponent(revokeTarget.id)}`);
      setSavedKeys((currentKeys) => currentKeys.map((keyRecord) => (keyRecord.id === disabledKey.id ? disabledKey : keyRecord)));
      setRevokeTarget(null);
      setTestStatus('Key revoked');
    } catch (error) {
      setTestStatus(error instanceof Error ? error.message : 'Revoke failed');
    }
  }

  return (
    <section className="exchange-api-settings-page" aria-label="Exchange and API settings">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Exchange & API</h1>
          <p>Manage exchange connections, API keys and connection health.</p>
        </div>
        <div className="workspace-header__right">
          <Button icon={<Save size={15} />} onClick={saveKey} size="sm" variant="primary">
            Save Key
          </Button>
          <HelpPopover items={['Sandbox only until backend execution is ready.', 'Secrets are masked after saving.', 'Withdraw permissions are never enabled.']} title="Exchange & API" />
        </div>
      </div>

      <div className="preferences-layout">
        <PreferencesSectionNav active="exchange-api" />

        <div className="exchange-api-layout">
          <div className="security-head">
            <div>
              <h2>Connections</h2>
              <p>Exchange access, API keys and health checks.</p>
            </div>
          </div>

          <Card className="exchange-health-card">
            {health.map((item) => (
              <div className="exchange-health-item" key={item.label}>
                <span>{item.icon}</span>
                <div>
                  <strong>{item.value}</strong>
                  <small>{item.label}</small>
                </div>
              </div>
            ))}
          </Card>

          {connectedExchanges.length === 0 ? (
            <EmptyState
              actionLabel="Connect Exchange"
              description="Connect a read-only exchange before live routing."
              icon={<PlugZap size={20} />}
              secondaryActionLabel="Add API Key"
              title="No exchange connected"
            />
          ) : null}

          <div className="exchange-api-grid">
            <Card className="supported-exchanges-card">
              <div className="exchange-card-head">
                <h2>Supported Exchanges</h2>
                <Badge tone="positive">{connectedExchanges.length} on</Badge>
              </div>
              <div className="supported-exchange-list">
                {exchangeRecords.map((exchange) => (
                  <div className="supported-exchange-row" key={exchange.id}>
                    <span>
                      <PlugZap size={17} />
                    </span>
                    <div>
                      <strong>{exchange.name}</strong>
                      <small>{exchange.permissions.length > 0 ? exchange.permissions.join(' / ') : 'Available'}</small>
                    </div>
                    <Badge tone={exchange.status === 'connected' ? 'positive' : 'neutral'}>{exchange.status}</Badge>
                    <Button
                      onClick={() => {
                        updateForm({ exchangeId: exchange.id });
                        void testConnection(exchange.id);
                      }}
                      size="sm"
                      variant={exchange.status === 'connected' ? 'ghost' : 'secondary'}
                    >
                      {exchange.status === 'connected' ? 'Manage' : 'Connect'}
                    </Button>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="api-key-form-card">
              <div className="exchange-card-head">
                <h2>Add API Key</h2>
                <Badge tone="neutral">Sandbox</Badge>
              </div>
              <div className="api-key-form">
                <label>
                  <span>Exchange</span>
                  <select value={form.exchangeId} onChange={(event) => updateForm({ exchangeId: event.target.value })}>
                    {exchangeRecords.map((exchange) => (
                      <option key={exchange.id} value={exchange.id}>
                        {exchange.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Key Name</span>
                  <input value={form.keyName} onChange={(event) => updateForm({ keyName: event.target.value })} placeholder="Routing key" />
                </label>
                <label>
                  <span>API Key</span>
                  <input type="password" value={form.apiKey} onChange={(event) => updateForm({ apiKey: event.target.value })} />
                </label>
                <label>
                  <span>Secret Key</span>
                  <input type="password" value={form.secretKey} onChange={(event) => updateForm({ secretKey: event.target.value })} />
                </label>
                <label>
                  <span>Passphrase</span>
                  <input type="password" value={form.passphrase} onChange={(event) => updateForm({ passphrase: event.target.value })} />
                </label>
                <label>
                  <span>IP Whitelist</span>
                  <input value={form.ipWhitelist} onChange={(event) => updateForm({ ipWhitelist: event.target.value })} />
                </label>
              </div>

              <div className="permission-toggle-row" aria-label="Permissions">
                <button className={form.permissions.includes('read') ? 'is-active' : undefined} onClick={() => togglePermission('read')} type="button">
                  <CheckCircle2 size={14} />
                  Read
                </button>
                <button className={form.permissions.includes('trade') ? 'is-active' : undefined} onClick={() => togglePermission('trade')} type="button">
                  <KeyRound size={14} />
                  Trade
                </button>
                <span>Withdraw off</span>
              </div>

              <div className="api-key-form-actions">
                <Button icon={<Activity size={15} />} onClick={() => void testConnection()} size="sm" variant="ghost">
                  Test Connection
                </Button>
                <Button icon={<Save size={15} />} onClick={saveKey} size="sm" variant="primary">
                  Save Key
                </Button>
                <strong>{testStatus}</strong>
              </div>
            </Card>
          </div>

          <div className="exchange-api-grid exchange-api-grid--bottom">
            <Card className="api-keys-card">
              <div className="exchange-card-head">
                <h2>API Keys</h2>
                <Badge tone="positive">{activeKeys.length} active</Badge>
              </div>
              <div className="api-key-list">
                {savedKeys.map((keyRecord) => (
                  <div className="api-key-row" key={keyRecord.id}>
                    <span>
                      <KeyRound size={17} />
                    </span>
                    <div>
                      <strong>{keyRecord.label}</strong>
                      <small>
                        {exchangeName(exchangeRecords, keyRecord.exchangeId)} · {keyRecord.maskedKey}
                      </small>
                    </div>
                    <Badge tone={keyRecord.status === 'active' ? 'positive' : keyRecord.status === 'testing' ? 'warning' : 'neutral'}>{keyRecord.status}</Badge>
                    <Button icon={<Trash2 size={14} />} onClick={() => setRevokeTarget(keyRecord)} size="sm" variant="ghost">
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="connection-health-card">
              <div className="exchange-card-head">
                <h2>Connection Health</h2>
                <Badge tone="neutral">Local</Badge>
              </div>
              <div className="connection-health-grid">
                <HealthMetric label="Last check" value="May 5 · 09:02" />
                <HealthMetric label="Recent activity" value={latestApiActivity?.action ?? 'No activity'} />
                <HealthMetric label="Total connected" value={String(connectedExchanges.length)} />
                <HealthMetric label="Docs" value="API reference" />
              </div>
              <a className="api-docs-link" href="/preferences/security">
                <ExternalLink size={14} />
                API documentation
              </a>
              <Link className="api-docs-link" href="/preferences/audit-logs?event=api">
                <ExternalLink size={14} />
                Audit Logs
              </Link>
            </Card>
          </div>
        </div>
      </div>

      <Modal onClose={() => setRevokeTarget(null)} open={revokeTarget !== null} title="Revoke API Key">
        <div className="confirmation-modal-body">
          <p>{revokeTarget ? `${revokeTarget.label} will be disabled. Secrets remain hidden.` : 'Confirm revoke action.'}</p>
          <div>
            <Button size="sm" variant="ghost" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={revokeKey}>
              Revoke
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function HealthMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="health-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function exchangeName(exchanges: ExchangeConnection[], exchangeId: string) {
  return exchanges.find((exchange) => exchange.id === exchangeId)?.name ?? exchangeId;
}
