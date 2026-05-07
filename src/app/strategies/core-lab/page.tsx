import { CoreStrategyLabPage } from '../../../screens/strategies/CoreStrategyLabPage';
import { getAgentSettings, listAgentReports, listAgentRuns, listAgentSuggestions, listBacktestReports, listStrategies, listStrategyVersions } from '../../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

export default function CoreStrategyLabRoute() {
  return (
    <CoreStrategyLabPage
      backtests={listBacktestReports()}
      reports={listAgentReports()}
      runs={listAgentRuns()}
      settings={getAgentSettings()}
      strategies={listStrategies()}
      suggestions={listAgentSuggestions()}
      versions={listStrategyVersions()}
    />
  );
}
