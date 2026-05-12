import { ChartsWorkspace } from './charts/ChartsWorkspace';
import { listMarketPairs } from '../services/market-service';
import {
  getRiskRules,
  getAgentSettings,
  getTradeLimits,
  getUserPreferences,
  listAgentReports,
  listAgentRuns,
  listAgentSuggestions,
  listBacktestReports,
  listBots,
  listExchangeConnections,
  listJournalTrades,
  listOpenOrders,
  listOrderHistory,
  listPaperTestSessions,
  listPositions,
  listStrategies,
  listStrategyVersions,
} from '../services/thoon-data-service';

type ChartsPageProps = {
  initialPair?: string;
  initialPaperSessionId?: string;
  initialReportId?: string;
  initialStrategyId?: string;
  initialTimeframe?: string;
};

export async function ChartsPage({ initialPair, initialPaperSessionId, initialReportId, initialStrategyId, initialTimeframe }: ChartsPageProps) {
  const marketPairs = await listMarketPairs();

  return (
    <ChartsWorkspace
      agentReports={listAgentReports()}
      agentRuns={listAgentRuns()}
      agentSettings={getAgentSettings()}
      agentSuggestions={listAgentSuggestions()}
      agentVersions={listStrategyVersions()}
      backtestReports={listBacktestReports()}
      bots={listBots()}
      defaultPreferences={getUserPreferences()}
      exchangeConnections={listExchangeConnections()}
      initialPair={initialPair}
      initialPaperSessionId={initialPaperSessionId}
      initialReportId={initialReportId}
      initialStrategyId={initialStrategyId}
      initialTimeframe={initialTimeframe}
      key={`${initialPair ?? 'stored-pair'}:${initialPaperSessionId ?? 'no-paper'}`}
      journalTrades={listJournalTrades()}
      marketPairs={marketPairs}
      openOrders={listOpenOrders()}
      orderHistory={listOrderHistory()}
      paperSessions={listPaperTestSessions()}
      positions={listPositions()}
      riskRules={getRiskRules()}
      strategies={listStrategies()}
      tradeLimits={getTradeLimits()}
    />
  );
}
