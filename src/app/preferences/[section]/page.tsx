import { notFound } from 'next/navigation';

import {
  getRiskRules,
  getTradeLimits,
  getUserProfile,
  getUserPreferences,
  listApiKeys,
  listAuditLogs,
  listExchangeConnections,
  listWalletConnections,
} from '../../../services/thoon-data-service';
import type { AuditEvent, PreferenceSectionKey } from '../../../types/trading';

export const dynamic = 'force-dynamic';

const preferenceSectionKeys: PreferenceSectionKey[] = [
  'profile',
  'appearance',
  'trading-defaults',
  'security',
  'data-privacy',
  'risk-rules',
  'trade-limits',
  'audit-logs',
];

type PreferenceSectionRouteProps = {
  params: Promise<{
    section: string;
  }>;
  searchParams?: Promise<{
    event?: string;
  }>;
};

export function generateStaticParams() {
  return preferenceSectionKeys.map((section) => ({ section }));
}

export default async function PreferenceSectionRoute({ params, searchParams }: PreferenceSectionRouteProps) {
  const { section } = await params;
  const query = await searchParams;

  if (section === 'exchange-api') {
    const { ExchangeHubPage } = await import('../../../screens/ExchangeHubPage');

    return <ExchangeHubPage apiKeys={listApiKeys()} exchanges={listExchangeConnections()} wallets={listWalletConnections()} />;
  }

  if (!isPreferenceSectionKey(section)) {
    notFound();
  }

  if (section === 'profile') {
    const { ProfileSettingsPage } = await import('../../../screens/preferences/ProfileSettingsPage');

    return <ProfileSettingsPage profile={getUserProfile()} />;
  }

  if (section === 'appearance') {
    const { AppearanceSettingsPage } = await import('../../../screens/preferences/AppearanceSettingsPage');

    return <AppearanceSettingsPage preferences={getUserPreferences()} />;
  }

  if (section === 'trading-defaults') {
    const { TradingDefaultsSettingsPage } = await import('../../../screens/preferences/TradingDefaultsSettingsPage');

    return <TradingDefaultsSettingsPage preferences={getUserPreferences()} />;
  }

  if (section === 'security') {
    const { SecuritySettingsPage } = await import('../../../screens/preferences/SecuritySettingsPage');

    return <SecuritySettingsPage apiKeys={listApiKeys()} auditLogs={listAuditLogs()} exchanges={listExchangeConnections()} riskRules={getRiskRules()} />;
  }

  if (section === 'data-privacy') {
    const { DataPrivacySettingsPage } = await import('../../../screens/preferences/DataPrivacySettingsPage');

    return <DataPrivacySettingsPage auditLogs={listAuditLogs()} preferences={getUserPreferences()} />;
  }

  if (section === 'risk-rules') {
    const { RiskRulesSettingsPage } = await import('../../../screens/preferences/RiskRulesSettingsPage');

    return <RiskRulesSettingsPage riskRules={getRiskRules()} />;
  }

  if (section === 'trade-limits') {
    const { TradeLimitsSettingsPage } = await import('../../../screens/preferences/TradeLimitsSettingsPage');

    return <TradeLimitsSettingsPage tradeLimits={getTradeLimits()} />;
  }

  if (section === 'audit-logs') {
    const { AuditLogsSettingsPage } = await import('../../../screens/preferences/AuditLogsSettingsPage');

    return <AuditLogsSettingsPage auditLogs={listAuditLogs()} initialEventType={isAuditEventType(query?.event) ? query.event : undefined} />;
  }

  notFound();
}

function isPreferenceSectionKey(value: string): value is PreferenceSectionKey {
  return preferenceSectionKeys.includes(value as PreferenceSectionKey);
}

function isAuditEventType(value?: string): value is AuditEvent['eventType'] {
  return value === 'api' || value === 'order' || value === 'bot' || value === 'strategy' || value === 'risk' || value === 'system';
}
