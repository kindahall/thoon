'use client';

import { CheckCircle2, KeyRound, LineChart, Link2, PlugZap, Plus, ShieldCheck, WalletCards } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { Badge, Button, Card, Modal } from '../components/ui';
import { apiJson, postJson } from '../services/api-client';
import type { ApiKeyRecord, ExchangeConnection, WalletConnection } from '../types/trading';

type ExchangeHubPageProps = {
  apiKeys: ApiKeyRecord[];
  exchanges: ExchangeConnection[];
  wallets: WalletConnection[];
};

type WalletModalMode = 'connect' | 'create';
type Permission = 'read' | 'trade';

type ApiKeyForm = {
  apiKey: string;
  exchangeId: string;
  keyName: string;
  passphrase: string;
  permissions: Permission[];
  secretKey: string;
};

type WalletForm = {
  address: string;
  chain: WalletConnection['chain'];
  exchangeId: string;
  label: string;
  network: string;
};

type BrowserWalletWindow = Window &
  typeof globalThis & {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
    keplr?: CosmosWalletProvider;
    leap?: CosmosWalletProvider;
    solana?: {
      connect: () => Promise<{ publicKey: { toString: () => string } }>;
      isPhantom?: boolean;
    };
  };

type CosmosWalletProvider = {
  enable: (chainId: string) => Promise<void>;
  getKey: (chainId: string) => Promise<{ bech32Address: string }>;
};

type DexConnectionGuide = {
  allowInternalVault?: boolean;
  chain: WalletConnection['chain'];
  defaultNetwork: string;
  docsHref: string;
  flow: string[];
  primaryAction: string;
  route: string;
  walletHint: string;
};

const emptyWalletForm: WalletForm = {
  address: '',
  chain: 'evm',
  exchangeId: 'hyperliquid',
  label: '',
  network: 'Base',
};

const emptyApiKeyForm: ApiKeyForm = {
  apiKey: '',
  exchangeId: 'binance',
  keyName: '',
  passphrase: '',
  permissions: ['read'],
  secretKey: '',
};

