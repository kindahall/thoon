import { notFound } from 'next/navigation';

import { AdvancedSettingsPage } from '../../../screens/preferences/AdvancedSettingsPage';
import { AgentSettingsPage } from '../../../screens/preferences/AgentSettingsPage';
import { AppearanceSettingsPage } from '../../../screens/preferences/AppearanceSettingsPage';
import { AuditLogsSettingsPage } from '../../../screens/preferences/AuditLogsSettingsPage';
import { BillingSettingsPage } from '../../../screens/preferences/BillingSettingsPage';
import { DataPrivacySettingsPage } from '../../../screens/preferences/DataPrivacySettingsPage';
import { ExchangeApiSettingsPage } from '../../../screens/preferences/ExchangeApiSettingsPage';
import { KeyboardShortcutsSettingsPage } from '../../../screens/preferences/KeyboardShortcutsSettingsPage';
import { LayoutsSettingsPage } from '../../../screens/preferences/LayoutsSettingsPage';
import { NotificationsSettingsPage } from '../../../screens/preferences/NotificationsSettingsPage';
import { ProfileSettingsPage } from '../../../screens/preferences/ProfileSettingsPage';
import { RiskRulesSettingsPage } from '../../../screens/preferences/RiskRulesSettingsPage';
import { SecuritySettingsPage } from '../../../screens/preferences/SecuritySettingsPage';
import { TradeLimitsSettingsPage } from '../../../screens/preferences/TradeLimitsSettingsPage';
import { TradingDefaultsSettingsPage } from '../../../screens/preferences/TradingDefaultsSettingsPage';
import { WorkspacePage } from '../../../screens/WorkspacePage';
import {
  getPreferenceSectionSummary,
  getAgentAiStatus,
  getAgentSettings,
  getRiskRules,
  getTradeLimits,
  getUserProfile,
  getUserPreferences,
  listApiKeys,
  listAlerts,
  listAuditLogs,
  listExchangeConnections,
} from '../../../services/thoon-data-service';
import type { AuditEvent, PreferenceSectionKey } from '../../../types/trading';

export const dynamic = 'force-dynamic';

const preferenceSectionKeys: PreferenceSectionKey[] = [
  'agent',
  'profile',
  'appearance',
  'trading-defaults',
  'security',
  'notifications',
  'exchange-api',
  'billing',
  'data-privacy',
  'risk-rules',
  'trade-limits',
  'audit-logs',
  'layouts',
  'keyboard-shortcuts',
  'advanced',
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

  if (!isPreferenceSectionKey(section)) {
    notFound();
  }

  if (section === 'profile') {
    return <ProfileSettingsPage profile={getUserProfile()} />;
  }

  if (section === 'agent') {
    return <AgentSettingsPage aiStatus={getAgentAiStatus()} settings={getAgentSettings()} />;
  }

  if (section === 'appearance') {
    return <AppearanceSettingsPage />;
  }

  if (section === 'trading-defaults') {
    return <TradingDefaultsSettingsPage preferences={getUserPreferences()} />;
  }

  if (section === 'security') {
    return <SecuritySettingsPage apiKeys={listApiKeys()} auditLogs={listAuditLogs()} exchanges={listExchangeConnections()} riskRules={getRiskRules()} />;
  }

  if (section === 'notifications') {
    return <NotificationsSettingsPage alerts={listAlerts()} />;
  }

  if (section === 'exchange-api') {
    return <ExchangeApiSettingsPage apiKeys={listApiKeys()} auditLogs={listAuditLogs()} exchanges={listExchangeConnections()} />;
  }

  if (section === 'billing') {
    return <BillingSettingsPage />;
  }

  if (section === 'data-privacy') {
    return <DataPrivacySettingsPage auditLogs={listAuditLogs()} />;
  }

  if (section === 'risk-rules') {
    return <RiskRulesSettingsPage riskRules={getRiskRules()} />;
  }

  if (section === 'trade-limits') {
    return <TradeLimitsSettingsPage tradeLimits={getTradeLimits()} />;
  }

  if (section === 'audit-logs') {
    return <AuditLogsSettingsPage auditLogs={listAuditLogs()} initialEventType={isAuditEventType(query?.event) ? query.event : undefined} />;
  }

  if (section === 'layouts') {
    return <LayoutsSettingsPage />;
  }

  if (section === 'keyboard-shortcuts') {
    return <KeyboardShortcutsSettingsPage />;
  }

  if (section === 'advanced') {
    return <AdvancedSettingsPage />;
  }

  return <WorkspacePage {...getPreferenceSectionSummary(section)} />;
}

function isPreferenceSectionKey(value: string): value is PreferenceSectionKey {
  return preferenceSectionKeys.includes(value as PreferenceSectionKey);
}

function isAuditEventType(value?: string): value is AuditEvent['eventType'] {
  return value === 'api' || value === 'order' || value === 'bot' || value === 'strategy' || value === 'risk' || value === 'system';
}
