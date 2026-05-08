'use client';

import type { ReactNode } from 'react';
import { Activity, AlertTriangle, Bell, PanelLeftClose, PanelLeftOpen, PlugZap, Settings, UserCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button, IconButton, Modal, ThemeToggle } from '../components/ui';
import { appNavigation } from '../config/navigation';
import { apiJson, patchJson } from '../services/api-client';
import type { AgentSettings } from '../types/trading';
import { cn } from '../utils/classNames';

type AppLayoutProps = {
  children: ReactNode;
};

export function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [executionMode, setExecutionMode] = useState<'paper' | 'live'>('paper');
  const [liveModeOpen, setLiveModeOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [topbarStatus, setTopbarStatus] = useState('Paper trading ready');
  const [agentSettings, setAgentSettings] = useState<AgentSettings | null>(null);
  const [agentStatusLoading, setAgentStatusLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    apiJson<AgentSettings>('/api/agent/settings')
      .then((settings) => {
        if (!ignore) {
          setAgentSettings(settings);
          setTopbarStatus(settings.enabled ? `Strategy Agent ${formatAgentMode(settings.mode)} actif` : 'Strategy Agent suspendu');
        }
      })
      .catch((error) => {
        if (!ignore) {
          setTopbarStatus(error instanceof Error ? error.message : 'Strategy Agent indisponible');
        }
      })
      .finally(() => {
        if (!ignore) {
          setAgentStatusLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  function confirmLiveMode() {
    setExecutionMode('live');
    setTopbarStatus('Live mode armed after confirmation');
    setLiveModeOpen(false);
  }

  function confirmEmergencyStop() {
    setExecutionMode('paper');
    setTopbarStatus('Emergency stop sent. Trading locked to paper.');
    setEmergencyOpen(false);
  }

  async function toggleAgentAutonomy() {
    if (!agentSettings || agentStatusLoading) {
      return;
    }

    const nextSettings = { ...agentSettings, enabled: !agentSettings.enabled };
    setAgentSettings(nextSettings);
    setAgentStatusLoading(true);
    setTopbarStatus(nextSettings.enabled ? 'Activation Strategy Agent' : 'Suspension Strategy Agent');

    try {
      const savedSettings = await patchJson<AgentSettings>('/api/agent/settings', nextSettings);
      setAgentSettings(savedSettings);
      setTopbarStatus(savedSettings.enabled ? `Strategy Agent ${formatAgentMode(savedSettings.mode)} actif` : 'Strategy Agent suspendu');
    } catch (error) {
      setAgentSettings(agentSettings);
      setTopbarStatus(error instanceof Error ? error.message : 'Strategy Agent update failed');
    } finally {
      setAgentStatusLoading(false);
    }
  }

  const agentEnabled = Boolean(agentSettings?.enabled);
  const agentModeLabel = agentSettings ? formatAgentMode(agentSettings.mode) : 'verification';

  return (
    <div className={cn('app-shell app-shell--with-sidebar', sidebarCollapsed && 'app-shell--sidebar-collapsed')}>
      <header className="app-topbar">
        <IconButton
          aria-controls="app-sidebar"
          aria-expanded={!sidebarCollapsed}
          className="sidebar-toggle"
          icon={sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setSidebarCollapsed((current) => !current)}
        />

        <div className="topbar-agent" aria-label="Agent connection">
          <span>Agent connecte</span>
          <strong>
            <i aria-hidden="true" />
            Alpha-01
          </strong>
        </div>

        <div className="topbar-mode-switch" aria-label="Execution mode">
          <button
            className={executionMode === 'paper' ? 'is-active' : undefined}
            onClick={() => {
              setExecutionMode('paper');
              setTopbarStatus('Paper trading active');
            }}
            type="button"
          >
            Paper Trading
          </button>
          <button className={executionMode === 'live' ? 'is-active' : undefined} onClick={() => setLiveModeOpen(true)} type="button">
            Live
          </button>
        </div>

        <div className="topbar-equity" aria-label="Paper equity">
          <span>Equity paper</span>
          <strong>25,000.00 USDT</strong>
        </div>

        <div className="topbar-autonomy" aria-label="Autonomous mode">
          <span>Mode autonome</span>
          <button
            className={cn('topbar-autonomy-toggle', agentEnabled && 'is-active', agentStatusLoading && 'is-loading')}
            disabled={!agentSettings || agentStatusLoading}
            onClick={toggleAgentAutonomy}
            title={agentEnabled ? 'Suspendre le Strategy Agent' : 'Activer le Strategy Agent'}
            type="button"
          >
            <Activity size={15} />
            {agentEnabled ? agentModeLabel : agentStatusLoading ? 'Verification' : 'Suspendu'}
          </button>
        </div>

        <div className="topbar-actions">
          <span className="sr-only" aria-live="polite">{topbarStatus}</span>
          <Button
            className="topbar-websocket"
            icon={<PlugZap size={16} />}
            onClick={() => setTopbarStatus('Websocket actif. Flux marche verifie.')}
            size="sm"
            variant="ghost"
          >
            websocket
          </Button>
          <Button icon={<AlertTriangle size={16} />} onClick={() => setEmergencyOpen(true)} size="sm" variant="danger">
            Arret d'urgence
          </Button>
          <ThemeToggle />
          <Link aria-label="Alerts" className="ui-icon-button topbar-optional-action" href="/alerts" title="Alerts">
            <span className="sr-only">Alerts</span>
            <Bell size={18} />
          </Link>
          <Link aria-label="Settings" className="ui-icon-button topbar-optional-action" href="/preferences" title="Settings">
            <span className="sr-only">Settings</span>
            <Settings size={18} />
          </Link>
          <Link aria-label="Profile" className="ui-icon-button profile-button topbar-optional-action" href="/preferences/profile" title="Profile">
            <span className="sr-only">Profile</span>
            <UserCircle size={20} />
          </Link>
        </div>
      </header>

      <aside className="app-sidebar" aria-label="Main navigation" id="app-sidebar">
        <Link className="brand" href="/charts">
          <span className="brand__mark" aria-hidden="true">
            <img alt="" className="brand__mark-image" src="/thoon-mark.svg" />
          </span>
          <span className="brand__copy">
            <span className="brand__name">Thoon</span>
            <span className="brand__subtitle">Trading cockpit</span>
          </span>
        </Link>

        <nav className="sidebar-nav">
          {appNavigation.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== '/charts' && pathname.startsWith(`${item.href}/`));

            return (
              <Link className={cn('sidebar-nav__item', isActive && 'is-active')} href={item.href} key={item.href}>
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-telemetry" aria-label="Market stream status">
          <span>
            <i aria-hidden="true" />
            Flux marche
          </span>
          <strong>websocket actif</strong>
        </div>
        <span className="sidebar-version">v0.1.0</span>
      </aside>

      <main className="app-main">{children}</main>

      <Modal onClose={() => setLiveModeOpen(false)} open={liveModeOpen} title="Confirm Live Mode">
        <div className="confirmation-modal-body">
          <p>Live mode unlocks real execution flows. Risk checks and per-order confirmations stay required.</p>
          <div>
            <Button onClick={() => setLiveModeOpen(false)} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button onClick={confirmLiveMode} size="sm" variant="danger">
              Confirm
            </Button>
          </div>
        </div>
      </Modal>

      <Modal onClose={() => setEmergencyOpen(false)} open={emergencyOpen} title="Emergency Stop">
        <div className="confirmation-modal-body">
          <p>This locks execution back to paper mode and marks trading as stopped for this session.</p>
          <div>
            <Button onClick={() => setEmergencyOpen(false)} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button onClick={confirmEmergencyStop} size="sm" variant="danger">
              Stop Trading
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function formatAgentMode(mode: AgentSettings['mode']) {
  switch (mode) {
    case 'manual':
      return 'manuel';
    case 'assisted':
      return 'assiste';
    case 'limited_autonomous':
      return 'limite';
    case 'guarded_autonomous':
      return 'garde';
  }
}
