import { PreferencesPage } from '../../screens/PreferencesPage';
import { getRiskRules, getUserProfile, getUserPreferences, listApiKeys, listExchangeConnections } from '../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

export default function PreferencesRoute() {
  return <PreferencesPage apiKeys={listApiKeys()} exchanges={listExchangeConnections()} preferences={getUserPreferences()} profile={getUserProfile()} riskRules={getRiskRules()} />;
}
