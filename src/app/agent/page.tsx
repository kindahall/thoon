import { AgentDashboardPage } from '../../screens/agent/AgentDashboardPage';
import { getAgentAiStatus, getAgentSettings, listAgentQueueTasks, listAgentReports, listAgentRuns, listAgentSuggestions, listBacktestReports, listJournalTrades, listStrategies, listStrategyResearchRecords, listStrategyVersions } from '../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

export default function AgentRoute() {
  return (
    <AgentDashboardPage
      aiStatus={getAgentAiStatus()}
      backtests={listBacktestReports()}
      journalTrades={listJournalTrades()}
      reports={listAgentReports()}
      runs={listAgentRuns()}
      queue={listAgentQueueTasks()}
      researchRecords={listStrategyResearchRecords()}
      settings={getAgentSettings()}
      strategies={listStrategies()}
      suggestions={listAgentSuggestions()}
      versions={listStrategyVersions()}
    />
  );
}
