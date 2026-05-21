'use client';

import {
  ChartNoAxesCombined,
  CheckCircle2,
  ChevronRight,
  Database,
  KeyRound,
  Shield,
  User,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type CSSProperties } from 'react';

import { Card } from '../components/ui';
import type { ApiKeyRecord, ExchangeConnection, RiskRules, UserPreferences, UserProfile } from '../types/trading';

type PreferenceGroupId = 'account' | 'trading' | 'security' | 'privacy';

type PreferenceGroup = {
  accent: string;
  href: string;
  icon: LucideIcon;
  id: PreferenceGroupId;
  label: string;
  rows: PreferenceSelectorRow[];
};

type PreferenceSelectorRow = {
  href: string;
  label: string;
  tone?: 'positive' | 'warning' | 'neutral';
  value: string;
};

type PreferencesPageProps = {
  apiKeys: ApiKeyRecord[];
  exchanges: ExchangeConnection[];
  preferences: UserPreferences;
  profile: UserProfile;
  riskRules: RiskRules;
};

export function PreferencesPage({ apiKeys, exchanges, preferences, profile, riskRules }: PreferencesPageProps) {
  const groups = useMemo(() => buildPreferenceGroups({ apiKeys, exchanges, preferences, profile, riskRules }), [apiKeys, exchanges, preferences, profile, riskRules]);
  const [selectedGroupId, setSelectedGroupId] = useState<PreferenceGroupId>('account');
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0];
  const SelectedIcon = selectedGroup.icon;
  const activeKeys = apiKeys.filter((key) => key.status === 'active').length;

  return (
    <section className="preferences-page preferences-hub" aria-label="Preferences workspace">
      <div className="preferences-hub-header">
        <div>
          <p className="workspace-kicker">Workspace settings</p>
          <h1>Preferences</h1>
        </div>
        <div className="preferences-hub-status" aria-label="Workspace status">
          <span className="is-cyan">Private</span>
          <span className="is-green">Paper</span>
          <span className="is-violet">Secure</span>
        </div>
      </div>

      <div className="preferences-layout preferences-hub-layout">
        <div className="preferences-hub-selector" aria-label="Preferences categories" role="tablist">
          {groups.map((group) => {
            const Icon = group.icon;
            const selected = group.id === selectedGroup.id;

            return (
              <button
                aria-selected={selected}
                className={selected ? 'is-active' : undefined}
                key={group.id}
                onClick={() => setSelectedGroupId(group.id)}
                role="tab"
                style={{ '--preference-section-accent': group.accent } as CSSProperties}
                type="button"
              >
                <Icon size={16} />
                <span>{group.label}</span>
              </button>
            );
          })}
        </div>

        <div className="preferences-hub-grid">
          <Card className="preferences-control-panel" style={{ '--preference-section-accent': selectedGroup.accent } as CSSProperties}>
            <div className="preferences-control-panel__head">
              <span>
                <SelectedIcon size={18} />
              </span>
              <div>
                <h2>{selectedGroup.label}</h2>
                <small>{selectedGroup.rows.length} selectors</small>
              </div>
              <Link href={selectedGroup.href}>
                Open
                <ChevronRight size={15} />
              </Link>
            </div>

            <div className="preferences-selector-list">
              {selectedGroup.rows.map((row) => (
                <Link className="preferences-selector-row" href={row.href} key={`${selectedGroup.id}-${row.label}`}>
                  <span>{row.label}</span>
                  <strong className={row.tone}>{row.value}</strong>
                  <ChevronRight size={14} />
                </Link>
              ))}
            </div>
          </Card>

          <Card className="preferences-snapshot-panel">
            <div className="preferences-mini-profile">
              <span className="preferences-avatar preferences-avatar--sm">{profile.name.slice(0, 1).toUpperCase()}</span>
              <div>
                <h2>{profile.name}</h2>
                <span>@{profile.username}</span>
              </div>
              <Link href="/preferences/profile">Profile</Link>
            </div>

            <div className="preferences-snapshot-grid" aria-label="Workspace snapshot">
              <SnapshotChip icon={Shield} label="Live" tone={riskRules.confirmLiveOrders ? 'green' : 'amber'} value={riskRules.confirmLiveOrders ? 'Guarded' : 'Manual'} />
              <SnapshotChip icon={KeyRound} label="Keys" tone={activeKeys ? 'green' : 'neutral'} value={String(activeKeys)} />
              <SnapshotChip icon={Shield} label="Risk" tone={riskRules.blockOrdersWithoutStop ? 'green' : 'amber'} value={riskRules.blockOrdersWithoutStop ? 'Strict' : 'Manual'} />
              <SnapshotChip icon={Database} label="Data" tone="violet" value={preferences.density === 'compact' ? 'Compact' : titleCase(preferences.density)} />
            </div>

            <div className="preferences-quick-links">
              <Link href="/preferences/security">
                <CheckCircle2 size={15} />
                Security
              </Link>
              <Link href="/exchanges">
                <KeyRound size={15} />
                Exchanges
              </Link>
              <Link href="/preferences/data-privacy">
                <Database size={15} />
                Privacy
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}

