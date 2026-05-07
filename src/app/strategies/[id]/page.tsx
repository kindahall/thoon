import { notFound } from 'next/navigation';

import { StrategyDetailPage } from '../../../screens/strategies/StrategyDetailPage';
import { getAgentSettings, getRiskRules, getStrategy, listAgentReports, listAgentRuns, listAgentSuggestions, listBacktestReports, listBots, listStrategyIds, listStrategyVersions } from '../../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

type StrategyDetailRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export function generateStaticParams() {
  return listStrategyIds().map((id) => ({ id }));
}

export default async function StrategyDetailRoute({ params }: StrategyDetailRouteProps) {
  const { id } = await params;
  const strategy = getStrategy(id);

  if (!strategy) {
    notFound();
  }

  return (
    <StrategyDetailPage
      agentReports={listAgentReports(strategy.id)}
      agentRuns={listAgentRuns(strategy.id)}
      agentSettings={getAgentSettings()}
      agentSuggestions={listAgentSuggestions(strategy.id)}
      agentVersions={listStrategyVersions(strategy.id)}
      bots={listBots()}
      reports={listBacktestReports()}
      riskRules={getRiskRules()}
      strategy={strategy}
    />
  );
}
