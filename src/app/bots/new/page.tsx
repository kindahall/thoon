import { NewBotPage } from '../../../screens/bots/NewBotPage';
import { listMarketPairs } from '../../../services/market-service';
import { getBot, getRiskRules, getTradeLimits, listBotLogs, listExchangeConnections, listStrategies } from '../../../services/thoon-data-service';

type CreateBotRouteProps = {
  searchParams: Promise<{
    pair?: string;
    botId?: string;
    strategyId?: string;
  }>;
};

export default async function CreateBotRoute({ searchParams }: CreateBotRouteProps) {
  const { botId, pair, strategyId } = await searchParams;
  const marketPairs = await listMarketPairs();

  return (
    <NewBotPage
      botLogs={listBotLogs()}
      exchanges={listExchangeConnections()}
      initialBot={botId ? getBot(botId) : undefined}
      initialPair={pair}
      initialStrategyId={strategyId}
      marketPairs={marketPairs}
      riskRules={getRiskRules()}
      strategies={listStrategies()}
      tradeLimits={getTradeLimits()}
    />
  );
}
