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
import type { CSSProperties } from 'react';

import type { PreferenceSectionKey } from '../../types/trading';
import { Card } from '../ui';

const preferenceSections = [
  { accent: '#26c8ff', href: '/preferences/agent', icon: Bot, key: 'agent', label: 'Strategy Agent' },
  { accent: '#8b7cff', href: '/preferences/profile', icon: User, key: 'profile', label: 'Profile' },
  { accent: '#ff7ac8', href: '/preferences/appearance', icon: Palette, key: 'appearance', label: 'Appearance' },
  { accent: '#62e6a8', href: '/preferences/trading-defaults', icon: ChartNoAxesCombined, key: 'trading-defaults', label: 'Trading Defaults' },
  { accent: '#ffd45a', href: '/preferences/security', icon: Shield, key: 'security', label: 'Security' },
  { accent: '#37d5ff', href: '/preferences/notifications', icon: Bell, key: 'notifications', label: 'Notifications' },
  { accent: '#ffb86b', href: '/preferences/billing', icon: CreditCard, key: 'billing', label: 'Billing & Plan' },
  { accent: '#64f4d2', href: '/preferences/data-privacy', icon: Database, key: 'data-privacy', label: 'Data & Privacy' },
  { accent: '#ff5f75', href: '/preferences/risk-rules', icon: Shield, key: 'risk-rules', label: 'Risk Rules' },
  { accent: '#62e6a8', href: '/preferences/trade-limits', icon: ListChecks, key: 'trade-limits', label: 'Trade Limits' },
  { accent: '#a78bfa', href: '/preferences/audit-logs', icon: ScrollText, key: 'audit-logs', label: 'Audit Logs' },
  { accent: '#26c8ff', href: '/preferences/layouts', icon: LayoutGrid, key: 'layouts', label: 'Layouts' },
  { accent: '#64f4d2', href: '/preferences/keyboard-shortcuts', icon: Keyboard, key: 'keyboard-shortcuts', label: 'Keyboard Shortcuts' },
  { accent: '#ffb86b', href: '/preferences/advanced', icon: Wrench, key: 'advanced', label: 'Advanced' },
] satisfies Array<{
  accent: string;
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
            <Link
              className={section.key === active ? 'is-active' : undefined}
              href={section.href}
              key={section.key}
              style={{ '--preference-section-accent': section.accent } as CSSProperties}
            >
              <Icon size={17} />
              <span>{section.label}</span>
            </Link>
          );
        })}
      </nav>
    </Card>
  );
}
