import { ReplayPaperPage } from '../../../screens/backtest/ReplayPaperPage';
import { listMarketPairs } from '../../../services/market-service';

type ReplayRouteProps = {
  searchParams: Promise<{
    pair?: string;
  }>;
};

export default async function ReplayRoute({ searchParams }: ReplayRouteProps) {
  const { pair } = await searchParams;
  const marketPairs = await listMarketPairs();

  return <ReplayPaperPage initialPair={pair} marketPairs={marketPairs} />;
}
