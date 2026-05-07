import { MarketsPage } from '../../screens/MarketsPage';
import { getMarketDataSnapshot } from '../../services/market-service';
import { listWatchlists } from '../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

export default async function MarketsRoute() {
  const snapshot = await getMarketDataSnapshot();
  const favoriteSymbols = listWatchlists().find((list) => list.id === 'favorites')?.pairSymbols ?? [];

  return <MarketsPage favoriteSymbols={favoriteSymbols} initialOverview={snapshot.overview} initialPairs={snapshot.pairs} initialStatus={snapshot.status} />;
}
