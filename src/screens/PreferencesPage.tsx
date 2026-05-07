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

const preferenceSections = [
  { href: '/preferences/agent', icon: Bot, label: 'Strategy Agent' },
  { href: '/preferences/profile', icon: User, label: 'Profile' },
  { href: '/preferences/appearance', icon: Palette, label: 'Appearance' },
  { href: '/preferences/trading-defaults', icon: ChartNoAxesCombined, label: 'Trading Defaults' },
  { href: '/preferences/security', icon: Shield, label: 'Security' },
  { href: '/preferences/notifications', icon: Bell, label: 'Notifications' },
  { href: '/preferences/exchange-api', icon: PlugZap, label: 'Exchange & API' },
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

const summaryCards: SummaryCard[] = [
  {
    href: '/preferences/agent',
    icon: Bot,
    rows: [
      { label: 'Mode', value: 'Assisted' },
      { label: 'Live actions', value: 'Blocked' },
      { label: 'Core strategy', tone: 'positive', value: 'Protected' },
    ],
    title: 'Strategy Agent',
  },
  {
    href: '/preferences/appearance',
    icon: Palette,
    rows: [
      { label: 'Theme', value: 'Dark' },
      { label: 'Density', value: 'Comfortable' },
    ],
    title: 'Appearance',
  },
  {
    href: '/preferences/trading-defaults',
    icon: ChartNoAxesCombined,
    rows: [
      { label: 'Default Risk', value: '1.00%' },
      { label: 'Default Leverage', value: '10x' },
      { label: 'Default Order Type', value: 'Limit' },
      { label: 'Default Slippage', value: '0.50%' },
    ],
    title: 'Trading Defaults',
  },
  {
    href: '/preferences/security',
    icon: Shield,
    rows: [
      { label: 'Password', value: 'Change Password' },
      { label: 'Two-Factor Authentication', tone: 'positive', value: 'Enabled' },
      { label: 'Active Sessions', value: '3 active' },
      { label: 'Login History', value: 'View' },
    ],
    title: 'Security',
  },
  {
    href: '/preferences/notifications',
    icon: Bell,
    rows: [
      { label: 'App Notifications', tone: 'positive', value: 'Enabled' },
      { label: 'Email Notifications', tone: 'positive', value: 'Enabled' },
      { label: 'Webhook Alerts', tone: 'positive', value: 'Enabled' },
    ],
    title: 'Notifications',
  },
  {
    href: '/preferences/exchange-api',
    icon: PlugZap,
    rows: [
      { label: 'Connected Exchanges', value: '2 connected' },
      { label: 'API Keys', value: '3 keys' },
      { label: 'Permissions & Scopes', value: 'Manage' },
    ],
    title: 'Exchange Connections & API Keys',
  },
  {
    href: '/preferences/billing',
    icon: CreditCard,
    rows: [
      { label: 'Current Plan', value: 'Pro Plan' },
      { label: 'Next Billing Date', value: 'Jun 17, 2024' },
      { label: 'Payment Method', value: 'Visa **** 4242' },
    ],
    title: 'Billing & Plan',
  },
];

export function PreferencesPage() {
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
            <span className="preferences-avatar">A</span>
            <div className="preferences-profile-main">
              <h2>Artisaul</h2>
              <span>@artisaul</span>
              <b>Pro Trader</b>
            </div>
            <dl>
              <div>
                <dt>Email</dt>
                <dd>artisaul@example.com</dd>
              </div>
              <div>
                <dt>Country</dt>
                <dd>United States</dd>
              </div>
              <div>
                <dt>Timezone</dt>
                <dd>Europe/Paris</dd>
              </div>
              <div>
                <dt>Plan</dt>
                <dd>Pro Plan</dd>
              </div>
            </dl>
            <Link href="/preferences/billing">Manage Plan</Link>
          </Card>

          <div className="preferences-summary">
            {summaryCards.map((card) => (
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