export function ExchangeHubPage({ apiKeys, exchanges, wallets }: ExchangeHubPageProps) {
  const [activeVenueType, setActiveVenueType] = useState<'cex' | 'dex'>('cex');
  const [apiKeyRecords, setApiKeyRecords] = useState(apiKeys);
  const [apiKeyForm, setApiKeyForm] = useState<ApiKeyForm>(emptyApiKeyForm);
  const [apiKeyStatus, setApiKeyStatus] = useState('Ready');
  const [walletRecords, setWalletRecords] = useState(wallets);
  const [walletModalMode, setWalletModalMode] = useState<WalletModalMode>('connect');
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [walletForm, setWalletForm] = useState<WalletForm>(emptyWalletForm);
  const [walletReadiness, setWalletReadiness] = useState<Record<string, unknown> | null>(null);
  const [walletStatus, setWalletStatus] = useState('Ready');
  const cexVenues = useMemo(() => exchanges.filter((exchange) => (exchange.venueType ?? 'cex') === 'cex'), [exchanges]);
  const dexVenues = useMemo(() => exchanges.filter((exchange) => exchange.venueType === 'dex'), [exchanges]);
  const visibleVenues = activeVenueType === 'cex' ? cexVenues : dexVenues;
  const activeApiKeys = apiKeyRecords.filter((key) => key.status === 'active');
  const connectedWallets = walletRecords.filter((wallet) => wallet.status === 'connected');
  const selectedCex = cexVenues.find((exchange) => exchange.id === apiKeyForm.exchangeId) ?? cexVenues[0];
  const selectedPreferredDex = dexVenues.find((exchange) => exchange.id === walletForm.exchangeId) ?? dexVenues[0];
  const selectedDexGuide = dexConnectionGuide(selectedPreferredDex);
  const liveReady = readPath(walletReadiness, ['liveReady']) === true;

  useEffect(() => {
    void refreshWalletReadiness();
  }, []);

  function focusApiExchange(exchange: ExchangeConnection) {
    setActiveVenueType('cex');
    setApiKeyForm((currentForm) => ({ ...currentForm, exchangeId: exchange.id }));
    setApiKeyStatus(exchange.name);
  }

  function updateApiKeyForm(update: Partial<ApiKeyForm>) {
    setApiKeyForm((currentForm) => ({ ...currentForm, ...update }));
  }

  function togglePermission(permission: Permission) {
    setApiKeyForm((currentForm) => {
      const permissions = currentForm.permissions.includes(permission)
        ? currentForm.permissions.filter((item) => item !== permission)
        : [...currentForm.permissions, permission];

      return { ...currentForm, permissions: permissions.length > 0 ? permissions : ['read'] };
    });
  }

  async function testConnection(exchangeId = apiKeyForm.exchangeId) {
    setApiKeyStatus('Testing');

    try {
      const result = await postJson<{ exchange: ExchangeConnection; ok: boolean }>('/api/exchanges/test', { exchangeId });
      if (result.ok) {
        setApiKeyRecords((currentKeys) => currentKeys.map((keyRecord) => (keyRecord.exchangeId === result.exchange.id && keyRecord.status === 'testing' ? { ...keyRecord, status: 'active' } : keyRecord)));
      }
      setApiKeyStatus(result.ok ? `${result.exchange.name} OK` : `${result.exchange.name} key`);
      void refreshWalletReadiness();
    } catch (error) {
      setApiKeyStatus(error instanceof Error ? error.message : 'Test failed');
    }
  }

  async function saveApiKey() {
    if (!apiKeyForm.keyName || !apiKeyForm.apiKey || !apiKeyForm.secretKey) {
      setApiKeyStatus('Missing fields');
      return;
    }

    setApiKeyStatus('Saving');

    try {
      const nextKey = await postJson<ApiKeyRecord>('/api/exchanges/api-keys', {
        apiKey: apiKeyForm.apiKey,
        apiSecret: apiKeyForm.secretKey,
        exchangeId: apiKeyForm.exchangeId,
        label: apiKeyForm.keyName,
        passphrase: apiKeyForm.passphrase,
        permissions: apiKeyForm.permissions,
      });

      setApiKeyRecords((currentKeys) => [nextKey, ...currentKeys]);
      setApiKeyForm({ ...emptyApiKeyForm, exchangeId: apiKeyForm.exchangeId });
      setApiKeyStatus('Saved');
      void refreshWalletReadiness();
    } catch (error) {
      setApiKeyStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  function openWalletModal(mode: WalletModalMode, exchange?: ExchangeConnection) {
    const guide = dexConnectionGuide(exchange);
    const internalNetwork = preferredInternalNetwork(exchange);

    setWalletModalMode(mode);
    setWalletForm((currentForm) => ({
      ...currentForm,
      chain: mode === 'create' ? 'evm' : guide.chain,
      exchangeId: exchange?.id ?? currentForm.exchangeId,
      label: mode === 'create' ? `${exchange?.name ?? 'Thoon'} vault` : currentForm.label || `${exchange?.name ?? guide.defaultNetwork} wallet`,
      network: mode === 'create' ? internalNetwork : guide.defaultNetwork,
    }));
    setWalletStatus('Ready');
    setWalletModalOpen(true);
  }

  function selectWalletExchange(exchangeId: string) {
    const exchange = dexVenues.find((item) => item.id === exchangeId);
    const guide = dexConnectionGuide(exchange);

    setWalletForm((currentForm) => ({
      ...currentForm,
      chain: walletModalMode === 'create' ? 'evm' : guide.chain,
      exchangeId,
      label: currentForm.label || `${exchange?.name ?? guide.defaultNetwork} wallet`,
      network: walletModalMode === 'create' ? preferredInternalNetwork(exchange) : guide.defaultNetwork,
    }));
  }

  function updateWalletForm(update: Partial<WalletForm>) {
    setWalletForm((currentForm) => ({ ...currentForm, ...update }));
  }

  async function connectInjectedWallet() {
    const exchange = dexVenues.find((item) => item.id === walletForm.exchangeId);
    const guide = dexConnectionGuide(exchange);
    const chain = walletModalMode === 'create' ? 'evm' : guide.chain;

    setWalletStatus('Opening decentralized wallet');

    try {
      const detected = await requestInjectedWallet(chain, guide.defaultNetwork);
      updateWalletForm({
        address: detected.address,
        chain: detected.chain,
        label: walletForm.label || detected.label,
        network: detected.network,
      });
      setWalletStatus(`${detected.label} ready. Confirm to save route.`);
    } catch (error) {
      setWalletStatus(error instanceof Error ? error.message : 'Wallet not detected');
    }
  }

  async function submitWallet() {
    setWalletStatus(walletModalMode === 'create' ? 'Creating encrypted wallet' : 'Connecting wallet');

    try {
      const record = await postJson<WalletConnection>('/api/wallets', {
        action: walletModalMode === 'create' ? 'create-wallet' : 'connect-wallet',
        address: walletForm.address,
        chain: walletForm.chain,
        confirmed: walletModalMode === 'create',
        exchangeId: walletForm.exchangeId,
        label: walletForm.label,
        network: walletForm.network,
      });

      setWalletRecords((currentRecords) => [record, ...currentRecords.filter((wallet) => wallet.id !== record.id)]);
      setWalletStatus(walletModalMode === 'create' ? 'Wallet created' : 'Wallet connected');
      setWalletModalOpen(false);
      setWalletForm({ ...emptyWalletForm, exchangeId: walletForm.exchangeId, network: walletForm.network });
      void refreshWalletReadiness();
    } catch (error) {
      setWalletStatus(error instanceof Error ? error.message : 'Wallet action failed');
    }
  }

  async function refreshWalletReadiness() {
    try {
      const [walletResponse, liveResponse] = await Promise.all([apiJson<Record<string, unknown>>('/api/wallets/readiness'), apiJson<Record<string, unknown>>('/api/live-connectors/readiness')]);
      setWalletReadiness({
        ...asRecord(readPath(walletResponse, ['payload'])),
        liveConnectors: asRecord(readPath(liveResponse, ['payload'])),
      });
    } catch (error) {
      setWalletStatus(error instanceof Error ? error.message : 'Wallet readiness unavailable');
    }
  }

  return (
    <section className="exchange-hub-page" aria-label="Exchange hub">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Exchange & API</h1>
        </div>
        <div className="workspace-header__right">
          <Badge tone={activeVenueType === 'dex' ? 'primary' : 'neutral'}>{dexVenues.length} DEX</Badge>
          <Badge tone={activeApiKeys.length ? 'positive' : 'warning'}>{activeApiKeys.length} API active</Badge>
          <Link className="ui-button ui-button--ghost ui-button--sm" href="/preferences/audit-logs?event=api">
            Audit logs
          </Link>
          <Button
            disabled={activeVenueType !== 'dex' && !supportsInternalWallet(selectedPreferredDex)}
            icon={activeVenueType === 'dex' ? <Link2 size={15} /> : <Plus size={15} />}
            onClick={() => openWalletModal(activeVenueType === 'dex' ? 'connect' : 'create', selectedPreferredDex)}
            size="sm"
            variant="primary"
          >
            {activeVenueType === 'dex' ? 'Connect wallet' : 'Creer wallet'}
          </Button>
        </div>
      </div>

      <div className="exchange-hub-summary">
        <ExchangeMetric icon={<KeyRound size={18} />} label="CEX" tone="cex" value={`${cexVenues.length}`} />
        <ExchangeMetric icon={<PlugZap size={18} />} label="DEX" tone="dex" value={`${dexVenues.length}`} />
        <ExchangeMetric icon={<WalletCards size={18} />} label="Wallets" tone="wallet" value={`${connectedWallets.length}`} />
        <ExchangeMetric icon={<ShieldCheck size={18} />} label="Live" tone="risk" value={liveReady ? 'Ready' : 'Blocked'} />
      </div>

      <div className="exchange-hub-layout">
        <div className="exchange-hub-main">
          <Card className="exchange-venue-card">
            <div className="exchange-venue-toolbar">
              <div>
                <h2>Execution Venues</h2>
              </div>
              <div className="venue-switch" aria-label="Venue type">
                <button className={activeVenueType === 'cex' ? 'is-active' : undefined} onClick={() => setActiveVenueType('cex')} type="button">
                  CEX
                </button>
                <button className={activeVenueType === 'dex' ? 'is-active' : undefined} onClick={() => setActiveVenueType('dex')} type="button">
                  DEX
                </button>
              </div>
            </div>

            <div className="exchange-venue-table exchange-venue-panel" key={activeVenueType}>
              <div className="exchange-venue-table__head">
                <span>Venue</span>
                <span>Networks</span>
                <span>Fees</span>
                <span>Status</span>
                <span>Actions</span>
              </div>
            {visibleVenues.map((exchange) => (
              <ExchangeVenueRow
                activeApiKeys={activeApiKeys}
                exchange={exchange}
                key={exchange.id}
                onManageApi={() => focusApiExchange(exchange)}
                onCreateWallet={() => openWalletModal('create', exchange)}
                onConnectWallet={() => openWalletModal('connect', exchange)}
              />
            ))}
            </div>
          </Card>
        </div>

        <aside className="exchange-wallet-panel" aria-label={activeVenueType === 'cex' ? 'API keys' : 'Wallets'}>
          {activeVenueType === 'cex' ? (
            <Card className="exchange-hub-api-card">
              <div className="wallet-control-head">
                <div>
                  <h2>API Keys</h2>
                </div>
                <Badge tone={activeApiKeys.length ? 'positive' : 'neutral'}>{activeApiKeys.length} on</Badge>
              </div>
              <div className="hub-api-form">
                <label>
                  <span>Exchange</span>
                  <select value={apiKeyForm.exchangeId} onChange={(event) => updateApiKeyForm({ exchangeId: event.target.value })}>
                    {cexVenues.map((exchange) => (
                      <option key={exchange.id} value={exchange.id}>
                        {exchange.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Name</span>
                  <input value={apiKeyForm.keyName} onChange={(event) => updateApiKeyForm({ keyName: event.target.value })} />
                </label>
                <label>
                  <span>API Key</span>
                  <input type="password" value={apiKeyForm.apiKey} onChange={(event) => updateApiKeyForm({ apiKey: event.target.value })} />
                </label>
                <label>
                  <span>Secret</span>
                  <input type="password" value={apiKeyForm.secretKey} onChange={(event) => updateApiKeyForm({ secretKey: event.target.value })} />
                </label>
                <label>
                  <span>Passphrase</span>
                  <input type="password" value={apiKeyForm.passphrase} onChange={(event) => updateApiKeyForm({ passphrase: event.target.value })} />
                </label>
              </div>
              <div className="permission-toggle-row" aria-label="Permissions">
                <button className={apiKeyForm.permissions.includes('read') ? 'is-active' : undefined} onClick={() => togglePermission('read')} type="button">
                  Read
                </button>
                <button className={apiKeyForm.permissions.includes('trade') ? 'is-active' : undefined} onClick={() => togglePermission('trade')} type="button">
                  Trade
                </button>
                <span>Withdraw off</span>
              </div>
              <div className="wallet-action-grid">
                <Button icon={<KeyRound size={15} />} onClick={saveApiKey} size="sm" variant="primary">
                  Save
                </Button>
                <Button icon={<PlugZap size={15} />} onClick={() => void testConnection(selectedCex?.id)} size="sm" variant="ghost">
                  Test
                </Button>
              </div>
              <span className="hub-api-status">{apiKeyStatus}</span>
              <div className="wallet-list">
                {apiKeyRecords.slice(0, 5).map((keyRecord) => (
                  <div className="wallet-row" key={keyRecord.id}>
                    <span>
                      <KeyRound size={16} />
                    </span>
                    <div>
                      <strong>{keyRecord.label}</strong>
                      <small>{exchangeName(cexVenues, keyRecord.exchangeId)} · {keyRecord.maskedKey}</small>
                    </div>
                    <Badge tone={keyRecord.status === 'active' ? 'positive' : keyRecord.status === 'testing' ? 'warning' : 'neutral'}>{keyRecord.status}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card className="wallet-control-card">
              <div className="wallet-control-head">
                <div>
                  <h2>Wallets</h2>
                </div>
                <Badge tone={connectedWallets.length ? 'positive' : 'neutral'}>{connectedWallets.length} on</Badge>
              </div>
              <div className="wallet-action-grid">
                <Button icon={<Link2 size={15} />} onClick={() => openWalletModal('connect', selectedPreferredDex)} size="sm" variant="secondary">
                  Connect
                </Button>
                <Button disabled={!supportsInternalWallet(selectedPreferredDex)} icon={<Plus size={15} />} onClick={() => openWalletModal('create', selectedPreferredDex)} size="sm" variant="ghost">
                  Vault
                </Button>
              </div>
              <div className="dex-connection-card">
                <div>
                  <strong>{selectedPreferredDex?.name ?? 'DEX'} route</strong>
                  <a href={selectedDexGuide.docsHref} rel="noreferrer" target="_blank">Docs</a>
                </div>
                <small>{selectedDexGuide.walletHint}</small>
                <ol>
                  {selectedDexGuide.flow.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
              <div className="wallet-list">
                {walletRecords.map((wallet) => (
                  <div className="wallet-row" key={wallet.id}>
                    <span>
                      <WalletCards size={16} />
                    </span>
                    <div>
                      <strong>{wallet.label}</strong>
                      <small>{wallet.address ? compactAddress(wallet.address) : wallet.networks.join(' / ') || wallet.chain}</small>
                    </div>
                    <Badge tone={wallet.status === 'connected' ? 'positive' : 'neutral'}>{wallet.status}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <WalletReadinessCard data={walletReadiness} onRefresh={() => void refreshWalletReadiness()} />
        </aside>
      </div>

      <Modal onClose={() => setWalletModalOpen(false)} open={walletModalOpen} title={walletModalMode === 'create' ? 'Create Wallet Vault' : 'Connect Wallet'}>
        <div className="wallet-modal-body">
          <div className="wallet-form-grid">
            <label>
              <span>Label</span>
              <input onChange={(event) => updateWalletForm({ label: event.target.value })} placeholder={walletModalMode === 'create' ? 'Trading vault' : 'Main wallet'} value={walletForm.label} />
            </label>
            <label>
              <span>Preferred DEX</span>
              <select onChange={(event) => selectWalletExchange(event.target.value)} value={walletForm.exchangeId}>
                {dexVenues.map((exchange) => (
                  <option key={exchange.id} value={exchange.id}>
                    {exchange.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Chain</span>
              <select disabled={walletModalMode === 'create'} onChange={(event) => updateWalletForm({ chain: event.target.value as WalletConnection['chain'] })} value={walletForm.chain}>
                <option value="evm">EVM</option>
                <option value="solana">Solana</option>
                <option value="cosmos">Cosmos</option>
                <option value="multi">Multi-chain</option>
              </select>
            </label>
            <label>
              <span>Network</span>
              <input onChange={(event) => updateWalletForm({ network: event.target.value })} value={walletForm.network} />
            </label>
            {walletModalMode === 'connect' ? (
              <label className="wallet-address-field">
                <span>Public address</span>
                <input onChange={(event) => updateWalletForm({ address: event.target.value })} placeholder={walletForm.chain === 'evm' ? '0x...' : 'Public wallet address'} value={walletForm.address} />
              </label>
            ) : null}
          </div>
          {walletModalMode === 'connect' ? (
            <div className="wallet-route-preview">
              <div>
                <strong>{selectedPreferredDex?.name ?? 'DEX'} decentralized route</strong>
                <a href={selectedDexGuide.docsHref} rel="noreferrer" target="_blank">Docs</a>
              </div>
              <small>{selectedDexGuide.route}</small>
              <Button icon={<Link2 size={15} />} onClick={() => void connectInjectedWallet()} size="sm" variant="secondary">
                {selectedDexGuide.primaryAction}
              </Button>
            </div>
          ) : null}
          <div className="wallet-modal-footer">
            <strong>{walletStatus}</strong>
            <Button onClick={() => setWalletModalOpen(false)} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button icon={walletModalMode === 'create' ? <Plus size={15} /> : <CheckCircle2 size={15} />} onClick={() => void submitWallet()} size="sm" variant="primary">
              {walletModalMode === 'create' ? 'Create wallet' : 'Connect'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function ExchangeMetric({ icon, label, tone, value }: { icon: ReactNode; label: string; tone: 'cex' | 'dex' | 'risk' | 'wallet'; value: string }) {
  return (
    <Card className={`exchange-metric-card exchange-metric-card--${tone}`}>
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </Card>
  );
}

function WalletReadinessCard({ data, onRefresh }: { data: Record<string, unknown> | null; onRefresh: () => void }) {
  const liveReady = readPath(data, ['liveReady']) === true;
  const venues = asArray(readPath(data, ['venues']));
  const liveConnectors = asRecord(readPath(data, ['liveConnectors']));
  const connectorVenues = asArray(readPath(liveConnectors, ['venues']));
  const summary = asRecord(readPath(data, ['summary']));
  const walletConnect = asRecord(readPath(data, ['walletConnect']));

  return (
    <Card className="wallet-readiness-card">
      <div className="wallet-control-head">
        <div>
          <h2>Live Route Checks</h2>
        </div>
        <Badge tone={liveReady ? 'positive' : 'warning'}>{liveReady ? 'ready' : 'blocked'}</Badge>
      </div>
      <div className="readiness-item">
        <ShieldCheck size={16} />
        <span>{formatReadinessValue(readPath(summary, ['readyVenues']))} / {formatReadinessValue(readPath(summary, ['targetVenues']))} venues</span>
        <Badge tone={liveReady ? 'positive' : 'warning'}>{liveReady ? 'pass' : 'gate'}</Badge>
      </div>
      <div className="readiness-item">
        <Link2 size={16} />
        <span>WalletConnect</span>
        <Badge tone={readPath(walletConnect, ['status']) === 'configured' ? 'positive' : 'warning'}>{formatReadinessValue(readPath(walletConnect, ['status']))}</Badge>
      </div>
      <div className="readiness-item">
        <KeyRound size={16} />
        <span>Server CEX</span>
        <Badge tone={Number(readPath(liveConnectors, ['summary', 'cexReady']) ?? 0) >= 3 ? 'positive' : 'warning'}>{formatReadinessValue(readPath(liveConnectors, ['summary', 'cexReady']))} / 3</Badge>
      </div>
      <div className="wallet-list">
        {[...connectorVenues.slice(0, 3), ...venues.slice(3, 5)].map((venue) => (
          <div className="wallet-row" key={String(readPath(venue, ['id']))}>
            <span>
              {readPath(venue, ['kind']) === 'dex-perp' || readPath(venue, ['venueType']) === 'dex' ? <WalletCards size={16} /> : <KeyRound size={16} />}
            </span>
            <div>
              <strong>{formatReadinessValue(readPath(venue, ['name']))}</strong>
              <small>{formatReadinessValue(readPath(venue, ['nextAction']) ?? readPath(venue, ['liveExecutionPath']))}</small>
            </div>
            <Badge tone={readPath(venue, ['ready']) === true ? 'positive' : 'warning'}>{formatReadinessValue(readPath(venue, ['status']))}</Badge>
          </div>
        ))}
      </div>
      <Button icon={<PlugZap size={15} />} onClick={onRefresh} size="sm" variant="ghost">
        Check routes
      </Button>
    </Card>
  );
}

function ExchangeVenueRow({ activeApiKeys, exchange, onConnectWallet, onCreateWallet, onManageApi }: { activeApiKeys: ApiKeyRecord[]; exchange: ExchangeConnection; onConnectWallet: () => void; onCreateWallet: () => void; onManageApi: () => void }) {
  const isDex = exchange.venueType === 'dex';
  const guide = dexConnectionGuide(exchange);
  const hasActiveKey = activeApiKeys.some((key) => key.exchangeId === exchange.id);
  const statusTone = exchange.status === 'connected' || hasActiveKey ? 'positive' : exchange.walletRequired ? 'warning' : 'neutral';

  return (
    <div className={`exchange-venue-row exchange-venue-row--${isDex ? 'dex' : 'cex'}`}>
      <div className="exchange-venue-name">
        <span className={`venue-icon venue-icon--${isDex ? 'dex' : 'cex'}`}>{isDex ? <WalletCards size={17} /> : <PlugZap size={17} />}</span>
        <div>
          <strong>{exchange.name}</strong>
          <small title={isDex ? guide.route : undefined}>{isDex ? guide.route : exchange.marketType ?? exchange.connectorType ?? 'api-key'}</small>
        </div>
      </div>
      <div className="exchange-network-pills">
        {(exchange.networks ?? ['Spot']).slice(0, 3).map((network) => (
          <em className={`network-pill network-pill--${networkTone(network)}`} key={network}>{network}</em>
        ))}
      </div>
      <span>{exchange.feeTier ?? 'Variable'}</span>
      <Badge tone={statusTone}>{hasActiveKey ? 'api active' : exchange.status}</Badge>
      <div className="exchange-row-actions">
        {isDex ? (
          <>
            <button className="exchange-row-action exchange-row-action--wallet" onClick={onConnectWallet} type="button">
              <WalletCards size={17} />
              <span>
                <strong>Wallet</strong>
                <small>Connect</small>
              </span>
            </button>
            <Link className="exchange-row-action exchange-row-action--chart" href={`/charts?exchange=${encodeURIComponent(exchange.id)}`}>
              <LineChart size={17} />
              <span>
                <strong>Chart</strong>
                <small>Open</small>
              </span>
            </Link>
            {supportsInternalWallet(exchange) ? (
              <button className="exchange-row-action exchange-row-action--vault" onClick={onCreateWallet} type="button">
                <Plus size={16} />
                <span>
                  <strong>Vault</strong>
                  <small>Create</small>
                </span>
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button className="exchange-row-action exchange-row-action--api" onClick={onManageApi} type="button">
              <KeyRound size={17} />
              <span>
                <strong>API</strong>
                <small>Keys</small>
              </span>
            </button>
            <Link className="exchange-row-action exchange-row-action--chart" href={`/charts?exchange=${encodeURIComponent(exchange.id)}`}>
              <LineChart size={17} />
              <span>
                <strong>Chart</strong>
                <small>Open</small>
              </span>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function compactAddress(address: string) {
  if (address.length <= 14) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readPath(value: unknown, path: string[]) {
  let current: unknown = value;

  for (const key of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function formatReadinessValue(value: unknown) {
  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }

  return typeof value === 'string' && value ? value : 'n/a';
}

function exchangeName(exchanges: ExchangeConnection[], exchangeId: string) {
  return exchanges.find((exchange) => exchange.id === exchangeId)?.name ?? exchangeId;
}

function networkTone(network: string) {
  const normalized = network.toLowerCase();

  if (normalized.includes('solana')) {
    return 'solana';
  }

  if (normalized.includes('base') || normalized.includes('hyper')) {
    return 'base';
  }

  if (normalized.includes('arbitrum') || normalized.includes('optimism')) {
    return 'l2';
  }

  if (normalized.includes('bnb')) {
    return 'bnb';
  }

  if (normalized.includes('cosmos') || normalized.includes('dydx')) {
    return 'cosmos';
  }

  if (normalized.includes('ethereum')) {
    return 'ethereum';
  }

  return 'default';
}

function supportsInternalWallet(exchange?: ExchangeConnection) {
  if (!exchange) {
    return true;
  }

  const guide = dexConnectionGuide(exchange);
  if (exchange.venueType === 'dex') {
    return Boolean(guide.allowInternalVault);
  }

  return (exchange.networks ?? []).some((network) => {
    const normalized = network.toLowerCase();

    return normalized.includes('evm') || ['base', 'arbitrum', 'optimism', 'polygon', 'ethereum', 'bnb chain', 'unichain'].includes(normalized);
  });
}

function preferredInternalNetwork(exchange?: ExchangeConnection) {
  return (
    exchange?.networks?.find((network) => {
      const normalized = network.toLowerCase();

      return normalized.includes('evm') || ['base', 'arbitrum', 'optimism', 'polygon', 'ethereum', 'bnb chain', 'unichain'].includes(normalized);
    }) ?? 'Base'
  );
}

function dexConnectionGuide(exchange?: ExchangeConnection): DexConnectionGuide {
  const id = exchange?.id ?? '';
  const guides: Record<string, DexConnectionGuide> = {
    '1inch': {
      allowInternalVault: true,
      chain: 'evm',
      defaultNetwork: 'Ethereum',
      docsHref: 'https://help.1inch.io/en/articles/5172922-how-to-use-walletconnect-with-the-1inch-wallet',
      flow: ['Connect EVM wallet or WalletConnect', 'Quote across supported DEX routes', 'Sign swap from wallet only'],
      primaryAction: 'Connect WalletConnect',
      route: 'EVM wallet -> 1inch aggregator',
      walletHint: 'MetaMask, Rabby, Coinbase Wallet, 1inch Wallet, Ledger or WalletConnect.',
    },
    aerodrome: {
      allowInternalVault: true,
      chain: 'evm',
      defaultNetwork: 'Base',
      docsHref: 'https://github.com/aerodrome-finance/docs',
      flow: ['Connect EVM wallet', 'Switch wallet to Base', 'Sign Aerodrome swap/liquidity action'],
      primaryAction: 'Connect Base wallet',
      route: 'Base wallet -> Aerodrome',
      walletHint: 'EVM wallet on Base: Coinbase Wallet, MetaMask, Rabby or WalletConnect.',
    },
    'cow-swap': {
      allowInternalVault: true,
      chain: 'evm',
      defaultNetwork: 'Ethereum',
      docsHref: 'https://cowswap.mintlify.app/cow-swap/tutorials/swap',
      flow: ['Connect EVM wallet', 'Build intent/order', 'Sign order for CoW batch auction'],
      primaryAction: 'Connect EVM wallet',
      route: 'EVM wallet -> CoW order signing',
      walletHint: 'EVM wallets and Safe-style smart wallets are part of the CoW flow.',
    },
    curve: {
      allowInternalVault: true,
      chain: 'evm',
      defaultNetwork: 'Ethereum',
      docsHref: 'https://docs.curve.finance/',
      flow: ['Connect EVM wallet', 'Pick pool/network', 'Sign swap or liquidity transaction'],
      primaryAction: 'Connect EVM wallet',
      route: 'EVM wallet -> Curve pools',
      walletHint: 'EVM wallet on the selected Curve network; stable pools need the wallet on that chain.',
    },
    dydx: {
      chain: 'cosmos',
      defaultNetwork: 'dYdX Chain',
      docsHref: 'https://help.dydx.trade/en/articles/166972-how-to-connect-your-wallet-and-start-trading-on-dydx-chain',
      flow: ['Connect Keplr or Leap', 'Enable dYdX Chain', 'Sign dYdX order messages from wallet'],
      primaryAction: 'Connect Cosmos wallet',
      route: 'Cosmos wallet -> dYdX Chain',
      walletHint: 'Use Keplr or Leap for dYdX Chain. This is not the same route as a generic EVM swap.',
    },
    hyperliquid: {
      chain: 'evm',
      defaultNetwork: 'HyperEVM',
      docsHref: 'https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/how-to-use-the-hyperevm',
      flow: ['Connect EVM wallet', 'Use HyperCore for perps or HyperEVM for EVM apps', 'Sign every account/action from wallet'],
      primaryAction: 'Connect Hyperliquid wallet',
      route: 'EVM wallet -> HyperCore/HyperEVM',
      walletHint: 'Hyperliquid starts from an EVM wallet, then routes differently for HyperCore perps and HyperEVM apps.',
    },
    'matcha-0x': {
      allowInternalVault: true,
      chain: 'evm',
      defaultNetwork: 'Base',
      docsHref: 'https://docs.0x.org/',
      flow: ['Connect EVM wallet', 'Fetch 0x/Matcha route', 'Sign approval/swap from wallet'],
      primaryAction: 'Connect EVM wallet',
      route: 'EVM wallet -> 0x route',
      walletHint: 'EVM wallet on the quote chain; 0x handles routing, the wallet signs approvals and swaps.',
    },
    orca: {
      chain: 'solana',
      defaultNetwork: 'Solana',
      docsHref: 'https://docs.orca.so/support/wallets',
      flow: ['Connect Solana wallet', 'Use Solana wallet standard', 'Sign Orca swap from wallet'],
      primaryAction: 'Connect Solana wallet',
      route: 'Solana wallet -> Orca',
      walletHint: 'Phantom, Backpack, Solflare and other Solana wallet-standard wallets.',
    },
    pancakeswap: {
      allowInternalVault: true,
      chain: 'evm',
      defaultNetwork: 'BNB Chain',
      docsHref: 'https://docs.pancakeswap.finance/welcome-to-pancakeswap/how-to-guides/get-started/connection-guide',
      flow: ['Connect wallet', 'Switch to the target network', 'Sign swap on PancakeSwap route'],
      primaryAction: 'Connect wallet',
      route: 'Wallet -> PancakeSwap network route',
      walletHint: 'Mostly EVM via MetaMask/Trust/Coinbase/WalletConnect; Solana routes need a Solana wallet.',
    },
    raydium: {
      chain: 'solana',
      defaultNetwork: 'Solana',
      docsHref: 'https://docs.raydium.io/raydium/getting-started/onboarding/wallets',
      flow: ['Connect Phantom/Solflare/Backpack', 'Stay on Solana', 'Sign Raydium swap from wallet'],
      primaryAction: 'Connect Solana wallet',
      route: 'Solana wallet -> Raydium',
      walletHint: 'Solana wallet only: Phantom, Solflare, Backpack or compatible WalletConnect route.',
    },
    uniswap: {
      allowInternalVault: true,
      chain: 'evm',
      defaultNetwork: 'Base',
      docsHref: 'https://support.uniswap.org/hc/en-us/articles/8121191796749-How-to-connect-a-wallet-to-Uniswap',
      flow: ['Connect EVM wallet or WalletConnect', 'Switch to selected Uniswap network', 'Sign swap/liquidity from wallet'],
      primaryAction: 'Connect EVM wallet',
      route: 'EVM wallet -> Uniswap',
      walletHint: 'MetaMask, Rabby, Coinbase Wallet, WalletConnect or any wallet supported by the Uniswap app.',
    },
    velodrome: {
      allowInternalVault: true,
      chain: 'evm',
      defaultNetwork: 'Optimism',
      docsHref: 'https://www.velodrome-finance.org/faq',
      flow: ['Connect EVM wallet', 'Switch wallet to Optimism', 'Sign Velodrome swap/liquidity action'],
      primaryAction: 'Connect Optimism wallet',
      route: 'Optimism wallet -> Velodrome',
      walletHint: 'EVM wallet configured on Optimism: MetaMask, Rabby, Coinbase Wallet or WalletConnect.',
    },
  };

  if (guides[id]) {
    return guides[id];
  }

  const networks = exchange?.networks ?? [];
  const lowerNetworks = networks.map((network) => network.toLowerCase());
  const chain: WalletConnection['chain'] = lowerNetworks.some((network) => network.includes('solana')) ? 'solana' : lowerNetworks.some((network) => network.includes('cosmos') || network.includes('dydx')) ? 'cosmos' : 'evm';

  return {
    allowInternalVault: chain === 'evm',
    chain,
    defaultNetwork: networks[0] ?? 'Base',
    docsHref: 'https://docs.walletconnect.network/index',
    flow: ['Connect compatible wallet', 'Switch to venue network', 'Sign transaction from wallet'],
    primaryAction: 'Connect wallet',
    route: `${chain.toUpperCase()} wallet -> DEX`,
    walletHint: 'Use the wallet family required by the selected network.',
  };
}

async function requestInjectedWallet(chain: WalletConnection['chain'], network: string): Promise<{ address: string; chain: WalletConnection['chain']; label: string; network: string }> {
  const browserWindow = window as BrowserWalletWindow;

  if (chain === 'evm' || chain === 'multi') {
    const ethereum = browserWindow.ethereum;

    if (!ethereum) {
      throw new Error('No EVM wallet detected. Install MetaMask, Rabby, Coinbase Wallet or use WalletConnect.');
    }

    const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    const address = Array.isArray(accounts) ? String(accounts[0] ?? '') : '';

    if (!address) {
      throw new Error('EVM wallet did not return an address.');
    }

    return { address, chain: 'evm', label: 'EVM wallet', network };
  }

  if (chain === 'solana') {
    const solana = browserWindow.solana;

    if (!solana) {
      throw new Error('No Solana wallet detected. Install Phantom, Backpack or Solflare.');
    }

    const result = await solana.connect();
    return { address: result.publicKey.toString(), chain, label: solana.isPhantom ? 'Phantom wallet' : 'Solana wallet', network: 'Solana' };
  }

  const provider = browserWindow.keplr ?? browserWindow.leap;

  if (!provider) {
    throw new Error('No Cosmos wallet detected. Install Keplr or Leap for dYdX Chain.');
  }

  const chainId = cosmosChainIdForNetwork(network);
  await provider.enable(chainId);
  const key = await provider.getKey(chainId);

  return { address: key.bech32Address, chain: 'cosmos', label: 'Cosmos wallet', network };
}

function cosmosChainIdForNetwork(network: string) {
  return network.toLowerCase().includes('dydx') ? 'dydx-mainnet-1' : network;
}