function SnapshotChip({ icon: Icon, label, tone, value }: { icon: LucideIcon; label: string; tone: 'amber' | 'cyan' | 'green' | 'neutral' | 'violet'; value: string }) {
  return (
    <div className={`preferences-snapshot-chip is-${tone}`}>
      <Icon size={15} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildPreferenceGroups({ apiKeys, exchanges, preferences, profile, riskRules }: PreferencesPageProps): PreferenceGroup[] {
  const activeKeys = apiKeys.filter((key) => key.status === 'active').length;
  const connectedExchanges = exchanges.filter((exchange) => exchange.status === 'connected').length;

  return [
    {
      accent: '#8b7cff',
      href: '/preferences/profile',
      icon: User,
      id: 'account',
      label: 'Account',
      rows: [
        { href: '/preferences/profile', label: 'Identity', value: profile.name },
        { href: '/preferences/profile', label: 'Country', value: profile.country },
        { href: '/preferences/profile', label: 'Timezone', value: shortTimezone(profile.timezone) },
        { href: '/preferences/appearance', label: 'Theme', value: titleCase(preferences.theme) },
      ],
    },
    {
      accent: '#62e6a8',
      href: '/preferences/trading-defaults',
      icon: ChartNoAxesCombined,
      id: 'trading',
      label: 'Trading',
      rows: [
        { href: '/preferences/trading-defaults', label: 'Risk', value: `${preferences.defaultRiskPerTrade.toFixed(2)}%` },
        { href: '/preferences/trading-defaults', label: 'Leverage', value: `${preferences.defaultLeverage}x` },
        { href: '/preferences/trading-defaults', label: 'Order', value: titleCase(preferences.orderType) },
        { href: '/preferences/risk-rules', label: 'Kill switch', tone: riskRules.emergencyKillSwitch ? 'warning' : 'neutral', value: riskRules.emergencyKillSwitch ? 'On' : 'Off' },
      ],
    },
    {
      accent: '#ffd45a',
      href: '/preferences/security',
      icon: Shield,
      id: 'security',
      label: 'Security',
      rows: [
        { href: '/preferences/security', label: 'API keys', tone: activeKeys ? 'positive' : 'neutral', value: `${activeKeys} active` },
        { href: '/preferences/security', label: 'Live confirm', tone: riskRules.confirmLiveOrders ? 'positive' : 'warning', value: riskRules.confirmLiveOrders ? 'Enabled' : 'Manual' },
        { href: '/exchanges', label: 'Venues', tone: connectedExchanges ? 'positive' : 'neutral', value: String(connectedExchanges) },
        { href: '/preferences/audit-logs', label: 'Audit', value: 'Open' },
      ],
    },
    {
      accent: '#64f4d2',
      href: '/preferences/data-privacy',
      icon: Database,
      id: 'privacy',
      label: 'Privacy',
      rows: [
        { href: '/preferences/data-privacy', label: 'Export', value: 'Ready' },
        { href: '/preferences/data-privacy', label: 'Delete', tone: 'warning', value: 'Guarded' },
        { href: '/preferences/audit-logs', label: 'Audit', value: 'Open' },
        { href: '/preferences/security', label: 'Secrets', tone: activeKeys ? 'positive' : 'neutral', value: activeKeys ? 'Stored' : 'None' },
      ],
    },
  ];
}

function shortTimezone(value: string) {
  return value.length > 13 ? `${value.slice(0, 12)}...` : value;
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1).replace(/[-_]/g, ' ');
}
