import { TradeJournalPage } from '../../screens/history/TradeJournalPage';
import { getAgentSettings, listAgentReports, listAgentRuns, listAgentSuggestions, listJournalTrades, listStrategyVersions } from '../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

type HistoryRouteProps = {
  searchParams?: Promise<{
    pair?: string;
  }>;
};

export default async function HistoryRoute({ searchParams }: HistoryRouteProps) {
  const params = await searchParams;

  return (
    <TradeJournalPage
      agentReports={listAgentReports()}
      agentRuns={listAgentRuns()}
      agentSettings={getAgentSettings()}
      agentSuggestions={listAgentSuggestions()}
      agentVersions={listStrategyVersions()}
      initialPair={params?.pair}
      trades={listJournalTrades()}
    />
  );
}
