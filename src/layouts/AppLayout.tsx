'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, PanelLeftClose, PanelLeftOpen, Settings, UserCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { BudStateStrip } from '../components/bud/BudStateStrip';
import { Button, IconButton, Modal, ThemeToggle } from '../components/ui';
import { appNavigation } from '../config/navigation';
import { apiJson, postJson } from '../services/api-client';
import { cn } from '../utils/classNames';

type AppLayoutProps = {
  children: ReactNode;
};

type BudStatusPayload = {
  capabilities?: {
    live_trading_enabled?: boolean;
  };
  health?: {
    status?: string;
  };
  status?: string;
};

export function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [topbarStatus, setTopbarStatus] = useState('Backend verification');
  const [budStatus, setBudStatus] = useState<BudStatusPayload | null>(null);

  useEffect(() => {
    let ignore = false;

    apiJson<BudStatusPayload>('/api/bud/status')
      .then((status) => {
        if (!ignore) {
          setBudStatus(status);
          setTopbarStatus(status.status === 'online' ? 'Bud backend online' : 'Bud backend unavailable');
        }
      })
      .catch((error) => {
        if (!ignore) {
          setTopbarStatus(error instanceof Error ? error.message : 'Bud backend unavailable');
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  async function confirmEmergencyStop() {
    try {
      await postJson('/api/bud/kill-switch', {
        action: 'trigger',
        detail: 'manual Thoon topbar emergency stop',
        reason: 'manual',
      });
      setTopbarStatus('Kill switch triggered. Trading locked.');
    } catch (error) {
      setTopbarStatus(error instanceof Error ? error.message : 'Kill switch failed');
    } finally {
      setEmergencyOpen(false);
    }
  }

  const backendOnline = budStatus?.status === 'online' || budStatus?.health?.status === 'ok';
  const liveEnabled = Boolean(budStatus?.capabilities?.live_trading_enabled);

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

        <div className="topbar-agent" aria-label="Backend connection">
          <span>Backend</span>
          <strong>
            <i aria-hidden="true" />
            {backendOnline ? 'Bud online' : 'Bud offline'}
          </strong>
        </div>

        <div className="topbar-mode-switch" aria-label="Execution mode">
          <button className="is-active" type="button">Paper locked</button>
        </div>

        <div className="topbar-equity" aria-label="Live readiness">
          <span>Live</span>
          <strong>{liveEnabled ? 'Enabled' : 'Blocked'}</strong>
        </div>

        <div className="topbar-actions">
          <span className="sr-only" aria-live="polite">{topbarStatus}</span>
          <Button icon={<AlertTriangle size={16} />} onClick={() => setEmergencyOpen(true)} size="sm" variant="danger">
            Arret d'urgence
          </Button>
          <ThemeToggle />
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

        <div className="sidebar-telemetry" aria-label="Backend status">
          <span>
            <i aria-hidden="true" />
            Backend
          </span>
          <strong>{backendOnline ? 'backend online' : 'backend check'}</strong>
        </div>
        <span className="sidebar-version">v0.1.0</span>
      </aside>

      <main className="app-main">
        <BudStateStrip />
        {children}
      </main>

      <Modal onClose={() => setEmergencyOpen(false)} open={emergencyOpen} title="Emergency Stop">
        <div className="confirmation-modal-body">
          <p>This triggers the Bud kill switch and blocks trading execution.</p>
          <div>
            <Button onClick={() => setEmergencyOpen(false)} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button onClick={() => void confirmEmergencyStop()} size="sm" variant="danger">
              Stop Trading
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
