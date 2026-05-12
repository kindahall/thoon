import { NewBotPage } from '../../../screens/bots/NewBotPage';
import { listMarketPairs } from '../../../services/market-service';
import { getBot, getRiskRules, getTradeLimits, listBacktestReports, listBotLogs, listExchangeConnections, listStrategies } from '../../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

type CreateBotRouteProps = {
  searchParams: Promise<{
    pair?: string;
    botId?: string;
    reportId?: string;
    strategyId?: string;
    timeframe?: string;
  }>;
};

export default async function CreateBotRoute({ searchParams }: CreateBotRouteProps) {
  const { botId, pair, reportId, strategyId, timeframe } = await searchParams;

  const marketPairs = await listMarketPairs();

  return (
    <NewBotPage
      backtestReports={listBacktestReports()}
      botLogs={listBotLogs()}
      exchanges={listExchangeConnections()}
      initialBot={botId ? getBot(botId) : undefined}
      initialPair={pair}
      initialReportId={reportId}
      initialStrategyId={strategyId}
      initialTimeframe={timeframe}
      marketPairs={marketPairs}
      riskRules={getRiskRules()}
      strategies={listStrategies()}
      tradeLimits={getTradeLimits()}
    />
  );
}
