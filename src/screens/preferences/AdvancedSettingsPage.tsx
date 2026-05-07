'use client';

import { AlertTriangle, Download, FlaskConical, RotateCcw, Settings2, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';

import { PreferencesSectionNav } from '../../components/preferences/PreferencesSectionNav';
import { Badge, Button, Card, HelpPopover, Modal, Toggle } from '../../components/ui';
import { apiJson, patchJson, postJson } from '../../services/api-client';
import { cn } from '../../utils/classNames';

type RefreshInterval = '5s' | '15s' | '30s' | '60s';
type MaxCandles = '500' | '1000' | '2500' | '5000';
type RetryCount = '1' | '2' | '3' | '5';
type RetryBackoff = 'linear' | 'exponential';
type ReconnectDelay = '1s' | '3s' | '5s' | '10s';

type AdvancedToggleKey =
  | 'apiTrace'
  | 'botSandbox'
  | 'debugMode'
  | 'developerMode'
  | 'gpuCandles'
  | 'localCache'
  | 'perfOverlay'
  | 'replayBeta'
  | 'smartMarkers'
  | 'socketReconnect';

const initialToggles: Record<AdvancedToggleKey, boolean> = {
  apiTrace: false,
  botSandbox: true,
  debugMode: false,
  developerMode: false,
  gpuCandles: true,
  localCache: true,
  perfOverlay: false,
  replayBeta: false,
  smartMarkers: false,
  socketReconnect: true,
};

export function AdvancedSettingsPage() {
  const [toggles, setToggles] = useState(initialToggles);
  const [refreshInterval, setRefreshInterval] = useState<RefreshInterval>('15s');
  const [maxCandles, setMaxCandles] = useState<MaxCandles>('2500');
  const [retryCount, setRetryCount] = useState<RetryCount>('3');
  const [retryBackoff, setRetryBackoff] = useState<RetryBackoff>('exponential');
  const [reconnectDelay, setReconnectDelay] = useState<ReconnectDelay>('3s');
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [status, setStatus] = useState('Ready');

  const activeExperiments = useMemo(() => Number(toggles.replayBeta) + Number(toggles.smartMarkers) + Number(toggles.botSandbox), [toggles]);

  function toggleSetting(key: AdvancedToggleKey) {
    setToggles((current) => ({ ...current, [key]: !current[key] }));
    setStatus('Updated');
  }

  async function clearCache() {
    setStatus('Clearing');

    try {
      await postJson('/api/system/cache/clear');
      setStatus('Cache cleared');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Clear failed');
    }
  }

  async function exportConfig() {
    setStatus('Exporting');

    try {
      const [preferences, health] = await Promise.all([apiJson('/api/preferences'), apiJson('/api/health')]);
      const blob = new Blob([JSON.stringify({ advanced: buildAdvancedPayload(), exportedAt: new Date().toISOString(), health, preferences }, null, 2)], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = href;
      link.download = `thoon-config-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(href);
      setStatus('Config exported');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Export failed');
    }
  }

  async function importConfig() {
    setStatus('Saving config');

    try {
      await patchJson('/api/preferences', { advancedSettings: buildAdvancedPayload() });
      setStatus('Config synced');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Import failed');
    }
  }

  async function confirmReset() {
    setToggles(initialToggles);
    setRefreshInterval('15s');
    setMaxCandles('2500');
    setRetryCount('3');
    setRetryBackoff('exponential');
    setReconnectDelay('3s');
    setResetModalOpen(false);
    setStatus('Resetting');

    try {
      await postJson('/api/system/reset-local-data');
      setStatus('Local data reset');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Reset failed');
    }
  }

  function buildAdvancedPayload() {
    return {
      maxCandles,
      reconnectDelay,
      refreshInterval,
      retryBackoff,
      retryCount,
      toggles,
    };
  }

  return (
    <section className="advanced-settings-page" aria-label="Advanced settings">
      <div className="workspace-header workspace-header--compact">
        <div>
          <p className="workspace-kicker">Preferences</p>
          <h1>Advanced</h1>
        </div>
        <div className="workspace-header__right">
            <Button icon={<Download size={15} />} onClick={() => void exportConfig()} size="sm" variant="ghost">
            Export Config
          </Button>
          <Button icon={<Upload size={15} />} onClick={() => void importConfig()} size="sm" variant="ghost">
            Import Config
          </Button>
          <HelpPopover
            items={[
              'Advanced settings affect local app behavior only.',
              'Trading defaults stay on their dedicated page.',
              'Destructive actions require confirmation.',
            ]}
            title="Advanced"
          />
        </div>
      </div>

      <div className="preferences-layout">
        <PreferencesSectionNav active="advanced" />

        <div className="advanced-settings-workspace">
          <Card className="advanced-summary-card">
            <AdvancedMetric label="Status" value={status} />
            <AdvancedMetric label="Refresh" value={refreshInterval} />
            <AdvancedMetric label="Debug" tone={toggles.debugMode ? 'warning' : 'positive'} value={toggles.debugMode ? 'On' : 'Off'} />
            <AdvancedMetric label="Experiments" value={String(activeExperiments)} />
          </Card>

          <div className="advanced-settings-grid">
            <Card className="advanced-card">
              <div className="advanced-card-head">
                <h2>Developer</h2>
                <Settings2 size={17} />
              </div>
              <div className="advanced-toggle-list">
                <Toggle checked={toggles.developerMode} label="Developer mode" onClick={() => toggleSetting('developerMode')} />
                <Toggle checked={toggles.debugMode} label="Debug mode" onClick={() => toggleSetting('debugMode')} />
                <Toggle checked={toggles.perfOverlay} label="Performance overlay" onClick={() => toggleSetting('perfOverlay')} />
                <Toggle checked={toggles.apiTrace} label="API trace logs" onClick={() => toggleSetting('apiTrace')} />
              </div>
            </Card>

            <Card className="advanced-card">
              <div className="advanced-card-head">
                <h2>Refresh</h2>
                <Badge tone="primary">{refreshInterval}</Badge>
              </div>
              <label className="advanced-select-control">
                <span>Data refresh</span>
                <select value={refreshInterval} onChange={(event) => setRefreshInterval(event.target.value as RefreshInterval)}>
                  <option value="5s">5s</option>
                  <option value="15s">15s</option>
                  <option value="30s">30s</option>
                  <option value="60s">60s</option>
                </select>
              </label>
              <label className="advanced-select-control">
                <span>Max candles</span>
                <select value={maxCandles} onChange={(event) => setMaxCandles(event.target.value as MaxCandles)}>
                  <option value="500">500</option>
                  <option value="1000">1000</option>
                  <option value="2500">2500</option>
                  <option value="5000">5000</option>
                </select>
              </label>
              <Toggle checked={toggles.gpuCandles} label="Chart performance" onClick={() => toggleSetting('gpuCandles')} />
            </Card>

            <Card className="advanced-card">
              <div className="advanced-card-head">
                <h2>Cache</h2>
                <Badge tone={toggles.localCache ? 'positive' : 'neutral'}>{toggles.localCache ? 'On' : 'Off'}</Badge>
              </div>
              <Toggle checked={toggles.localCache} label="Local cache" onClick={() => toggleSetting('localCache')} />
              <div className="advanced-control-row">
                <span>Market cache</span>
                <Button onClick={() => void clearCache()} size="sm" variant="ghost">
                  Clear Cache
                </Button>
              </div>
              <div className="advanced-control-row">
                <span>App config</span>
                <div className="advanced-inline-actions">
                  <button aria-label="Export app config" onClick={() => void exportConfig()} title="Export" type="button">
                    <Download size={14} />
                  </button>
                  <button aria-label="Import app config" onClick={() => void importConfig()} title="Import" type="button">
                    <Upload size={14} />
                  </button>
                </div>
              </div>
            </Card>

            <Card className="advanced-card">
              <div className="advanced-card-head">
                <h2>Experimental</h2>
                <FlaskConical size={17} />
              </div>
              <div className="advanced-toggle-list">
                <Toggle checked={toggles.replayBeta} label="Replay beta" onClick={() => toggleSetting('replayBeta')} />
                <Toggle checked={toggles.smartMarkers} label="Smart markers" onClick={() => toggleSetting('smartMarkers')} />
                <Toggle checked={toggles.botSandbox} label="Bot sandbox" onClick={() => toggleSetting('botSandbox')} />
              </div>
            </Card>

            <Card className="advanced-card">
              <div className="advanced-card-head">
                <h2>API Retry</h2>
                <Badge tone="neutral">{retryCount} tries</Badge>
              </div>
              <label className="advanced-select-control">
                <span>Retry count</span>
                <select value={retryCount} onChange={(event) => setRetryCount(event.target.value as RetryCount)}>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="5">5</option>
                </select>
              </label>
              <label className="advanced-select-control">
                <span>Backoff</span>
                <select value={retryBackoff} onChange={(event) => setRetryBackoff(event.target.value as RetryBackoff)}>
                  <option value="linear">Linear</option>
                  <option value="exponential">Exponential</option>
                </select>
              </label>
            </Card>

            <Card className="advanced-card">
              <div className="advanced-card-head">
                <h2>WebSocket</h2>
                <Badge tone={toggles.socketReconnect ? 'positive' : 'warning'}>{toggles.socketReconnect ? 'Auto' : 'Manual'}</Badge>
              </div>
              <Toggle checked={toggles.socketReconnect} label="Auto reconnect" onClick={() => toggleSetting('socketReconnect')} />
              <label className="advanced-select-control">
                <span>Reconnect delay</span>
                <select value={reconnectDelay} onChange={(event) => setReconnectDelay(event.target.value as ReconnectDelay)}>
                  <option value="1s">1s</option>
                  <option value="3s">3s</option>
                  <option value="5s">5s</option>
                  <option value="10s">10s</option>
                </select>
              </label>
            </Card>
          </div>

          <Card className="advanced-danger-card">
            <div>
              <AlertTriangle size={18} />
              <div>
                <h2>Local Data Reset</h2>
                <span>Preferences, cached markets and local drafts.</span>
              </div>
            </div>
            <Button icon={<RotateCcw size={15} />} onClick={() => setResetModalOpen(true)} size="sm" variant="danger">
              Reset Local Data
            </Button>
          </Card>
        </div>
      </div>

      <Modal onClose={() => setResetModalOpen(false)} open={resetModalOpen} title="Confirm Reset">
        <div className="advanced-reset-modal">
          <AlertTriangle size={20} />
          <p>Reset local Thoon settings, cached market data and local drafts?</p>
          <div>
            <Button onClick={() => setResetModalOpen(false)} variant="ghost">
              Cancel
            </Button>
            <Button icon={<RotateCcw size={15} />} onClick={() => void confirmReset()} variant="danger">
              Reset Local Data
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function AdvancedMetric({ label, tone, value }: { label: string; tone?: 'positive' | 'warning'; value: string }) {
  return (
    <div className={cn('advanced-metric', tone && `is-${tone}`)}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
