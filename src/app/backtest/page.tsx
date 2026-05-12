import { BacktestPage } from '../../screens/backtest/BacktestPage';
import { listMarketPairs } from '../../services/market-service';
import { getAgentSettings, listAgentReports, listAgentRuns, listAgentSuggestions, listBacktestReports, listExchangeConnections, listStrategies, listStrategyVersions } from '../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

type BacktestRouteProps = {
  searchParams: Promise<{
    pair?: string;
    reportId?: string;
    strategyId?: string;
    timeframe?: string;
  }>;
};

export default async function BacktestRoute({ searchParams }: BacktestRouteProps) {
  const { pair, reportId, strategyId, timeframe } = await searchParams;
  const marketPairs = await listMarketPairs();

  return (
    <BacktestPage
      agentReports={listAgentReports()}
      agentRuns={listAgentRuns()}
      agentSettings={getAgentSettings()}
      agentSuggestions={listAgentSuggestions()}
      agentVersions={listStrategyVersions()}
      exchangeConnections={listExchangeConnections()}
      initialPair={pair}
      initialReportId={reportId}
      initialStrategyId={strategyId}
      initialTimeframe={timeframe}
      marketPairs={marketPairs}
      reports={listBacktestReports()}
      strategies={listStrategies()}
    />
  );
}
