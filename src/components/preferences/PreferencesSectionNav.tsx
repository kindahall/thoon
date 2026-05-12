import {
  Bell,
  Bot,
  ChartNoAxesCombined,
  CreditCard,
  Database,
  Keyboard,
  LayoutGrid,
  ListChecks,
  Palette,
  ScrollText,
  Shield,
  User,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';

import type { PreferenceSectionKey } from '../../types/trading';
import { Card } from '../ui';

const preferenceSections = [
  { href: '/preferences/agent', icon: Bot, key: 'agent', label: 'Strategy Agent' },
  { href: '/preferences/profile', icon: User, key: 'profile', label: 'Profile' },
  { href: '/preferences/appearance', icon: Palette, key: 'appearance', label: 'Appearance' },
  { href: '/preferences/trading-defaults', icon: ChartNoAxesCombined, key: 'trading-defaults', label: 'Trading Defaults' },
  { href: '/preferences/security', icon: Shield, key: 'security', label: 'Security' },
  { href: '/preferences/notifications', icon: Bell, key: 'notifications', label: 'Notifications' },
  { href: '/preferences/billing', icon: CreditCard, key: 'billing', label: 'Billing & Plan' },
  { href: '/preferences/data-privacy', icon: Database, key: 'data-privacy', label: 'Data & Privacy' },
  { href: '/preferences/risk-rules', icon: Shield, key: 'risk-rules', label: 'Risk Rules' },
  { href: '/preferences/trade-limits', icon: ListChecks, key: 'trade-limits', label: 'Trade Limits' },
  { href: '/preferences/audit-logs', icon: ScrollText, key: 'audit-logs', label: 'Audit Logs' },
  { href: '/preferences/layouts', icon: LayoutGrid, key: 'layouts', label: 'Layouts' },
  { href: '/preferences/keyboard-shortcuts', icon: Keyboard, key: 'keyboard-shortcuts', label: 'Keyboard Shortcuts' },
  { href: '/preferences/advanced', icon: Wrench, key: 'advanced', label: 'Advanced' },
] satisfies Array<{
  href: string;
  icon: typeof User;
  key: PreferenceSectionKey;
  label: string;
}>;

type PreferencesSectionNavProps = {
  active: PreferenceSectionKey;
};

export function PreferencesSectionNav({ active }: PreferencesSectionNavProps) {
  return (
    <Card className="preferences-sidebar">
      <h2>Preferences</h2>
      <nav aria-label="Preferences navigation">
        {preferenceSections.map((section) => {
          const Icon = section.icon;

          return (
            <Link className={section.key === active ? 'is-active' : undefined} href={section.href} key={section.key}>
              <Icon size={17} />
              <span>{section.label}</span>
            </Link>
          );
        })}
      </nav>
    </Card>
  );
}
