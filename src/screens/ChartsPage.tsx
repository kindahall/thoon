import { ChartsWorkspace } from './charts/ChartsWorkspace';
import { listMarketPairs } from '../services/market-service';
import {
  getRiskRules,
  getTradeLimits,
  getUserPreferences,
  listChartBacktestReports,
  listChartStrategies,
  listBots,
  listExchangeConnections,
  listJournalTrades,
  listOpenOrders,
  listOrderHistory,
  listPaperTestSessions,
  listPositions,
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
      backtestReports={listChartBacktestReports()}
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
      strategies={listChartStrategies()}
      tradeLimits={getTradeLimits()}
    />
  );
}
