import { ChartsPage } from '../../screens/ChartsPage';

export const dynamic = 'force-dynamic';

type ChartsRouteProps = {
  searchParams?: Promise<{
    pair?: string;
    paperSessionId?: string;
    reportId?: string;
    strategyId?: string;
    timeframe?: string;
  }>;
};

export default async function ChartsRoute({ searchParams }: ChartsRouteProps) {
  const params = await searchParams;

  return <ChartsPage initialPair={params?.pair} initialPaperSessionId={params?.paperSessionId} initialReportId={params?.reportId} initialStrategyId={params?.strategyId} initialTimeframe={params?.timeframe} />;
}
