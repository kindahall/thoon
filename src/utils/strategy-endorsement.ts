import type { AgentSettings, BacktestReport, PaperTestSession, Strategy } from '../types/trading';

export type EndorsedStrategy = {
  paperSession: PaperTestSession;
  reasons: string[];
  report: BacktestReport;
  score: number;
  strategy: Strategy;
};

export function buildEndorsedStrategies(input: { backtests: BacktestReport[]; paperSessions: PaperTestSession[]; settings: AgentSettings; strategies: Strategy[] }) {
  const rows: EndorsedStrategy[] = [];

  for (const strategy of input.strategies) {
    const report = input.backtests
      .filter((item) => item.strategyId === strategy.id && isTrustedCalculatedBacktest(item))
      .sort((left, right) => reliabilityScore(right, input.settings) - reliabilityScore(left, input.settings) || new Date(right.generatedAt ?? '').getTime() - new Date(left.generatedAt ?? '').getTime())[0];

    if (!report || !isReliableBacktest(report, input.settings)) {
      continue;
    }

    const paperSession = input.paperSessions
      .filter((session) => session.strategyId === strategy.id && (session.reportId === report.id || !session.reportId))
      .filter(isPositivePaperSession)
      .sort((left, right) => right.botScore - left.botScore || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0];

    if (!paperSession) {
      continue;
    }

    rows.push({
      paperSession,
      reasons: reliabilityReasons(report, paperSession, input.settings),
      report,
      score: Math.min(100, Math.round((reliabilityScore(report, input.settings) + paperSession.botScore) / 2)),
      strategy,
    });
  }

  return rows.sort((left, right) => right.score - left.score || right.paperSession.rMultiple - left.paperSession.rMultiple || right.report.netProfit - left.report.netProfit);
}

export function isEndorsedStrategy(strategyId: string, endorsed: EndorsedStrategy[]) {
  return endorsed.some((item) => item.strategy.id === strategyId);
}

function isPositivePaperSession(session: PaperTestSession) {
  return (session.status === 'completed' || session.status === 'running') && session.tradesRecorded > 0 && session.pnl > 0 && session.rMultiple > 0 && session.blockers.length === 0;
}

function isReliableBacktest(report: BacktestReport, settings: AgentSettings) {
  return report.netProfit > 0 && report.profitFactor >= settings.limits.minProfitFactor && report.totalTrades >= settings.limits.minTrades && Math.abs(report.drawdown) <= settings.limits.maxDrawdownCandidate && reliabilityScore(report, settings) >= 80;
}

function isTrustedCalculatedBacktest(report: BacktestReport) {
  return report.source === 'calculated' && Boolean(report.dataWindow?.candleChecksum) && Boolean(report.executionSettings) && Array.isArray(report.equityCurve) && report.equityCurve.length > 0;
}

function reliabilityScore(report: BacktestReport, settings: AgentSettings) {
  const evidenceScore =
    (report.source === 'calculated' ? 20 : 0) +
    (report.marketDataSource === 'binance-live' || Boolean(report.marketDataSource?.endsWith('-public-rest')) ? 20 : 0) +
    (report.dataWindow?.candleChecksum ? 20 : 0);
  const profitScore = Math.min(18, report.profitFactor * 7 + Math.max(0, report.netProfit / 40));
  const sampleScore = Math.min(18, (report.totalTrades / Math.max(settings.limits.minTrades, 1)) * 18);
  const drawdownScore = Math.max(0, 14 - (Math.abs(report.drawdown) / Math.max(settings.limits.maxDrawdownCandidate, 1)) * 14);
  const winScore = report.winRate >= 80 || (report.winRate < 50 && report.netProfit > 0) ? 10 : 4;

  return Math.max(0, Math.min(100, Math.round(evidenceScore + profitScore + sampleScore + drawdownScore + winScore)));
}

function reliabilityReasons(report: BacktestReport, paperSession: PaperTestSession, settings: AgentSettings) {
  return [
    `${report.totalTrades} backtest trades, minimum ${settings.limits.minTrades}.`,
    `${report.profitFactor.toFixed(2)} profit factor with ${report.drawdown.toFixed(1)}% drawdown.`,
    `${paperSession.tradesRecorded} paper trades, ${paperSession.rMultiple.toFixed(2)}R, ${formatMoney(paperSession.pnl)} paper PnL.`,
    `Checksum ${report.dataWindow?.candleChecksum?.slice(0, 12) ?? 'missing'} from ${report.marketDataSource ?? 'source'}.`,
  ];
}

function formatMoney(value: number) {
  const sign = value < 0 ? '-' : '';

  return `${sign}$${Math.abs(value).toFixed(2)}`;
}
