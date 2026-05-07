import { AlertsPage } from '../../screens/AlertsPage';
import { listMarketPairs } from '../../services/market-service';
import { listAlerts } from '../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

type AlertsRouteProps = {
  searchParams?: Promise<{
    pair?: string;
  }>;
};

export default async function AlertsRoute({ searchParams }: AlertsRouteProps) {
  const params = await searchParams;
  const marketPairs = await listMarketPairs();

  return <AlertsPage alerts={listAlerts()} marketPairs={marketPairs} pair={params?.pair} />;
}
