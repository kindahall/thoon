import { ExchangeHubPage } from '../../screens/ExchangeHubPage';
import { listApiKeys, listExchangeConnections, listWalletConnections } from '../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

export default function ExchangesRoute() {
  return <ExchangeHubPage apiKeys={listApiKeys()} exchanges={listExchangeConnections()} wallets={listWalletConnections()} />;
}
