'use client';

import { AlertTriangle, BarChart3, Bot, CheckCircle2, Database, FileCheck2, FolderOpen, Loader2, MoreHorizontal, Play, RotateCcw, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { StrategyAgentDrawer } from '../../components/agent/StrategyAgentDrawer';
import { Badge, Button, Card, EmptyState, HelpPopover } from '../../components/ui';
import { useBinanceLiveMarkets } from '../../hooks/useBinanceLiveMarkets';
import { ApiClientError, postJson } from '../../services/api-client';
import type { MarketPair, Timeframe } from '../../types/market';
import type { AgentReport, AgentRun, AgentSettings, AgentSuggestion, BacktestReport, BacktestTrade, ExchangeConnection, Strategy, StrategyVersion } from '../../types/trading';
import { formatPercent, formatUsd } from '../../utils/format';

type BacktestPageProps = {
  agentReports: AgentReport[];
  agentRuns: AgentRun[];
  agentSettings: AgentSettings;
  agentSuggestions: AgentSuggestion[];
  agentVersions: StrategyVersion[];
  exchangeConnections: ExchangeConnection[];
  initialPair?: string;
  initialStrategyId?: string;
  marketPairs: MarketPair[];
  reports: BacktestReport[];
  strategies: Strategy[];
};

type BacktestTab = 'trades' | 'monthly' | 'distribution' | 'drawdown' | 'analysis';
type BacktestRunStatus = 'blocked' | 'error' | 'idle' | 'running' | 'success';
type BacktestRunKind = 'export' | 'run';

type BacktestRunState = {
  details?: string;
  finishedAt?: string;
  kind?: BacktestRunKind;
  message: string;
  startedAt?: string;
  status: BacktestRunStatus;
};

const tabs: Array<{ id: BacktestTab; label: string }> = [
  { id: 'trades', label: 'Trades' },
  { id: 'monthly', label: 'Monthly Returns' },
  { id: 'distribution', label: 'Equity Distribution' },
  { id: 'drawdown', label: 'Drawdown' },
  { id: 'analysis', label: 'Chart Analysis' },
];

const timeframes: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w', '1M', '1y'];
const tradesPageSize = 10;
const backtestRangeShortcuts: Array<{ label: string; value: string }> = [
  { label: '1M', value: '30D' },
  { label: '3M', value: '90D' },
  { label: '6M', value: '180D' },
  { label: '1Y', value: '1Y' },
];

export function BacktestPage({ agentReports, agentRuns, agentSettings, agentSuggestions, agentVersions, exchangeConnections, initialPair, initialStrategyId, marketPairs, reports: initialReports, strategies }: BacktestPageProps) {
  const { connected: isBinanceLive, pairs: liveMarketPairs } = useBinanceLiveMarkets(marketPairs);
  const initialStrategy = strategies.find((strategy) => strategy.id === initialStrategyId) ?? strategies.find((strategy) => strategy.market === initialPair) ?? strategies[0];
  const [reports, setReports] = useState(initialReports);
  const [strategyId, setStrategyId] = useState(initialStrategy?.id ?? '');
  const [symbol, setSymbol] = useState(initialPair ?? initialStrategy?.market ?? liveMarketPairs[0]?.symbol ?? 'BTC/USDT');
  const [timeframe, setTimeframe] = useState<Timeframe>(initialStrategy?.timeframe ?? '15m');
  const [dateRange, setDateRange] = useState('90D');
  const [exchangeId, setExchangeId] = useState('binance');
  const [initialCapital, setInitialCapital] = useState(10000);
  const [fees, setFees] = useState(0.06);
  const [slippage, setSlippage] = useState(0.02);
  const [activeTab, setActiveTab] = useState<BacktestTab>('trades');
  const [runStatus, setRunStatus] = useState('Ready');
  const [runState, setRunState] = useState<BacktestRunState>({ message: '', status: 'idle' });

  const strategy = strategies.find((item) => item.id === strategyId) ?? strategies[0];
  const selectedExchange = exchangeConnections.find((exchange) => exchange.id === exchangeId) ?? exchangeConnections[0];
  const matchingReports = reports.filter((item) => item.strategyId === strategyId && item.source === 'calculated' && item.market === symbol && item.timeframe === timeframe && item.period === dateRange && (item.exchangeId ?? 'binance') === exchangeId);
  const report = matchingReports.find(isTrustedBacktestReport);
  const selectedPair = liveMarketPairs.find((pair) => pair.symbol === symbol) ?? liveMarketPairs[0];
  const hiddenSeedReports = reports.filter((item) => item.strategyId === strategyId && item.source !== 'calculated').length;
  const hiddenInvalidReports = matchingReports.filter((item) => !isTrustedBacktestReport(item)).length;
  const isBacktestRunning = runState.status === 'running';

  const reportInitialCapital = report?.initialCapital ?? initialCapital;
  const totalReturn = report ? (report.netProfit / reportInitialCapital) * 100 : 0;
  const winningTrades = report ? report.winningTrades ?? Math.round((report.totalTrades * report.winRate) / 100) : 0;
  const losingTrades = report ? report.losingTrades ?? report.totalTrades - winningTrades : 0;

  const equitySeries = report?.equityCurve ?? [];
  const buyHoldSeries = report?.buyHoldCurve ?? [];
  const drawdownSeries = report?.drawdownCurve ?? [];
  const trades = useMemo(() => report?.trades ?? [], [report?.trades]);
  const monthlyReturns = report?.monthlyReturns ?? [];
  const distribution = useMemo(() => buildDistribution(equitySeries), [equitySeries]);
  const equityLast = equitySeries[equitySeries.length - 1] ?? reportInitialCapital;
  const buyHoldLast = buyHoldSeries[buyHoldSeries.length - 1] ?? reportInitialCapital;
  const buyHoldReturn = report?.buyHoldReturn ?? 0;
  const reportExchangeName = report?.exchangeName ?? selectedExchange?.name ?? 'Binance';
  const reportSourceLabel = report
    ? `${reportExchangeName} public candles · ${report.generatedAt ? formatRunDate(report.generatedAt) : 'latest run'}`
    : `${selectedExchange?.name ?? 'Binance'} selected`;

  function changeStrategy(nextStrategyId: string) {
    const nextStrategy = strategies.find((item) => item.id === nextStrategyId);
    setStrategyId(nextStrategyId);

    if (nextStrategy) {
      setSymbol(nextStrategy.market);
      setTimeframe(nextStrategy.timeframe);
    }
  }

  async function executeBacktest(kind: BacktestRunKind) {
    if (isBacktestRunning) {
      return;
    }

    const startedAt = new Date().toISOString();
    const runningMessage = `${selectedExchange?.name ?? exchangeId} public candles request for ${symbol} ${timeframe} ${dateRange}`;
    setRunStatus('Backtest running');
    setRunState({ kind, message: runningMessage, startedAt, status: 'running' });

    try {
      const report = await postJson<BacktestReport>('/api/backtests', {
        initialCapital,
        period: dateRange,
        fees,
        slippage,
        strategyId,
        symbol,
        timeframe,
        exchangeId,
      });

      if (!isTrustedBacktestReport(report)) {
        setRunStatus('Report blocked');
        setRunState({
          details: 'The backend returned a calculated report without full candle provenance or chart series.',
          finishedAt: new Date().toISOString(),
          kind,
          message: 'Backtest result rejected before display.',
          startedAt,
          status: 'blocked',
        });
        return;
      }

      setReports((currentReports) => [report, ...currentReports.filter((item) => item.id !== report.id)]);
      const successMessage = `${report.totalTrades} closed trades from ${report.candleCount ?? 0} public candles`;
      setRunStatus(successMessage);
      setRunState({
        finishedAt: new Date().toISOString(),
        kind,
        message: `${successMessage} · ${report.dataWindow?.candleChecksum ?? 'no checksum'}`,
        startedAt,
        status: 'success',
      });
    } catch (error) {
      const isApiError = error instanceof ApiClientError;
      const message = error instanceof Error ? error.message : 'Run failed';
      const status = isApiError && error.status === 502 ? 'blocked' : 'error';

      setRunStatus(status === 'blocked' ? 'Blocked' : 'Run failed');
      setRunState({
        details: isApiError ? error.details : undefined,
        finishedAt: new Date().toISOString(),
        kind,
        message,
        startedAt,
        status,
      });
    }
  }

  async function runBacktest() {
    await executeBacktest('run');
  }

  async function saveReport() {
    exportBacktestReport();
  }

  function exportBacktestReport() {
    if (!report) {
      setRunStatus('No report to export');
      setRunState({
        finishedAt: new Date().toISOString(),
        kind: 'export',
        message: 'Run a trusted backtest before saving a report.',
        status: 'blocked',
      });
      return;
    }

    const exportedAt = new Date().toISOString();
    const payload = {
      exportedAt,
      report,
      strategy: {
        id: strategy?.id,
        name: strategy?.name,
      },
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `${slugFileName(`thoon-${report.market ?? symbol}-${report.timeframe ?? timeframe}-${report.period}-${report.generatedAt ?? exportedAt}`)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setRunStatus('Report exported');
    setRunState({
      finishedAt: exportedAt,
      kind: 'export',
      message: `${report.id} · ${report.dataWindow?.candleChecksum ?? 'no checksum'}`,
      status: 'success',
    });
  }

  const runButtonIcon = isBacktestRunning && runState.kind === 'run' ? <Loader2 className="backtest-spin" size={15} /> : <Play size={15} />;
  const saveButtonIcon = <FileCheck2 size={15} />;

  return (
    <section className="backtest-page" aria-label="Backtest">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>Backtest</h1>
          <p>Run strategy tests before replay, paper trading or bot creation.</p>
        </div>
        <div className="workspace-header__right">
          <Badge tone={isBinanceLive ? 'positive' : 'warning'}>{isBinanceLive ? 'Binance live' : 'Local fallback'}</Badge>
          <StrategyAgentDrawer context="backtest" reports={agentReports.filter((item) => item.strategyId === strategyId)} runs={agentRuns.filter((item) => item.strategyId === strategyId)} settings={agentSettings} strategyId={strategyId} strategyName={strategy?.name} suggestions={agentSuggestions.filter((item) => item.strategyId === strategyId)} versions={agentVersions.filter((item) => item.strategyId === strategyId)} />
          <Button disabled={isBacktestRunning} icon={runButtonIcon} onClick={runBacktest} size="sm" variant="primary">
            {isBacktestRunning && runState.kind === 'run' ? 'Backtest running' : 'Run Backtest'}
          </Button>
          <Button disabled={isBacktestRunning || !report} icon={saveButtonIcon} onClick={saveReport} size="sm" variant="ghost">
            Save Report
          </Button>
          <Link className="ui-button ui-button--secondary ui-button--sm" href={`/backtest/replay?pair=${encodeURIComponent(symbol)}&strategyId=${encodeURIComponent(strategyId)}`}>
            <span className="ui-button__icon">
              <RotateCcw size={15} />
            </span>
            <span>Paper Test</span>
          </Link>
          <Link className="ui-button ui-button--ghost ui-button--sm" href={`/bots/new?strategyId=${encodeURIComponent(strategyId)}&pair=${encodeURIComponent(symbol)}`}>
            <span className="ui-button__icon">
              <Bot size={15} />
            </span>
            <span>Create Bot</span>
          </Link>
          <HelpPopover items={['Results are saved through the local backend.', 'Use Paper Test before any live automation.']} title="Backtest" />
        </div>
      </div>

      <Card className="backtest-control-panel">
        <div className="backtest-control-head">
          <div>
            <h2>Inputs</h2>
            <span>{runStatus}</span>
          </div>
          <div className="backtest-preset-actions">
            <Button disabled icon={<FolderOpen size={15} />} size="sm" variant="ghost">Load Preset</Button>
            <Button disabled icon={<FileCheck2 size={15} />} size="sm" variant="ghost">Save Preset</Button>
            <Button disabled icon={<MoreHorizontal size={15} />} size="sm" variant="ghost">More</Button>
          </div>
        </div>

        <div className="backtest-control-grid">
          <BacktestSelect label="Exchange" onChange={setExchangeId} value={exchangeId}>
            {exchangeConnections.map((exchange) => (
              <option key={exchange.id} value={exchange.id}>
                {exchange.name}
              </option>
            ))}
          </BacktestSelect>
          <BacktestSelect label="Symbol" onChange={setSymbol} value={symbol}>
            {liveMarketPairs.map((pair) => (
              <option key={pair.symbol} value={pair.symbol}>
                {pair.symbol}
              </option>
            ))}
          </BacktestSelect>
          <BacktestSelect label="Timeframe" onChange={(value) => setTimeframe(value as Timeframe)} value={timeframe}>
            {timeframes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </BacktestSelect>
          <BacktestSelect label="Date Range" onChange={setDateRange} value={dateRange}>
            <option value="30D">30D</option>
            <option value="90D">90D</option>
            <option value="180D">180D</option>
            <option value="1Y">1Y</option>
          </BacktestSelect>
          <BacktestNumberField label="Initial Capital" onChange={setInitialCapital} suffix="USDT" value={initialCapital} />
          <BacktestNumberField label="Fees" onChange={setFees} suffix="%" value={fees} />
          <BacktestNumberField label="Slippage" onChange={setSlippage} suffix="%" value={slippage} />
          <BacktestSelect label="Strategy" onChange={changeStrategy} value={strategyId}>
            {strategies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </BacktestSelect>
          <button className="backtest-filter-button" disabled type="button" aria-label="Backtest filters">
            <SlidersHorizontal size={18} />
          </button>
        </div>

        <div className="backtest-data-strip">
          <span>
            <Database size={14} />
            {reportSourceLabel}
          </span>
          <span>{report ? `${report.candleCount ?? 0} candles` : 'Run required'}</span>
          {report?.dataWindow ? <span>{formatRunDate(report.dataWindow.firstCandleAt)} to {formatRunDate(report.dataWindow.lastCandleAt)}</span> : null}
          {report?.dataWindow ? <span>{report.dataWindow.candleChecksum}</span> : null}
          <span>{symbol} · {timeframe} · {dateRange}</span>
          <span>Paper only. Live orders still require Risk Engine confirmation.</span>
        </div>
        {runState.status !== 'idle' ? <BacktestRunStateBanner state={runState} /> : null}
      </Card>

      {!report ? (
        <div className="backtest-empty-grid">
          <EmptyState
            actionLabel="Run Backtest"
            description={`Selected source: ${selectedExchange?.name ?? 'Binance'} public candles.`}
            icon={<BarChart3 size={20} />}
            secondaryActionHref="/strategies"
            secondaryActionLabel="Strategies"
            title="No calculated report for these inputs"
          />
          {hiddenSeedReports > 0 ? (
            <Card className="backtest-source-note">
              <strong>Seed samples hidden</strong>
              <span>{hiddenSeedReports} old sample report{hiddenSeedReports > 1 ? 's are' : ' is'} no longer shown as real data. Run a backtest to calculate from exchange candles.</span>
            </Card>
          ) : null}
          {hiddenInvalidReports > 0 ? (
            <Card className="backtest-source-note">
              <strong>Older reports hidden</strong>
              <span>{hiddenInvalidReports} calculated report{hiddenInvalidReports > 1 ? 's are' : ' is'} missing full candle provenance or chart series. Run again to create a trusted report.</span>
            </Card>
          ) : null}
        </div>
      ) : (
        <div className="backtest-dashboard-grid">
          <Card className="backtest-equity-card">
            <div className="backtest-panel-head">
              <div>
                <h2>Equity Curve</h2>
                <span>{strategy?.name ?? 'Strategy Report'} · {reportExchangeName}</span>
              </div>
              <div className="backtest-range-buttons" aria-label="Backtest range shortcuts">
                {backtestRangeShortcuts.map((item) => (
                  <button className={item.value === dateRange ? 'is-active' : undefined} key={item.value} onClick={() => setDateRange(item.value)} type="button">{item.label}</button>
                ))}
              </div>
            </div>
            <div className="backtest-chart-legend">
              <span className="is-equity">Equity <strong>{formatUsd(equityLast)}</strong> <em className={totalReturn >= 0 ? 'positive' : 'negative'}>{formatPercent(totalReturn)}</em></span>
              <span className="is-hold">Buy & Hold <strong>{formatUsd(buyHoldLast)}</strong> <em className={buyHoldReturn >= 0 ? 'positive' : 'negative'}>{formatPercent(buyHoldReturn)}</em></span>
            </div>
            <LineChartSvg className="equity-line" secondaryClassName="buyhold-line" secondaryValues={buyHoldSeries} values={equitySeries} />
          </Card>

          <Card className="backtest-performance-card">
            <div className="backtest-panel-head">
              <div>
                <h2>Performance Summary</h2>
                <span>{reportSourceLabel}</span>
              </div>
              <Badge tone={report.marketDataSource === 'binance-live' || report.marketDataSource?.endsWith('-public-rest') ? 'positive' : 'warning'}>
                {report.marketDataSource === 'binance-live' || report.marketDataSource?.endsWith('-public-rest') ? 'Live candles' : 'Blocked source'}
              </Badge>
            </div>
            {report.warnings?.length ? (
              <div className="backtest-warning-strip">
                {report.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            ) : null}
            <div className="backtest-summary-grid">
              <SummaryMetric label="Net Profit" tone={report.netProfit >= 0 ? 'positive' : 'negative'} value={formatUsd(report.netProfit)} />
              <SummaryMetric label="Total Return" tone={totalReturn >= 0 ? 'positive' : 'negative'} value={formatPercent(totalReturn)} />
              <SummaryMetric label="Win Rate" value={`${Math.round(report.winRate)}%`} />
              <SummaryMetric label="Profit Factor" tone={report.profitFactor >= 1.2 ? 'positive' : report.profitFactor >= 1 ? 'warning' : 'negative'} value={report.profitFactor.toFixed(2)} />
              <SummaryMetric label="Max Drawdown" tone="negative" value={`${report.drawdown.toFixed(1)}%`} />
              <SummaryMetric label="Total Trades" value={String(report.totalTrades)} />
              <SummaryMetric label="Winning Trades" tone="positive" value={String(winningTrades)} />
              <SummaryMetric label="Losing Trades" tone="negative" value={String(losingTrades)} />
            </div>
          </Card>

          <Card className="backtest-tabs-card">
            <div className="backtest-tabs">
              {tabs.map((tab) => (
                <button className={activeTab === tab.id ? 'is-active' : undefined} key={tab.id} onClick={() => setActiveTab(tab.id)} type="button">
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === 'trades' ? <TradesTable symbol={symbol} trades={trades} /> : null}
            {activeTab === 'monthly' ? <MonthlyReturns values={monthlyReturns} /> : null}
            {activeTab === 'distribution' ? <Distribution values={distribution} /> : null}
            {activeTab === 'drawdown' ? <DrawdownPanel values={drawdownSeries} /> : null}
            {activeTab === 'analysis' ? <ChartAnalysis pair={selectedPair} report={report} /> : null}
          </Card>

          <Card className="backtest-drawdown-card">
            <div className="backtest-panel-head">
              <div>
                <h2>Equity & Drawdown</h2>
                <span>Risk profile from calculated equity curve</span>
              </div>
            </div>
            <div className="backtest-drawdown-metrics">
              <SummaryMetric label="Max Drawdown" tone="negative" value={`${report.drawdown.toFixed(1)}%`} />
              <SummaryMetric label="Candles Used" value={String(report.candleCount ?? 0)} />
              <SummaryMetric label="Fees + Slip" value={`${((report.feesPct ?? fees) + (report.slippagePct ?? slippage)).toFixed(2)}%`} />
            </div>
            <LineChartSvg className="drawdown-line" fill values={drawdownSeries} />
          </Card>

          <Card className="backtest-actions-card">
            <div className={`backtest-actions-card__status backtest-actions-card__status--${runState.status}`}>
              <strong>{runState.status === 'idle' ? 'Report actions' : backtestRunTitle(runState)}</strong>
              <span>{runState.status === 'idle' ? `${report.totalTrades} closed trades ready · ${report.dataWindow?.candleChecksum ?? 'no checksum'}` : runState.message}</span>
            </div>
            <Button disabled={isBacktestRunning} icon={runButtonIcon} onClick={runBacktest} variant="primary">
              {isBacktestRunning && runState.kind === 'run' ? 'Backtest running' : 'Run Backtest'}
            </Button>
            <Button disabled={isBacktestRunning || !report} icon={saveButtonIcon} onClick={saveReport} variant="ghost">
              Save Report
            </Button>
            <Link className="ui-button ui-button--ghost" href={`/backtest/replay?pair=${encodeURIComponent(symbol)}&strategyId=${encodeURIComponent(strategyId)}`}>
              <span className="ui-button__icon"><RotateCcw size={15} /></span>
              <span>Paper Test</span>
            </Link>
          </Card>
        </div>
      )}
    </section>
  );
}

function BacktestRunStateBanner({ state }: { state: BacktestRunState }) {
  const icon =
    state.status === 'running' ? (
      <Loader2 className="backtest-spin" size={17} />
    ) : state.status === 'success' ? (
      <CheckCircle2 size={17} />
    ) : (
      <AlertTriangle size={17} />
    );

  return (
    <div className={`backtest-run-state backtest-run-state--${state.status}`} role={state.status === 'running' || state.status === 'success' ? 'status' : 'alert'} aria-live="polite">
      <span>{icon}</span>
      <div>
        <strong>{backtestRunTitle(state)}</strong>
        <small>{state.message}</small>
        {state.details ? <small>{state.details}</small> : null}
        {state.startedAt ? (
          <small>
            Started {formatRunDate(state.startedAt)}
            {state.finishedAt ? ` · Finished ${formatRunDate(state.finishedAt)}` : ''}
          </small>
        ) : null}
      </div>
    </div>
  );
}

function backtestRunTitle(state: BacktestRunState) {
  if (state.status === 'running') {
    return 'Backtest running';
  }

  if (state.status === 'success') {
    return state.kind === 'export' ? 'Report exported' : 'Backtest completed';
  }

  if (state.status === 'blocked') {
    return state.kind === 'export' ? 'Report export blocked' : 'Backtest blocked';
  }

  if (state.status === 'error') {
    return 'Backtest failed';
  }

  return 'Ready';
}

function BacktestSelect({ children, label, onChange, value }: { children: ReactNode; label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="backtest-field">
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        {children}
      </select>
    </label>
  );
}

function BacktestNumberField({ label, onChange, suffix, value }: { label: string; onChange: (value: number) => void; suffix: string; value: number }) {
  return (
    <label className="backtest-number-field">
      <span>{label}</span>
      <div>
        <input onChange={(event) => onChange(Number(event.target.value))} step="0.01" type="number" value={value} />
        <small>{suffix}</small>
      </div>
    </label>
  );
}

function SummaryMetric({ label, tone = 'neutral', value }: { label: string; tone?: 'neutral' | 'positive' | 'negative' | 'warning'; value: string }) {
  return (
    <div className="backtest-summary-metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function LineChartSvg({ className, fill = false, secondaryClassName, secondaryValues, values }: { className: string; fill?: boolean; secondaryClassName?: string; secondaryValues?: number[]; values: number[] }) {
  const width = 620;
  const height = 180;
  const allValues = secondaryValues?.length ? [...values, ...secondaryValues] : values;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const toPoints = (series: number[]) => series
    .map((value, index) => {
      const x = (index / Math.max(series.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * (height - 24) - 12;

      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const points = toPoints(values);
  const secondaryPoints = secondaryValues?.length ? toPoints(secondaryValues) : undefined;
  const areaPoints = fill ? `${points} ${width},${height} 0,${height}` : undefined;

  return (
    <svg aria-hidden="true" className={`backtest-line-chart ${className}`} preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
      <g className="backtest-grid-lines">
        <line x1="0" x2={width} y1="45" y2="45" />
        <line x1="0" x2={width} y1="90" y2="90" />
        <line x1="0" x2={width} y1="135" y2="135" />
      </g>
      {areaPoints ? <polygon className="backtest-area-fill" points={areaPoints} /> : null}
      {secondaryPoints ? <polyline className={secondaryClassName} fill="none" points={secondaryPoints} /> : null}
      <polyline fill="none" points={points} />
    </svg>
  );
}

function TradesTable({ symbol, trades }: { symbol: string; trades: BacktestTrade[] }) {
  const [page, setPage] = useState(1);
  const [selectedTradeId, setSelectedTradeId] = useState<string | undefined>();
  const orderedTrades = useMemo(
    () => [...trades].sort((left, right) => new Date(right.exitTime).getTime() - new Date(left.exitTime).getTime()),
    [trades],
  );
  const totalPages = Math.max(1, Math.ceil(orderedTrades.length / tradesPageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * tradesPageSize;
  const visibleTrades = orderedTrades.slice(start, start + tradesPageSize);
  const selectedTrade = orderedTrades.find((trade) => trade.id === selectedTradeId) ?? orderedTrades[0];

  useEffect(() => {
    setPage(1);
    setSelectedTradeId(orderedTrades[0]?.id);
  }, [orderedTrades]);

  return (
    <div className="backtest-trades-panel">
      <div className="backtest-table" role="table" aria-label="Backtest trades">
        <div className="backtest-table__head" role="row">
          <span>#</span>
          <span>Time</span>
          <span>Symbol</span>
          <span>Side</span>
          <span>Entry</span>
          <span>Exit</span>
          <span>Qty</span>
          <span>R</span>
          <span>PnL</span>
          <span>Exit Reason</span>
        </div>
        {visibleTrades.length > 0 ? visibleTrades.map((trade, index) => (
          <button className={`backtest-table__row backtest-table__row--button${selectedTrade?.id === trade.id ? ' is-selected' : ''}`} key={trade.id} onClick={() => setSelectedTradeId(trade.id)} role="row" type="button">
            <span>{start + index + 1}</span>
            <span>{formatTradeDate(trade.exitTime)}</span>
            <span>{symbol}</span>
            <strong>{titleCase(trade.side)}</strong>
            <span>{formatUsd(trade.entry)}</span>
            <span>{formatUsd(trade.exit)}</span>
            <span>{trade.size.toFixed(4)}</span>
            <span className={trade.rMultiple >= 0 ? 'positive' : 'negative'}>{trade.rMultiple.toFixed(2)}R</span>
            <span className={trade.pnl >= 0 ? 'positive' : 'negative'}>{formatUsd(trade.pnl)}</span>
            <span>{formatExitReason(trade.exitReason)}</span>
          </button>
        )) : <div className="backtest-table__empty">No trade triggered on this candle window.</div>}
      </div>

      {selectedTrade ? <TradeDetailPanel symbol={symbol} trade={selectedTrade} /> : null}

      {orderedTrades.length > tradesPageSize ? (
        <div className="backtest-trades-pagination" aria-label="Trades pages">
          <span>
            {start + 1}-{Math.min(start + tradesPageSize, orderedTrades.length)} / {orderedTrades.length}
          </span>
          <div>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((item) => (
              <button className={item === currentPage ? 'is-active' : undefined} key={item} onClick={() => setPage(item)} type="button">
                {item}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TradeDetailPanel({ symbol, trade }: { symbol: string; trade: BacktestTrade }) {
  return (
    <div className="backtest-trade-detail" aria-label="Trade detail">
      <div className="backtest-trade-detail__head">
        <div>
          <strong>Trade Detail</strong>
          <span>{symbol} · {titleCase(trade.side)} · {formatExitReason(trade.exitReason)}</span>
        </div>
        <Badge tone={trade.status === 'win' ? 'positive' : 'negative'}>{titleCase(trade.status)}</Badge>
      </div>
      <div className="backtest-trade-detail__grid">
        <SummaryMetric label="Entry" value={formatUsd(trade.entry)} />
        <SummaryMetric label="Exit" value={formatUsd(trade.exit)} />
        <SummaryMetric label="PnL" tone={trade.pnl >= 0 ? 'positive' : 'negative'} value={formatUsd(trade.pnl)} />
        <SummaryMetric label="R Multiple" tone={trade.rMultiple >= 0 ? 'positive' : 'negative'} value={`${trade.rMultiple.toFixed(2)}R`} />
        <SummaryMetric label="Size" value={trade.size.toFixed(4)} />
        <SummaryMetric label="Fees" value={formatUsd(trade.fee)} />
        <SummaryMetric label="Entry Time" value={formatTradeDateTime(trade.entryTime)} />
        <SummaryMetric label="Exit Time" value={formatTradeDateTime(trade.exitTime)} />
        <SummaryMetric label="Duration" value={formatDuration(trade.entryTime, trade.exitTime)} />
      </div>
      <small>{trade.id}</small>
    </div>
  );
}

function MonthlyReturns({ values }: { values: Array<{ label: string; value: number }> }) {
  return (
    <div className="monthly-returns-grid">
      {values.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <strong className={item.value >= 0 ? 'positive' : 'negative'}>{formatPercent(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function Distribution({ values }: { values: number[] }) {
  const max = Math.max(...values);

  return (
    <div className="equity-distribution" aria-label="Equity distribution">
      {values.map((value, index) => (
        <div key={`${value}-${index}`}>
          <span style={{ height: `${Math.max(8, (value / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

function DrawdownPanel({ values }: { values: number[] }) {
  const worst = Math.min(...values);
  const current = values[values.length - 1] ?? 0;

  return (
    <div className="drawdown-panel">
      <SummaryMetric label="Worst Drawdown" tone="negative" value={`${worst.toFixed(1)}%`} />
      <SummaryMetric label="Current Drawdown" tone={current < 0 ? 'negative' : 'neutral'} value={`${current.toFixed(1)}%`} />
      <SummaryMetric label="Curve Points" value={String(values.length)} />
      <SummaryMetric label="Risk State" tone={worst < -10 ? 'warning' : 'positive'} value={worst < -10 ? 'Review' : 'Allowed'} />
    </div>
  );
}

function ChartAnalysis({ pair, report }: { pair?: MarketPair; report?: BacktestReport }) {
  return (
    <div className="chart-analysis-grid">
      <SummaryMetric label="Pair" value={pair?.symbol ?? 'BTC/USDT'} />
      <SummaryMetric label="Last Price" value={formatUsd(pair?.lastPrice ?? 0)} />
      <SummaryMetric label="Win Rate" value={`${Math.round(report?.winRate ?? 0)}%`} />
      <SummaryMetric label="Signal Quality" tone={(report?.profitFactor ?? 0) >= 1.2 ? 'positive' : 'warning'} value={(report?.profitFactor ?? 0) >= 1.2 ? 'Stable' : 'Weak'} />
    </div>
  );
}

function isTrustedBacktestReport(report: BacktestReport) {
  return (
    report.source === 'calculated' &&
    (report.marketDataSource === 'binance-live' || Boolean(report.marketDataSource?.endsWith('-public-rest'))) &&
    report.engine === 'jimmy-pine-v5-candle-engine' &&
    Boolean(report.dataWindow?.candleChecksum) &&
    Boolean(report.dataWindow?.firstCandleAt) &&
    Boolean(report.dataWindow?.lastCandleAt) &&
    Number.isFinite(report.candleCount) &&
    Array.isArray(report.equityCurve) &&
    report.equityCurve.length > 0 &&
    Array.isArray(report.buyHoldCurve) &&
    report.buyHoldCurve.length > 0 &&
    Array.isArray(report.drawdownCurve) &&
    report.drawdownCurve.length > 0 &&
    Array.isArray(report.monthlyReturns) &&
    Array.isArray(report.trades)
  );
}

function formatTradeDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { day: '2-digit', hour: '2-digit', minute: '2-digit', month: 'short' }).format(new Date(value));
}

function formatTradeDateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', { day: '2-digit', hour: '2-digit', minute: '2-digit', month: 'short', year: '2-digit' }).format(new Date(value));
}

function formatRunDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', hour: '2-digit', minute: '2-digit', month: '2-digit', second: '2-digit' }).format(new Date(value));
}

function formatDuration(start: string, end: string) {
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }

  return `${remainingMinutes}m`;
}

function titleCase(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function formatExitReason(value: BacktestTrade['exitReason']) {
  return value
    .split('-')
    .map((part) => titleCase(part))
    .join(' ');
}

function slugFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'thoon-backtest-report';
}

function buildDistribution(values: number[]) {
  if (!values.length) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const buckets = Array.from({ length: 12 }, () => 0);

  values.forEach((value) => {
    const bucket = Math.min(buckets.length - 1, Math.floor(((value - min) / range) * buckets.length));
    buckets[bucket] += 1;
  });

  return buckets;
}
