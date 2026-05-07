import { notFound } from 'next/navigation';

import { BotDetailPage } from '../../../screens/bots/BotDetailPage';
import { getAgentSettings, listAgentReports, listAgentRuns, listAgentSuggestions, listBotIds, listBotLogs, listBots, listExchangeConnections, listPositions, listStrategies, listStrategyVersions } from '../../../services/thoon-data-service';

export const dynamic = 'force-dynamic';

type BotDetailRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export function generateStaticParams() {
  return listBotIds().map((id) => ({ id }));
}

export default async function BotDetailRoute({ params }: BotDetailRouteProps) {
  const { id } = await params;
  const bot = listBots().find((item) => item.id === id);

  if (!bot) {
    notFound();
  }

  const strategy = listStrategies().find((item) => item.id === bot.strategyId);

  return (
    <BotDetailPage
      agentReports={listAgentReports(bot.strategyId)}
      agentRuns={listAgentRuns(bot.strategyId)}
      agentSettings={getAgentSettings()}
      agentSuggestions={listAgentSuggestions(bot.strategyId)}
      agentVersions={listStrategyVersions(bot.strategyId)}
      bot={bot}
      exchanges={listExchangeConnections()}
      logs={listBotLogs()}
      positions={listPositions()}
      strategy={strategy}
    />
  );
}
