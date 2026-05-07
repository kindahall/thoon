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
  listBots,
  listExchangeConnections,
  listJournalTrades,
  listOpenOrders,
  listOrderHistory,
  listPositions,
  listStrategyVersions,
} from '../services/thoon-data-service';

type ChartsPageProps = {
  initialPair?: string;
};

export async function ChartsPage({ initialPair }: ChartsPageProps) {
  const marketPairs = await listMarketPairs();

  return (
    <ChartsWorkspace
      agentReports={listAgentReports()}
      agentRuns={listAgentRuns()}
      agentSettings={getAgentSettings()}
      agentSuggestions={listAgentSuggestions()}
      agentVersions={listStrategyVersions()}
      bots={listBots()}
      defaultPreferences={getUserPreferences()}
      exchangeConnections={listExchangeConnections()}
      initialPair={initialPair}
      journalTrades={listJournalTrades()}
      marketPairs={marketPairs}
      openOrders={listOpenOrders()}
      orderHistory={listOrderHistory()}
      positions={listPositions()}
      riskRules={getRiskRules()}
      tradeLimits={getTradeLimits()}
    />
  );
}
