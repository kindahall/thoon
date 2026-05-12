import { ReplayPaperPage } from '../../../screens/backtest/ReplayPaperPage';
import { getMarketCandles } from '../../../services/market-service';
import { listMarketPairs } from '../../../services/market-service';
import { listBacktestReports, listPaperTestSessions } from '../../../services/thoon-data-service';
import type { Candle, Timeframe } from '../../../types/market';

type ReplayRouteProps = {
  searchParams: Promise<{
    pair?: string;
    reportId?: string;
    sessionId?: string;
    strategyId?: string;
    timeframe?: string;
  }>;
};

export default async function ReplayRoute({ searchParams }: ReplayRouteProps) {
  const { pair, reportId, sessionId, strategyId, timeframe } = await searchParams;
  const marketPairs = await listMarketPairs();
  const paperSession = sessionId ? listPaperTestSessions().find((session) => session.id === sessionId) : undefined;
  const replayTimeframeParam = normalizeReplayTimeframe(timeframe);
  const reports = listBacktestReports();
  const report = reportId
    ? reports.find((item) => item.id === reportId)
    : paperSession
      ? reports.find((item) => item.id === paperSession.reportId)
      : reports
          .filter((item) => item.strategyId === strategyId)
          .filter((item) => !pair || item.market === pair)
          .filter((item) => !replayTimeframeParam || item.timeframe === replayTimeframeParam)
          .sort((left, right) => new Date(right.generatedAt ?? '').getTime() - new Date(left.generatedAt ?? '').getTime())[0];
  const replayTimeframe = replayTimeframeParam ?? report?.timeframe ?? paperSession?.timeframe;
  let replayCandles: Candle[] = [];
  let candleError: string | undefined;

  if (report?.market && replayTimeframe) {
    try {
      replayCandles = await getMarketCandles(report.market, replayTimeframe, report.exchangeId ?? 'binance', Math.max(report.candleCount ?? 240, 240), {
        marketType: report.executionSettings?.marketType ?? 'perpetual',
        strict: true,
      });
    } catch (error) {
      candleError = error instanceof Error ? error.message : 'Live paper-test candles unavailable.';
    }
  }

  return <ReplayPaperPage candleError={candleError} initialCandles={replayCandles} initialPair={pair ?? report?.market} initialReport={report} initialSession={paperSession} initialStrategyId={strategyId ?? report?.strategyId} initialTimeframe={replayTimeframe} marketPairs={marketPairs} />;
}

function normalizeReplayTimeframe(value: string | undefined): Timeframe | undefined {
  const timeframes: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w', '1M', '1y'];

  return timeframes.find((timeframe) => timeframe === value);
}
