import { WatchlistWorkspace } from './watchlist/WatchlistWorkspace';
import { listMarketPairs } from '../services/market-service';
import { listAlerts, listWatchlists } from '../services/thoon-data-service';

type WatchlistPageProps = {
  initialAddPair?: string;
};

export async function WatchlistPage({ initialAddPair }: WatchlistPageProps) {
  return <WatchlistWorkspace alerts={listAlerts()} initialAddPair={initialAddPair} marketPairs={await listMarketPairs()} watchlists={listWatchlists()} />;
}
