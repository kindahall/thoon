import { AgentDashboardPage } from '../../screens/agent/AgentDashboardPage';
import { getAgentAiStatus, getAgentSettings, listAgentQueueTasks, listAgentReports, listAgentRuns, listAgentSuggestions, listStrategies, listStrategyVersions } from '../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

export default function AgentRoute() {
  return (
    <AgentDashboardPage
      aiStatus={getAgentAiStatus()}
      reports={listAgentReports()}
      runs={listAgentRuns()}
      queue={listAgentQueueTasks()}
      settings={getAgentSettings()}
      strategies={listStrategies()}
      suggestions={listAgentSuggestions()}
      versions={listStrategyVersions()}
    />
  );
}
