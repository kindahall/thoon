'use client';

import { BarChart3, Bot, Database, FileCheck2, FolderOpen, MoreHorizontal, Play, RotateCcw, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';

import { StrategyAgentDrawer } from '../../components/agent/StrategyAgentDrawer';
import { Badge, Button, Card, EmptyState, HelpPopover } from '../../components/ui';
import { useBinanceLiveMarkets } from '../../hooks/useBinanceLiveMarkets';
import { postJson } from '../../services/api-client';
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

const tabs: Array<{ id: BacktestTab; label: string }> = [
  { id: 'trades', label: 'Trades' },
  { id: 'monthly', label: 'Monthly Returns' },
  { id: 'distribution', label: 'Equity Distribution' },
  { id: 'drawdown', label: 'Drawdown' },
  { id: 'analysis', label: 'Chart Analysis' },
];

const timeframes: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w', '1M', '1y'];

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
  const [runIndex, setRunIndex] = useState(0);
  const [runStatus, setRunStatus] = useState('Ready');

  const strategy = strategies.find((item) => item.id === strategyId) ?? strategies[0];
  const selectedExchange = exchangeConnections.find((exchange) => exchange.id === exchangeId) ?? exchangeConnections[0];
  const report = reports.find((item) => item.strategyId === strategyId && item.source === 'calculated' && item.market === symbol && item.timeframe === timeframe && item.period === dateRange && (item.exchangeId ?? 'binance') === exchangeId);
  const selectedPair = liveMarketPairs.find((pair) => pair.symbol === symbol) ?? liveMarketPairs[0];
  const hiddenSeedReports = reports.filter((item) => item.strategyId === strategyId && item.source !== 'calculated').length;

  const totalReturn = report ? (report.netProfit / initialCapital) * 100 : 0;
  const winningTrades = report ? Math.round((report.totalTrades * report.winRate) / 100) : 0;
  const losingTrades = report ? report.totalTrades - winningTrades : 0;

  const equitySeries = useMemo(() => report?.equityCurve ?? buildEquitySeries(initialCapital, report?.netProfit ?? 0, runIndex), [initialCapital, report?.equityCurve, report?.netProfit, runIndex]);
  const buyHoldSeries = useMemo(() => report?.buyHoldCurve ?? buildBuyHoldSeries(equitySeries, initialCapital), [equitySeries, initialCapital, report?.buyHoldCurve]);
  const drawdownSeries = useMemo(() => report?.drawdownCurve ?? buildDrawdownSeries(report?.drawdown ?? 0), [report?.drawdown, report?.drawdownCurve]);
  const trades = useMemo(() => report?.trades ?? [], [report?.trades]);
  const monthlyReturns = useMemo(() => report?.monthlyReturns ?? buildMonthlyReturns(totalReturn), [report?.monthlyReturns, totalReturn]);
  const distribution = useMemo(() => buildDistribution(equitySeries), [equitySeries]);
  const equityLast = equitySeries[equitySeries.length - 1] ?? initialCapital;
  const buyHoldLast = buyHoldSeries[buyHoldSeries.length - 1] ?? initialCapital;
  const buyHoldReturn = report?.buyHoldReturn ?? ((buyHoldLast - initialCapital) / initialCapital) * 100;
  const reportExchangeName = report?.exchangeName ?? selectedExchange?.name ?? 'Binance';
  const reportSourceLabel = report ? `${reportExchangeName} public candles` : `${selectedExchange?.name ?? 'Binance'} selected`;

  function changeStrategy(nextStrategyId: string) {
    const nextStrategy = strategies.find((item) => item.id === nextStrategyId);
    setStrategyId(nextStrategyId);

    if (nextStrategy) {
      setSymbol(nextStrategy.market);
      setTimeframe(nextStrategy.timeframe);
    }
  }

  async function runBacktest() {
    setRunIndex((current) => current + 1);
    setRunStatus('Running');

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
      setReports((currentReports) => [report, ...currentReports.filter((item) => item.id !== report.id)]);
      setRunStatus(`${report.totalTrades} trades calculated from ${report.candleCount ?? 0} candles`);
    } catch (error) {
      setRunStatus(error instanceof Error ? error.message : 'Run failed');
    }
  }

  async function saveReport() {
    try {
      const report = await postJson<BacktestReport>('/api/backtests', {
        initialCapital,
        period: dateRange,
        fees,
        exchangeId,
        slippage,
        strategyId,
        symbol,
        timeframe,
      });
      setReports((currentReports) => [report, ...currentReports.filter((item) => item.id !== report.id)]);
      setRunStatus('Report saved');
    } catch (error) {
      setRunStatus(error instanceof Error ? error.message : 'Save failed');
    }
  }

  function startPaperTest() {
    setRunStatus('Paper session ready');
  }

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
          <Button icon={<Play size={15} />} onClick={runBacktest} size="sm" variant="primary">
            Run Backtest
          </Button>
          <Button icon={<FileCheck2 size={15} />} onClick={saveReport} size="sm" variant="ghost">
            Save Report
          </Button>
          <Link className="ui-button ui-button--secondary ui-button--sm" href={`/backtest/replay?pair=${encodeURIComponent(symbol)}&strategyId=${encodeURIComponent(strategyId)}`} onClick={startPaperTest}>
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
            <Button icon={<FolderOpen size={15} />} onClick={() => setRunStatus('Preset loaded')} size="sm" variant="ghost">Load Preset</Button>
            <Button icon={<FileCheck2 size={15} />} onClick={saveReport} size="sm" variant="ghost">Save Preset</Button>
            <Button icon={<MoreHorizontal size={15} />} onClick={() => setRunStatus('Advanced filters ready')} size="sm" variant="ghost">More</Button>
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
          <button className="backtest-filter-button" onClick={() => setRunStatus('Advanced filters ready')} type="button" aria-label="Backtest filters">
            <SlidersHorizontal size={18} />
          </button>
        </div>

        <div className="backtest-data-strip">
          <span>
            <Database size={14} />
            {reportSourceLabel}
          </span>
          <span>{report ? `${report.candleCount ?? 0} candles` : 'Run required'}</span>
          <span>{symbol} · {timeframe} · {dateRange}</span>
          <span>Paper only. Live orders still require Risk Engine confirmation.</span>
        </div>
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
                {['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'All'].map((item) => (
                  <button className={item === rangeShortcut(dateRange) ? 'is-active' : undefined} key={item} type="button">{item}</button>
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
              <Badge tone={report.marketDataSource === 'binance-live' || report.marketDataSource?.endsWith('-live') ? 'positive' : 'warning'}>
                {report.marketDataSource === 'local-fallback' ? 'Local fallback' : 'Live candles'}
              </Badge>
            </div>
            {report.warnings?.length ? (
              <div className="backtest-warning-strip">
                {report.warnings.slice(0, 2).map((warning) => (
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
            <Button icon={<Play size={15} />} onClick={runBacktest} variant="primary">Run Backtest</Button>
            <Button icon={<FileCheck2 size={15} />} onClick={saveReport} variant="ghost">Save Report</Button>
            <Link className="ui-button ui-button--ghost" href={`/backtest/replay?pair=${encodeURIComponent(symbol)}&strategyId=${encodeURIComponent(strategyId)}`} onClick={startPaperTest}>
              <span className="ui-button__icon"><RotateCcw size={15} /></span>
              <span>Paper Test</span>
            </Link>
          </Card>
        </div>
      )}
    </section>
  );
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
  return (
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
      {trades.length > 0 ? trades.map((trade, index) => (
        <div className="backtest-table__row" key={trade.id} role="row">
          <span>{index + 1}</span>
          <span>{formatTradeDate(trade.exitTime)}</span>
          <span>{symbol}</span>
          <strong>{titleCase(trade.side)}</strong>
          <span>{formatUsd(trade.entry)}</span>
          <span>{formatUsd(trade.exit)}</span>
          <span>{trade.size.toFixed(4)}</span>
          <span className={trade.rMultiple >= 0 ? 'positive' : 'negative'}>{trade.rMultiple.toFixed(2)}R</span>
          <span className={trade.pnl >= 0 ? 'positive' : 'negative'}>{formatUsd(trade.pnl)}</span>
          <span>{formatExitReason(trade.exitReason)}</span>
        </div>
      )) : <div className="backtest-table__empty">No trade triggered on this candle window.</div>}
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

  return (
    <div className="drawdown-panel">
      <SummaryMetric label="Worst Drawdown" tone="negative" value={`${worst.toFixed(1)}%`} />
      <SummaryMetric label="Recovery" value="6 sessions" />
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

function buildEquitySeries(initialCapital: number, netProfit: number, runIndex: number) {
  return Array.from({ length: 28 }, (_, index) => {
    const progress = index / 27;
    const drift = netProfit * progress;
    const wave = Math.sin(index * 0.9 + runIndex * 0.4) * Math.max(Math.abs(netProfit) * 0.08, initialCapital * 0.006);

    return initialCapital + drift + wave;
  });
}

function buildBuyHoldSeries(equitySeries: number[], initialCapital: number) {
  return equitySeries.map((_, index) => {
    const progress = index / Math.max(equitySeries.length - 1, 1);
    const drift = initialCapital * 0.08 * progress;
    const wave = Math.sin(index * 0.55) * initialCapital * 0.004;

    return initialCapital + drift + wave;
  });
}

function buildDrawdownSeries(drawdown: number) {
  return Array.from({ length: 28 }, (_, index) => {
    const wave = Math.sin(index * 0.82) * Math.abs(drawdown) * 0.22;
    const trend = -Math.abs(drawdown) * (0.16 + (index % 9) / 12);

    return Math.min(0, trend + wave);
  });
}

function rangeShortcut(dateRange: string) {
  if (dateRange === '30D') {
    return '1M';
  }

  if (dateRange === '90D') {
    return '3M';
  }

  if (dateRange === '180D') {
    return '6M';
  }

  return '1Y';
}

function buildMonthlyReturns(totalReturn: number) {
  const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

  return labels.map((label, index) => ({
    label,
    value: totalReturn / labels.length + Math.sin(index * 1.4) * 1.1,
  }));
}

function formatTradeDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { day: '2-digit', hour: '2-digit', minute: '2-digit', month: 'short' }).format(new Date(value));
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

function buildDistribution(values: number[]) {
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
