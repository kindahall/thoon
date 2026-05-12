import {
  Bell,
  Bot,
  ChartNoAxesCombined,
  ChevronRight,
  CreditCard,
  Database,
  Keyboard,
  LayoutGrid,
  ListChecks,
  Palette,
  PlugZap,
  ScrollText,
  Shield,
  User,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';

import { Card, HelpPopover } from '../components/ui';
import type { Alert, ApiKeyRecord, ExchangeConnection, RiskRules, UserPreferences, UserProfile } from '../types/trading';

const preferenceSections = [
  { href: '/preferences/agent', icon: Bot, label: 'Strategy Agent' },
  { href: '/preferences/profile', icon: User, label: 'Profile' },
  { href: '/preferences/appearance', icon: Palette, label: 'Appearance' },
  { href: '/preferences/trading-defaults', icon: ChartNoAxesCombined, label: 'Trading Defaults' },
  { href: '/preferences/security', icon: Shield, label: 'Security' },
  { href: '/preferences/notifications', icon: Bell, label: 'Notifications' },
  { href: '/preferences/billing', icon: CreditCard, label: 'Billing & Plan' },
  { href: '/preferences/data-privacy', icon: Database, label: 'Data & Privacy' },
  { href: '/preferences/risk-rules', icon: Shield, label: 'Risk Rules' },
  { href: '/preferences/trade-limits', icon: ListChecks, label: 'Trade Limits' },
  { href: '/preferences/audit-logs', icon: ScrollText, label: 'Audit Logs' },
  { href: '/preferences/layouts', icon: LayoutGrid, label: 'Layouts' },
  { href: '/preferences/keyboard-shortcuts', icon: Keyboard, label: 'Keyboard Shortcuts' },
  { href: '/preferences/advanced', icon: Wrench, label: 'Advanced' },
];

type SummaryCard = {
  href: string;
  icon: LucideIcon;
  rows: Array<{ label: string; tone?: 'positive'; value: string }>;
  title: string;
};

type PreferencesPageProps = {
  alerts: Alert[];
  apiKeys: ApiKeyRecord[];
  exchanges: ExchangeConnection[];
  preferences: UserPreferences;
  profile: UserProfile;
  riskRules: RiskRules;
};

export function PreferencesPage({ alerts, apiKeys, exchanges, preferences, profile, riskRules }: PreferencesPageProps) {
  const cards = buildSummaryCards({ alerts, apiKeys, exchanges, preferences, riskRules });
  const activeBillingPlan = preferences.billingSettings?.planId ? titleCase(preferences.billingSettings.planId) : 'Private';

  return (
    <section className="preferences-page" aria-label="Preferences workspace">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Preferences</h1>
          <p>Manage profile, trading defaults, security and API access.</p>
        </div>
        <HelpPopover items={['Use sections for detailed settings.', 'Critical changes require confirmation.']} title="Preferences" />
      </div>

      <div className="preferences-layout">
        <Card className="preferences-sidebar">
          <h2>Preferences</h2>
          <nav aria-label="Preferences navigation">
            {preferenceSections.map((section) => {
              const Icon = section.icon;

              return (
                <Link href={section.href} key={section.href}>
                  <Icon size={17} />
                  <span>{section.label}</span>
                </Link>
              );
            })}
          </nav>
        </Card>

        <div className="preferences-overview">
          <Card className="preferences-profile-card">
            <span className="preferences-avatar">{profile.name.slice(0, 1).toUpperCase()}</span>
            <div className="preferences-profile-main">
              <h2>{profile.name}</h2>
              <span>@{profile.username}</span>
              <b>{titleCase(profile.tradingExperience)} Trader</b>
            </div>
            <dl>
              <div>
                <dt>Email</dt>
                <dd>{profile.email}</dd>
              </div>
              <div>
                <dt>Country</dt>
                <dd>{profile.country}</dd>
              </div>
              <div>
                <dt>Timezone</dt>
                <dd>{profile.timezone}</dd>
              </div>
              <div>
                <dt>Plan</dt>
                <dd>{activeBillingPlan}</dd>
              </div>
            </dl>
            <Link href="/preferences/billing">Manage Plan</Link>
          </Card>

          <div className="preferences-summary">
            {cards.map((card) => (
              <PreferenceOverviewCard card={card} key={card.href} />
            ))}
          </div>

          <Card className="preferences-data-card">
            <div className="preferences-summary-card__head">
              <Database size={18} />
              <h2>Data & Privacy</h2>
            </div>
            <div className="preferences-data-actions">
              <div>
                <strong>Export My Data</strong>
                <span>Download your account data and activity.</span>
              </div>
              <Link href="/preferences/data-privacy">Export Data</Link>
              <div>
                <strong>Delete Account</strong>
                <span>Permanently delete your account and all data.</span>
              </div>
              <Link className="is-danger" href="/preferences/data-privacy">Delete Account</Link>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}

function buildSummaryCards({
  alerts,
  apiKeys,
  exchanges,
  preferences,
  riskRules,
}: Pick<PreferencesPageProps, 'alerts' | 'apiKeys' | 'exchanges' | 'preferences' | 'riskRules'>): SummaryCard[] {
  const activeAlerts = alerts.filter((alert) => alert.status === 'active').length;
  const activeKeys = apiKeys.filter((key) => key.status === 'active').length;
  const connectedExchanges = exchanges.filter((exchange) => exchange.status === 'connected').length;
  const notificationSettings = preferences.notificationSettings as Record<string, boolean> | undefined;

  return [
    {
      href: '/preferences/agent',
      icon: Bot,
      rows: [
        { label: 'Mode', value: 'Codex' },
        { label: 'Live actions', value: riskRules.confirmLiveOrders ? 'Confirmed' : 'Manual' },
        { label: 'Core strategy', tone: 'positive', value: 'Protected' },
      ],
      title: 'Strategy Agent',
    },
    {
      href: '/preferences/appearance',
      icon: Palette,
      rows: [
        { label: 'Theme', value: titleCase(preferences.theme) },
        { label: 'Density', value: titleCase(preferences.density) },
      ],
      title: 'Appearance',
    },
    {
      href: '/preferences/trading-defaults',
      icon: ChartNoAxesCombined,
      rows: [
        { label: 'Default Risk', value: `${preferences.defaultRiskPerTrade.toFixed(2)}%` },
        { label: 'Default Leverage', value: `${preferences.defaultLeverage}x` },
        { label: 'Default Order Type', value: titleCase(preferences.orderType) },
        { label: 'Default Slippage', value: `${preferences.defaultSlippage.toFixed(2)}%` },
      ],
      title: 'Trading Defaults',
    },
    {
      href: '/preferences/security',
      icon: Shield,
      rows: [
        { label: 'Live confirmation', tone: riskRules.confirmLiveOrders ? 'positive' : undefined, value: riskRules.confirmLiveOrders ? 'Enabled' : 'Manual' },
        { label: 'API keys', tone: activeKeys ? 'positive' : undefined, value: `${activeKeys} active` },
        { label: 'Kill switch', value: riskRules.emergencyKillSwitch ? 'On' : 'Off' },
      ],
      title: 'Security',
    },
    {
      href: '/preferences/notifications',
      icon: Bell,
      rows: [
        { label: 'Active alerts', tone: activeAlerts ? 'positive' : undefined, value: String(activeAlerts) },
        { label: 'App notifications', tone: notificationSettings?.app !== false ? 'positive' : undefined, value: notificationSettings?.app === false ? 'Off' : 'Enabled' },
        { label: 'Webhook alerts', tone: notificationSettings?.webhook !== false ? 'positive' : undefined, value: notificationSettings?.webhook === false ? 'Off' : 'Enabled' },
      ],
      title: 'Notifications',
    },
    {
      href: '/exchanges',
      icon: PlugZap,
      rows: [
        { label: 'Connected venues', tone: connectedExchanges ? 'positive' : undefined, value: String(connectedExchanges) },
        { label: 'API Keys', value: `${apiKeys.length} stored` },
        { label: 'Withdrawals', tone: 'positive', value: 'Disabled' },
      ],
      title: 'Exchange Hub',
    },
    {
      href: '/preferences/billing',
      icon: CreditCard,
      rows: [
        { label: 'Current Plan', value: titleCase(preferences.billingSettings?.planId ?? 'private') },
        { label: 'Period', value: titleCase(preferences.billingSettings?.billingPeriod ?? 'yearly') },
        { label: 'Status', tone: preferences.billingSettings?.status === 'active' ? 'positive' : undefined, value: titleCase(preferences.billingSettings?.status ?? 'active') },
      ],
      title: 'Billing & Plan',
    },
  ];
}

function PreferenceOverviewCard({ card }: { card: SummaryCard }) {
  const Icon = card.icon;

  return (
    <Link className="preferences-summary-card" href={card.href}>
      <Card>
        <div className="preferences-summary-card__head">
          <Icon size={18} />
          <h2>{card.title}</h2>
        </div>
        <div className="preferences-summary-card__rows">
          {card.rows.map((row) => (
            <div key={`${card.href}-${row.label}`}>
              <span>{row.label}</span>
              <strong className={row.tone}>{row.value}</strong>
              <ChevronRight size={14} />
            </div>
          ))}
        </div>
      </Card>
    </Link>
  );
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1).replace(/[-_]/g, ' ');
}
