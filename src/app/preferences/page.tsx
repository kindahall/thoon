import { PreferencesPage } from '../../screens/PreferencesPage';
import { getRiskRules, getUserProfile, getUserPreferences, listAlerts, listApiKeys, listExchangeConnections } from '../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

export default function PreferencesRoute() {
  return <PreferencesPage alerts={listAlerts()} apiKeys={listApiKeys()} exchanges={listExchangeConnections()} preferences={getUserPreferences()} profile={getUserProfile()} riskRules={getRiskRules()} />;
}
