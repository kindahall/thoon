import { NewStrategyPage } from '../../../screens/strategies/NewStrategyPage';
import { listMarketPairs } from '../../../services/market-service';
import { getRiskRules, getStrategy, getTradeLimits } from '../../../services/thoon-data-service';

type CreateStrategyRouteProps = {
  searchParams?: Promise<{
    pair?: string;
    strategyId?: string;
  }>;
};

export default async function CreateStrategyRoute({ searchParams }: CreateStrategyRouteProps) {
  const params = await searchParams;
  const marketPairs = await listMarketPairs();

  return <NewStrategyPage initialPair={params?.pair} initialStrategy={params?.strategyId ? getStrategy(params.strategyId) : undefined} marketPairs={marketPairs} riskRules={getRiskRules()} tradeLimits={getTradeLimits()} />;
}
