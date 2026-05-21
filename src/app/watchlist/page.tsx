import { BudWorkspacePage } from '../../screens/bud/BudWorkspacePage';
import { getMarketDataSnapshot } from '../../services/market-service';

export const dynamic = 'force-dynamic';

export default async function WatchlistRoute() {
  const snapshot = await getMarketDataSnapshot();

  return <BudWorkspacePage initialPairs={snapshot.pairs} initialStatus={snapshot.status} page="watchlist" />;
}
