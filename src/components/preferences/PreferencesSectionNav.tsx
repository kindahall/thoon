import {
  ChartNoAxesCombined,
  Database,
  ListChecks,
  Palette,
  ScrollText,
  Shield,
  User,
} from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import type { PreferenceSectionKey } from '../../types/trading';
import { Card } from '../ui';

const preferenceSections = [
  { accent: '#8b7cff', href: '/preferences/profile', icon: User, key: 'profile', label: 'Profile' },
  { accent: '#ff7ac8', href: '/preferences/appearance', icon: Palette, key: 'appearance', label: 'Look' },
  { accent: '#62e6a8', href: '/preferences/trading-defaults', icon: ChartNoAxesCombined, key: 'trading-defaults', label: 'Defaults' },
  { accent: '#ffd45a', href: '/preferences/security', icon: Shield, key: 'security', label: 'Security' },
  { accent: '#64f4d2', href: '/preferences/data-privacy', icon: Database, key: 'data-privacy', label: 'Privacy' },
  { accent: '#ff5f75', href: '/preferences/risk-rules', icon: Shield, key: 'risk-rules', label: 'Risk' },
  { accent: '#62e6a8', href: '/preferences/trade-limits', icon: ListChecks, key: 'trade-limits', label: 'Limits' },
  { accent: '#a78bfa', href: '/preferences/audit-logs', icon: ScrollText, key: 'audit-logs', label: 'Logs' },
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
    <Card className="preferences-section-strip">
      <nav aria-label="Preferences navigation">
        {preferenceSections.map((section) => {
          const Icon = section.icon;

          return (
            <Link
              aria-label={section.label}
              className={section.key === active ? 'is-active' : undefined}
              href={section.href}
              key={section.key}
              style={{ '--preference-section-accent': section.accent } as CSSProperties}
              title={section.label}
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
