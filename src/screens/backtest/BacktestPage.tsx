'use client';

import { AlertTriangle, BarChart3, Bot, CheckCircle2, Database, FileCheck2, FolderOpen, Loader2, MoreHorizontal, Play, RotateCcw, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { PaperTestRecommendationActions } from '../../components/agent/PaperTestRecommendationActions';
import { StrategyAgentDrawer } from '../../components/agent/StrategyAgentDrawer';
import { Badge, Button, Card, EmptyState, HelpPopover } from '../../components/ui';
import { useBinanceLiveMarkets } from '../../hooks/useBinanceLiveMarkets';
import { ApiClientError, postJson } from '../../services/api-client';
import type { MarketPair, Timeframe } from '../../types/market';
import type { AgentReport, AgentRun, AgentSettings, AgentSuggestion, BacktestExecutionSettings, BacktestReport, BacktestTrade, ExchangeConnection, Strategy, StrategyVersion } from '../../types/trading';
import { isResearchOnlyStrategy } from '../../utils/strategy-catalog';
import { formatPercent, formatUsd } from '../../utils/format';

type BacktestPageProps = {
  agentReports: AgentReport[];
  agentRuns: AgentRun[];
  agentSettings: AgentSettings;
  agentSuggestions: AgentSuggestion[];
  agentVersions: StrategyVersion[];
  exchangeConnections: ExchangeConnection[];
  initialPair?: string;
  initialReportId?: string;
  initialStrategyId?: string;
  initialTimeframe?: string;
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

type BacktestPreset = {
  dateRange: string;
  exchangeId: string;
  executionSettings: BacktestExecutionSettings;
  fees: number;
  id: string;
  initialCapital: number;
  savedAt: string;
  slippage: number;
  strategyId: string;
  symbol: string;
  timeframe: Timeframe;
};

const tabs: Array<{ id: BacktestTab; label: string }> = [
  { id: 'trades', label: 'Trades' },
  { id: 'monthly', label: 'Monthly Returns' },
  { id: 'distribution', label: 'Equity Distribution' },
  { id: 'drawdown', label: 'Drawdown' },
  { id: 'analysis', label: 'Chart Analysis' },
];

const backtestPresetStorageKey = 'thoon.backtest.presets.v1';
const timeframes: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w', '1M', '1y'];
const tradesPageSize = 10;
const backtestRangeShortcuts: Array<{ label: string; value: string }> = [
  { label: '1M', value: '30D' },
  { label: '3M', value: '90D' },
  { label: '6M', value: '180D' },
  { label: '1Y', value: '1Y' },
];

function findLatestTrustedBacktest(reports: BacktestReport[]) {
  return listRecentTrustedBacktests(reports)[0];
}

function findDefaultTrustedBacktest(reports: BacktestReport[], settings: AgentSettings) {
  return listRankedTrustedBacktests(reports, settings)[0] ?? findLatestTrustedBacktest(reports);
}

function listRecentTrustedBacktests(reports: BacktestReport[]) {
  return reports
    .filter(isTrustedBacktestReport)
    .sort((left, right) => new Date(right.generatedAt ?? 0).getTime() - new Date(left.generatedAt ?? 0).getTime());
}

function listRankedTrustedBacktests(reports: BacktestReport[], settings: AgentSettings) {
  return listRecentTrustedBacktests(reports)
    .map((report) => ({ report, verdict: assessBacktestPaperReadiness(report, settings) }))
    .sort((left, right) => {
      const eligibilityDelta = Number(right.verdict.eligible) - Number(left.verdict.eligible);

      if (eligibilityDelta !== 0) {
        return eligibilityDelta;
      }

      return right.verdict.score - left.verdict.score || right.report.profitFactor - left.report.profitFactor || right.report.netProfit - left.report.netProfit;
    })
    .map((item) => item.report);
}

export function BacktestPage({ agentReports, agentRuns, agentSettings, agentSuggestions, agentVersions, exchangeConnections, initialPair, initialReportId, initialStrategyId, initialTimeframe, marketPairs, reports: initialReports, strategies }: BacktestPageProps) {
  const { connected: isBinanceLive, pairs: liveMarketPairs } = useBinanceLiveMarkets(marketPairs);
  const requestedReport = initialReportId ? initialReports.find((report) => report.id === initialReportId) : undefined;
  const defaultReport = !requestedReport && !initialStrategyId && !initialPair && !initialTimeframe ? findDefaultTrustedBacktest(initialReports, agentSettings) : undefined;
  const initialReport = requestedReport ?? defaultReport;
  const initialStrategy = strategies.find((strategy) => strategy.id === initialReport?.strategyId) ?? strategies.find((strategy) => strategy.id === initialStrategyId) ?? strategies.find((strategy) => strategy.market === initialPair) ?? strategies[0];
  const initialExecutionSettings = initialReport?.executionSettings ?? defaultBacktestExecutionSettings(initialStrategy);
  const [reports, setReports] = useState(initialReports);
  const [strategyId, setStrategyId] = useState(initialReport?.strategyId ?? initialStrategy?.id ?? '');
  const [symbol, setSymbol] = useState(initialReport?.market ?? initialPair ?? initialStrategy?.market ?? liveMarketPairs[0]?.symbol ?? 'BTC/USDT');
  const [timeframe, setTimeframe] = useState<Timeframe>(normalizeBacktestTimeframe(initialReport?.timeframe ?? initialTimeframe) ?? initialStrategy?.timeframe ?? '15m');
  const [dateRange, setDateRange] = useState(initialReport?.period ?? '90D');
  const [exchangeId, setExchangeId] = useState(initialReport?.exchangeId ?? 'binance');
  const [initialCapital, setInitialCapital] = useState(initialReport?.initialCapital ?? 10000);
  const [fees, setFees] = useState(initialReport?.feesPct ?? 0.06);
  const [slippage, setSlippage] = useState(initialReport?.slippagePct ?? 0.02);
  const [directionMode, setDirectionMode] = useState<BacktestExecutionSettings['directionMode']>(initialExecutionSettings.directionMode);
  const [leverage, setLeverage] = useState(initialExecutionSettings.leverage);
  const [marketType, setMarketType] = useState<BacktestExecutionSettings['marketType']>(initialExecutionSettings.marketType);
  const [positionCapPct, setPositionCapPct] = useState(initialExecutionSettings.positionCapPct);
  const [riskPerTradePct, setRiskPerTradePct] = useState(initialExecutionSettings.riskPerTradePct);
  const [stopLossAtr, setStopLossAtr] = useState(initialExecutionSettings.stopLossAtr);
  const [stopLossEnabled, setStopLossEnabled] = useState(initialExecutionSettings.stopLossEnabled);
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(initialExecutionSettings.takeProfitEnabled);
  const [takeProfitR, setTakeProfitR] = useState(initialExecutionSettings.takeProfitR);
  const [trailingStopAtr, setTrailingStopAtr] = useState(initialExecutionSettings.trailingStopAtr);
  const [trailingStopEnabled, setTrailingStopEnabled] = useState(initialExecutionSettings.trailingStopEnabled);
  const [activeTab, setActiveTab] = useState<BacktestTab>('trades');
  const [runStatus, setRunStatus] = useState('Ready');
  const [runState, setRunState] = useState<BacktestRunState>({ message: '', status: 'idle' });
  const [presets, setPresets] = useState<BacktestPreset[]>([]);
  const [presetPanelOpen, setPresetPanelOpen] = useState(false);
  const [advancedPanelOpen, setAdvancedPanelOpen] = useState(false);

  const strategy = strategies.find((item) => item.id === strategyId) ?? strategies[0];
  const executionSettings = useMemo<BacktestExecutionSettings>(
    () => ({
      directionMode,
      leverage: clampBacktestNumber(leverage, 1, 125, 1),
      marketType,
      positionCapPct: clampBacktestNumber(positionCapPct, 1, 100, 100),
      riskPerTradePct: clampBacktestNumber(riskPerTradePct, 0.01, 10, strategy?.riskPerTrade ?? 1),
      stopLossAtr: clampBacktestNumber(stopLossAtr, 0.1, 20, 1.5),
      stopLossEnabled,
      takeProfitEnabled,
      takeProfitR: clampBacktestNumber(takeProfitR, 0.1, 20, strategy?.riskSettings?.rrTarget ?? 2),
      trailingStopAtr: clampBacktestNumber(trailingStopAtr, 0.1, 20, 2),
      trailingStopEnabled,
    }),
    [directionMode, leverage, marketType, positionCapPct, riskPerTradePct, stopLossAtr, stopLossEnabled, strategy?.riskPerTrade, strategy?.riskSettings?.rrTarget, takeProfitEnabled, takeProfitR, trailingStopAtr, trailingStopEnabled],
  );
  const selectedExchange = exchangeConnections.find((exchange) => exchange.id === exchangeId) ?? exchangeConnections[0];
  const matchingReports = reports.filter((item) => item.strategyId === strategyId && item.source === 'calculated' && item.market === symbol && item.timeframe === timeframe && item.period === dateRange && (item.exchangeId ?? 'binance') === exchangeId && sameReportInputCosts(item, initialCapital, fees, slippage) && sameExecutionSettings(item.executionSettings, executionSettings));
  const report = matchingReports.find((item) => item.id === initialReportId && isTrustedBacktestReport(item)) ?? matchingReports.find(isTrustedBacktestReport);
  const recentTrustedReports = useMemo(() => listRankedTrustedBacktests(reports, agentSettings), [agentSettings, reports]);
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
  const isResearchAdaptation = Boolean(strategy?.agentSource?.sourceId.startsWith('tradingview:'));
  const reportSourceLabel = report
    ? `${reportExchangeName} public candles · ${report.generatedAt ? formatRunDate(report.generatedAt) : 'latest run'}`
    : `${selectedExchange?.name ?? 'Binance'} selected`;
  const paperVerdict = report ? assessBacktestPaperReadiness(report, agentSettings) : undefined;
  const botDraftHref = report ? buildBacktestBotDraftHref(report) : buildBotDraftHrefFromSelection(strategyId, symbol, timeframe);

  useEffect(() => {
    const rawPresets = window.localStorage.getItem(backtestPresetStorageKey);

    if (!rawPresets) {
      return;
    }

    try {
      const parsedPresets = JSON.parse(rawPresets);

      if (Array.isArray(parsedPresets)) {
        setPresets(parsedPresets.filter(isBacktestPreset).slice(0, 8));
      }
    } catch {
      setPresets([]);
    }
  }, []);

  function changeStrategy(nextStrategyId: string) {
    const nextStrategy = strategies.find((item) => item.id === nextStrategyId);
    setStrategyId(nextStrategyId);

    if (nextStrategy) {
      setSymbol(nextStrategy.market);
      setTimeframe(nextStrategy.timeframe);
      applyExecutionSettings(defaultBacktestExecutionSettings(nextStrategy));
    }
  }

  function applyExecutionSettings(settings: BacktestExecutionSettings) {
    setDirectionMode(settings.directionMode);
    setLeverage(settings.leverage);
    setMarketType(settings.marketType);
    setPositionCapPct(settings.positionCapPct);
    setRiskPerTradePct(settings.riskPerTradePct);
    setStopLossAtr(settings.stopLossAtr);
    setStopLossEnabled(settings.stopLossEnabled);
    setTakeProfitEnabled(settings.takeProfitEnabled);
    setTakeProfitR(settings.takeProfitR);
    setTrailingStopAtr(settings.trailingStopAtr);
    setTrailingStopEnabled(settings.trailingStopEnabled);
  }

  function applyPreset(preset: BacktestPreset) {
    setExchangeId(preset.exchangeId);
    setStrategyId(preset.strategyId);
    setSymbol(preset.symbol);
    setTimeframe(preset.timeframe);
    setDateRange(preset.dateRange);
    setInitialCapital(preset.initialCapital);
    setFees(preset.fees);
    setSlippage(preset.slippage);
    applyExecutionSettings(preset.executionSettings);
    setPresetPanelOpen(false);
    setRunStatus('Preset loaded');
  }

  function applyReport(nextReport: BacktestReport) {
    setExchangeId(nextReport.exchangeId ?? 'binance');
    setStrategyId(nextReport.strategyId);
    setSymbol(nextReport.market ?? symbol);
    setTimeframe(normalizeBacktestTimeframe(nextReport.timeframe) ?? timeframe);
    setDateRange(nextReport.period ?? '90D');
    setInitialCapital(nextReport.initialCapital ?? 10000);
    setFees(nextReport.feesPct ?? 0.06);
    setSlippage(nextReport.slippagePct ?? 0.02);
    applyExecutionSettings(nextReport.executionSettings ?? defaultBacktestExecutionSettings(strategies.find((item) => item.id === nextReport.strategyId)));
    setRunStatus(`Loaded verified report · ${nextReport.totalTrades} trades`);
    setRunState({
      finishedAt: new Date().toISOString(),
      kind: 'run',
      message: `${nextReport.id} · ${nextReport.dataWindow?.candleChecksum ?? 'no checksum'}`,
      status: 'success',
    });
  }

  function savePreset() {
    const savedAt = new Date().toISOString();
    const preset: BacktestPreset = {
      dateRange,
      exchangeId,
      executionSettings,
      fees,
      id: `${strategyId}-${symbol}-${timeframe}-${dateRange}-${executionSettings.marketType}-${executionSettings.leverage}x`.replace(/[^a-zA-Z0-9_-]+/g, '-'),
      initialCapital,
      savedAt,
      slippage,
      strategyId,
      symbol,
      timeframe,
    };
    const nextPresets = [preset, ...presets.filter((item) => item.id !== preset.id)].slice(0, 8);

    setPresets(nextPresets);
    window.localStorage.setItem(backtestPresetStorageKey, JSON.stringify(nextPresets));
    setPresetPanelOpen(true);
    setRunStatus('Preset saved');
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
        executionSettings,
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
      const status = isApiError && (error.status === 422 || error.status === 502) ? 'blocked' : 'error';

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
          <Link className="ui-button ui-button--secondary ui-button--sm" href={`/charts?pair=${encodeURIComponent(symbol)}&strategyId=${encodeURIComponent(strategyId)}&timeframe=${encodeURIComponent(timeframe)}`}>
            <span className="ui-button__icon">
              <RotateCcw size={15} />
            </span>
            <span>Paper Trading</span>
          </Link>
          {botDraftHref ? (
            <Link className="ui-button ui-button--ghost ui-button--sm" href={botDraftHref}>
              <span className="ui-button__icon">
                <Bot size={15} />
              </span>
              <span>Create Bot</span>
            </Link>
          ) : (
            <span aria-disabled="true" className="ui-button ui-button--ghost ui-button--sm is-disabled" title="Run a trusted backtest with these exact inputs first.">
              <span className="ui-button__icon">
                <Bot size={15} />
              </span>
              <span>Create Bot</span>
            </span>
          )}
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
            <Button icon={<FolderOpen size={15} />} onClick={() => setPresetPanelOpen((current) => !current)} size="sm" variant="ghost">Load Preset</Button>
            <Button icon={<FileCheck2 size={15} />} onClick={savePreset} size="sm" variant="ghost">Save Preset</Button>
            <Button icon={<MoreHorizontal size={15} />} onClick={() => setAdvancedPanelOpen((current) => !current)} size="sm" variant="ghost">More</Button>
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
                {isResearchOnlyStrategy(item) ? `${item.name} · Thoon concept adaptation` : item.name}
              </option>
            ))}
          </BacktestSelect>
          <button className={advancedPanelOpen ? 'backtest-filter-button is-active' : 'backtest-filter-button'} onClick={() => setAdvancedPanelOpen((current) => !current)} type="button" aria-label="Backtest filters">
            <SlidersHorizontal size={18} />
          </button>
        </div>

        <div className="backtest-execution-grid" aria-label="Execution settings">
          <BacktestSelect label="Market Type" onChange={(value) => setMarketType(value as BacktestExecutionSettings['marketType'])} value={marketType}>
            <option value="perpetual">Perpetual</option>
            <option value="spot">Spot</option>
          </BacktestSelect>
          <BacktestSelect label="Direction" onChange={(value) => setDirectionMode(value as BacktestExecutionSettings['directionMode'])} value={directionMode}>
            <option value="both">Long + Short</option>
            <option value="long-only">Long only</option>
            <option value="short-only">Short only</option>
          </BacktestSelect>
          <BacktestNumberField label="Risk / Trade" onChange={setRiskPerTradePct} suffix="%" value={riskPerTradePct} />
          <BacktestNumberField label="Leverage" onChange={setLeverage} suffix="x" value={leverage} />
          <BacktestNumberField label="Position Cap" onChange={setPositionCapPct} suffix="%" value={positionCapPct} />
          <BacktestNumberField label="Stop Loss" onChange={setStopLossAtr} suffix="ATR" value={stopLossAtr} />
          <BacktestNumberField label="Take Profit" onChange={setTakeProfitR} suffix="R" value={takeProfitR} />
          <BacktestNumberField label="Trailing Stop" onChange={setTrailingStopAtr} suffix="ATR" value={trailingStopAtr} />
          <BacktestToggle checked={stopLossEnabled} label="SL ON" onChange={setStopLossEnabled} />
          <BacktestToggle checked={takeProfitEnabled} label="TP ON" onChange={setTakeProfitEnabled} />
          <BacktestToggle checked={trailingStopEnabled} label="Trail ON" onChange={setTrailingStopEnabled} />
        </div>

        {presetPanelOpen ? (
          <div className="backtest-preset-panel" aria-label="Saved backtest presets">
            {presets.length ? (
              presets.map((preset) => (
                <button key={preset.id} onClick={() => applyPreset(preset)} type="button">
                  <strong>{strategyNameForPreset(strategies, preset.strategyId)}</strong>
                  <span>{preset.symbol} · {preset.timeframe} · {preset.dateRange} · {exchangeNameForPreset(exchangeConnections, preset.exchangeId)}</span>
                  <time dateTime={preset.savedAt}>{formatRunDate(preset.savedAt)}</time>
                </button>
              ))
            ) : (
              <span>No saved presets yet.</span>
            )}
          </div>
        ) : null}

        {advancedPanelOpen ? (
          <div className="backtest-advanced-panel" aria-label="Backtest advanced details">
            <SummaryMetric label="Source" value={strategy?.agentSource?.sourceId ?? 'manual-strategy'} />
            <SummaryMetric label="Exchange" value={selectedExchange?.name ?? exchangeId} />
            <SummaryMetric label="Mode" value={isResearchAdaptation ? 'Thoon concept adaptation' : 'Public candles only'} />
            <SummaryMetric label="Display Rule" value="Trusted runs only" />
            <SummaryMetric label="Execution" value={`${marketType} · ${leverage}x · ${riskPerTradePct}% risk`} />
            <SummaryMetric label="Stops" value={`${stopLossEnabled ? `${stopLossAtr} ATR SL` : 'No SL'} · ${trailingStopEnabled ? `${trailingStopAtr} ATR trail` : 'No trail'}`} />
            <SummaryMetric label="Take Profit" value={takeProfitEnabled ? `${takeProfitR}R` : 'Disabled'} />
            <SummaryMetric label="Direction" value={directionMode.replace('-', ' ')} />
          </div>
        ) : null}

        <div className="backtest-data-strip">
          <span>
            <Database size={14} />
            {reportSourceLabel}
          </span>
          <span>{report ? `${report.candleCount ?? 0} candles` : 'Run required'}</span>
          {report?.dataWindow ? <span>{formatRunDate(report.dataWindow.firstCandleAt)} to {formatRunDate(report.dataWindow.lastCandleAt)}</span> : null}
          {report?.dataWindow ? <span>{report.dataWindow.candleChecksum}</span> : null}
          {report ? <span className="backtest-source-lock">Bot source locked · {report.id} · checksum {report.dataWindow?.candleChecksum?.slice(0, 12) ?? 'missing'}</span> : <span className="backtest-source-lock is-missing">Bot waits for an exact trusted report.</span>}
          <span>{symbol} · {timeframe} · {dateRange}</span>
          <span>{marketType} · {leverage}x · {riskPerTradePct}% risk · {directionMode.replace('-', ' ')}</span>
          <span>{stopLossEnabled ? `SL ${stopLossAtr} ATR` : 'No SL'} · {takeProfitEnabled ? `TP ${takeProfitR}R` : 'No TP'} · {trailingStopEnabled ? `Trail ${trailingStopAtr} ATR` : 'No trail'}</span>
          {isResearchAdaptation ? <span>TradingView concept adapted by Thoon engine.</span> : null}
          {strategies.some(isResearchOnlyStrategy) ? <span>Thoon concept adaptation available for agent research strategies.</span> : null}
          <span>Paper only. Live orders still require Risk Engine confirmation.</span>
        </div>
        {runState.status !== 'idle' ? <BacktestRunStateBanner state={runState} /> : null}
      </Card>

      {!report ? (
        <div className="backtest-empty-grid">
          <EmptyState
            actionLabel="Run Backtest"
            actionOnClick={() => void runBacktest()}
            description={`Selected source: ${selectedExchange?.name ?? 'Binance'} public candles.`}
            icon={<BarChart3 size={20} />}
            secondaryActionHref="/strategies"
            secondaryActionLabel="Strategies"
            title="No calculated report for these inputs"
          />
          {hiddenSeedReports > 0 ? (
            <Card className="backtest-source-note">
              <strong>Legacy reports hidden</strong>
              <span>{hiddenSeedReports} legacy report{hiddenSeedReports > 1 ? 's are' : ' is'} no longer shown as real data. Run a backtest to calculate from exchange candles.</span>
            </Card>
          ) : null}
          {hiddenInvalidReports > 0 ? (
            <Card className="backtest-source-note">
              <strong>Older reports hidden</strong>
              <span>{hiddenInvalidReports} calculated report{hiddenInvalidReports > 1 ? 's are' : ' is'} missing full candle provenance or chart series. Run again to create a trusted report.</span>
            </Card>
          ) : null}
          <RecentBacktestReports reports={recentTrustedReports} strategies={strategies} onLoad={applyReport} />
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
              <SummaryMetric label="Leverage" value={`${report.executionSettings?.leverage ?? leverage}x`} />
              <SummaryMetric label="Risk / Trade" value={`${report.executionSettings?.riskPerTradePct ?? riskPerTradePct}%`} />
            </div>
          </Card>

          {paperVerdict ? (
            <Card className="backtest-agent-paper-card">
              <div className="backtest-panel-head">
                <div>
                <h2>Agent Paper Proposal</h2>
                  <span>{paperVerdict.reason}</span>
                </div>
                <Badge tone={paperVerdict.tone}>{paperVerdict.score}/100</Badge>
              </div>
              <div className="backtest-agent-paper-grid">
                <SummaryMetric label="Decision" tone={paperVerdict.tone} value={paperVerdict.label} />
                <SummaryMetric label="Rule" tone={paperVerdict.winrateRulePassed ? 'positive' : 'warning'} value={paperVerdict.winrateRulePassed ? 'Winrate OK' : 'Winrate blocked'} />
                <SummaryMetric label="Evidence" tone={paperVerdict.evidenceScore >= 20 ? 'positive' : 'warning'} value={`${paperVerdict.evidenceScore}/20`} />
                <SummaryMetric label="Checksum" value={report.dataWindow?.candleChecksum?.slice(0, 12) ?? 'missing'} />
              </div>
              <div className="backtest-agent-paper-copy">
                <strong>{paperVerdict.eligible ? 'Recommended for live paper only' : 'Not recommended for paper yet'}</strong>
                <span>{paperVerdict.usagePlan}</span>
              </div>
              {paperVerdict.eligible ? <PaperTestRecommendationActions reportId={report.id} strategyId={report.strategyId} /> : null}
            </Card>
          ) : null}

          <RecentBacktestReports reports={recentTrustedReports} selectedReportId={report.id} strategies={strategies} onLoad={applyReport} />

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
              <SummaryMetric label="Execution" value={`${report.executionSettings?.marketType ?? marketType} · ${report.executionSettings?.directionMode?.replace('-', ' ') ?? directionMode.replace('-', ' ')}`} />
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
            <Link className="ui-button ui-button--ghost" href={`/charts?pair=${encodeURIComponent(symbol)}&strategyId=${encodeURIComponent(strategyId)}&timeframe=${encodeURIComponent(timeframe)}`}>
              <span className="ui-button__icon"><RotateCcw size={15} /></span>
              <span>Paper Trading</span>
            </Link>
            {botDraftHref ? (
              <Link className="ui-button ui-button--ghost" href={botDraftHref}>
                <span className="ui-button__icon"><Bot size={15} /></span>
                <span>Create Bot</span>
              </Link>
            ) : null}
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

function RecentBacktestReports({ onLoad, reports, selectedReportId, strategies }: { onLoad: (report: BacktestReport) => void; reports: BacktestReport[]; selectedReportId?: string; strategies: Strategy[] }) {
  if (!reports.length) {
    return (
      <Card className="backtest-recent-card">
        <div className="backtest-panel-head">
          <div>
            <h2>Best Verified Backtests</h2>
            <span>No trusted calculated report saved yet.</span>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="backtest-recent-card">
      <div className="backtest-panel-head">
        <div>
          <h2>Best Verified Backtests</h2>
          <span>Ranked from strongest to weakest. Loading keeps the exact source candles and execution settings.</span>
        </div>
        <Badge tone="positive">{reports.length} ready</Badge>
      </div>
      <div className="backtest-recent-list">
        {reports.slice(0, 10).map((item) => {
          const strategyName = strategies.find((strategy) => strategy.id === item.strategyId)?.name ?? item.strategyId;

          return (
            <button className={`backtest-recent-item${selectedReportId === item.id ? ' is-selected' : ''}`} key={item.id} onClick={() => onLoad(item)} type="button">
              <span className="backtest-recent-item__main">
                <strong>{strategyName}</strong>
                <small>{item.market} · {item.timeframe} · {item.period} · {item.marketDataSource} · {item.candleCount ?? 0} candles · {item.dataWindow?.candleChecksum ?? 'checksum missing'}</small>
              </span>
              <span className="backtest-recent-item__metrics">
                <em className={item.profitFactor >= 1 ? 'positive' : 'negative'}>{item.profitFactor.toFixed(2)} PF</em>
                <em>{item.winRate.toFixed(1)}% WR</em>
                <em>{item.totalTrades} trades</em>
                <em className="negative">{item.drawdown.toFixed(1)}% DD</em>
                <em className={item.netProfit >= 0 ? 'positive' : 'negative'}>{formatUsd(item.netProfit)}</em>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function isBacktestPreset(value: unknown): value is BacktestPreset {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const preset = value as Partial<BacktestPreset>;

  return (
    typeof preset.dateRange === 'string' &&
    typeof preset.exchangeId === 'string' &&
    isBacktestExecutionSettings(preset.executionSettings) &&
    typeof preset.fees === 'number' &&
    typeof preset.id === 'string' &&
    typeof preset.initialCapital === 'number' &&
    typeof preset.savedAt === 'string' &&
    typeof preset.slippage === 'number' &&
    typeof preset.strategyId === 'string' &&
    typeof preset.symbol === 'string' &&
    typeof preset.timeframe === 'string'
  );
}

function isBacktestExecutionSettings(value: unknown): value is BacktestExecutionSettings {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const settings = value as Partial<BacktestExecutionSettings>;

  return (
    (settings.directionMode === 'both' || settings.directionMode === 'long-only' || settings.directionMode === 'short-only') &&
    (settings.marketType === 'perpetual' || settings.marketType === 'spot') &&
    typeof settings.leverage === 'number' &&
    typeof settings.positionCapPct === 'number' &&
    typeof settings.riskPerTradePct === 'number' &&
    typeof settings.stopLossAtr === 'number' &&
    typeof settings.stopLossEnabled === 'boolean' &&
    typeof settings.takeProfitEnabled === 'boolean' &&
    typeof settings.takeProfitR === 'number' &&
    typeof settings.trailingStopAtr === 'number' &&
    typeof settings.trailingStopEnabled === 'boolean'
  );
}

function strategyNameForPreset(strategies: Strategy[], strategyId: string) {
  return strategies.find((strategy) => strategy.id === strategyId)?.name ?? strategyId;
}

function exchangeNameForPreset(exchanges: ExchangeConnection[], exchangeId: string) {
  return exchanges.find((exchange) => exchange.id === exchangeId)?.name ?? exchangeId;
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

function BacktestToggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <button aria-pressed={checked} className={`backtest-toggle${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)} type="button">
      <span>{label}</span>
    </button>
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
        <SummaryMetric label="Leverage" value={`${trade.leverage ?? 1}x`} />
        <SummaryMetric label="Margin" value={formatUsd(trade.margin ?? trade.entry * trade.size)} />
        <SummaryMetric label="Stop" value={trade.stop ? formatUsd(trade.stop) : 'Disabled'} />
        <SummaryMetric label="Take Profit" value={trade.takeProfit ? formatUsd(trade.takeProfit) : 'Disabled'} />
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
    isTrustedBacktestEngine(report.engine) &&
    Boolean(report.dataWindow?.candleChecksum) &&
    Boolean(report.dataWindow?.firstCandleAt) &&
    Boolean(report.dataWindow?.lastCandleAt) &&
    Number.isFinite(report.candleCount) &&
    isBacktestExecutionSettings(report.executionSettings) &&
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

function isTrustedBacktestEngine(engine: BacktestReport['engine']) {
  return engine === 'jimmy-pine-v5-candle-engine' || engine === 'thoon-concept-candle-engine';
}

function assessBacktestPaperReadiness(report: BacktestReport, settings: AgentSettings) {
  const profitable = report.netProfit > 0 && report.profitFactor > 1;
  const winrateRulePassed = profitable && (report.winRate >= 80 || report.winRate < 50);
  const enoughTrades = report.totalTrades >= settings.limits.minTrades;
  const drawdownOk = Math.abs(report.drawdown) <= settings.limits.maxDrawdownCandidate;
  const profitFactorOk = report.profitFactor >= settings.limits.minProfitFactor;
  const evidenceScore =
    (report.source === 'calculated' ? 4 : 0) +
    (report.marketDataSource === 'binance-live' || Boolean(report.marketDataSource?.endsWith('-public-rest')) ? 4 : 0) +
    (report.dataWindow?.candleChecksum ? 4 : 0) +
    (report.executionSettings ? 4 : 0) +
    (Array.isArray(report.equityCurve) && report.equityCurve.length > 0 ? 4 : 0);
  const profitScore = profitable ? Math.min(25, 8 + report.profitFactor * 7 + Math.max(0, Math.min(8, report.netProfit / 10))) : 0;
  const winrateScore = winrateRulePassed ? 20 : profitable ? 7 : 0;
  const drawdownScore = Math.max(0, 20 - (Math.abs(report.drawdown) / Math.max(settings.limits.maxDrawdownCandidate, 1)) * 20);
  const sampleScore = Math.min(15, (report.totalTrades / Math.max(settings.limits.minTrades, 1)) * 15);
  let score = Math.round(evidenceScore + profitScore + winrateScore + drawdownScore + sampleScore);

  if (!profitable) {
    score = Math.min(score, 49);
  } else if (!winrateRulePassed) {
    score = Math.min(score, 69);
  } else if (!enoughTrades || !drawdownOk || !profitFactorOk || evidenceScore < 20) {
    score = Math.min(score, 79);
  }

  const eligible = profitable && winrateRulePassed && enoughTrades && drawdownOk && profitFactorOk && evidenceScore >= 20;
  const label = eligible ? 'paper_test' : profitable ? 'watch' : 'do_not_use';

  return {
    eligible,
    evidenceScore,
    label,
    reason: eligible ? 'Ready for live paper trading in Charts, not live automation.' : profitable ? 'Promising, but at least one paper gate is still blocked.' : 'Not worth paper trading from current evidence.',
    score: Math.max(0, Math.min(100, score)),
    tone: eligible ? ('positive' as const) : profitable ? ('warning' as const) : ('negative' as const),
    usagePlan: eligible
      ? `Open Charts in paper mode on ${report.market ?? 'tested market'} ${report.timeframe ?? 'tested timeframe'} with ${report.executionSettings?.marketType ?? 'market'} execution and ${report.executionSettings?.riskPerTradePct ?? 0}% risk per trade.`
      : 'Continue backtesting or let the agent create a stronger variant.',
    winrateRulePassed,
  };
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

function defaultBacktestExecutionSettings(strategy?: Strategy): BacktestExecutionSettings {
  return {
    directionMode: 'both',
    leverage: 3,
    marketType: 'perpetual',
    positionCapPct: 100,
    riskPerTradePct: clampBacktestNumber(strategy?.riskPerTrade ?? 1, 0.01, 10, 1),
    stopLossAtr: clampBacktestNumber(firstNumber(strategy?.riskSettings?.stopLoss), 0.1, 20, 1.5),
    stopLossEnabled: strategy?.riskSettings?.stopRequired ?? true,
    takeProfitEnabled: true,
    takeProfitR: clampBacktestNumber(strategy?.riskSettings?.rrTarget ?? 2, 0.1, 20, 2),
    trailingStopAtr: clampBacktestNumber(trailingAtrDefault(strategy?.riskSettings?.takeProfit), 0.1, 20, 2),
    trailingStopEnabled: strategy?.riskSettings?.trailingStop ?? true,
  };
}

function buildBacktestBotDraftHref(report: BacktestReport) {
  const params = new URLSearchParams({
    reportId: report.id,
    strategyId: report.strategyId,
  });

  if (report.market) {
    params.set('pair', report.market);
  }

  if (report.timeframe) {
    params.set('timeframe', report.timeframe);
  }

  return `/bots/new?${params.toString()}`;
}

function buildBotDraftHrefFromSelection(strategyId: string, symbol: string, timeframe: Timeframe) {
  const params = new URLSearchParams({
    strategyId,
    pair: symbol,
    timeframe,
  });

  return `/bots/new?${params.toString()}`;
}

function normalizeBacktestTimeframe(value: string | undefined): Timeframe | undefined {
  return timeframes.includes(value as Timeframe) ? (value as Timeframe) : undefined;
}

function sameReportInputCosts(report: BacktestReport, initialCapital: number, fees: number, slippage: number) {
  return sameBacktestNumber(report.initialCapital ?? 10000, initialCapital) && sameBacktestNumber(report.feesPct ?? 0.06, fees) && sameBacktestNumber(report.slippagePct ?? 0.02, slippage);
}

function sameBacktestNumber(left: number, right: number) {
  return Math.abs(left - right) < 0.0001;
}

function sameExecutionSettings(left: BacktestExecutionSettings | undefined, right: BacktestExecutionSettings) {
  if (!left) {
    return false;
  }

  return (
    left.directionMode === right.directionMode &&
    left.marketType === right.marketType &&
    left.stopLossEnabled === right.stopLossEnabled &&
    left.takeProfitEnabled === right.takeProfitEnabled &&
    left.trailingStopEnabled === right.trailingStopEnabled &&
    Math.abs(left.leverage - right.leverage) < 0.0001 &&
    Math.abs(left.positionCapPct - right.positionCapPct) < 0.0001 &&
    Math.abs(left.riskPerTradePct - right.riskPerTradePct) < 0.0001 &&
    Math.abs(left.stopLossAtr - right.stopLossAtr) < 0.0001 &&
    Math.abs(left.takeProfitR - right.takeProfitR) < 0.0001 &&
    Math.abs(left.trailingStopAtr - right.trailingStopAtr) < 0.0001
  );
}

function firstNumber(value: string | undefined) {
  const parsed = Number(value?.match(/(\d+(?:\.\d+)?)/)?.[1]);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function trailingAtrDefault(value: string | undefined) {
  const explicitAtr =
    value?.match(/(?:trail(?:ing)?(?:\s+stop)?\s*)?(\d+(?:\.\d+)?)\s*x?\s*atr/i)?.[1] ??
    value?.match(/atr\s*(\d+(?:\.\d+)?)x/i)?.[1] ??
    value?.match(/trail(?:ing)?(?:\s+stop)?\s*(\d+(?:\.\d+)?)\s*x/i)?.[1];
  const parsed = explicitAtr ? Number(explicitAtr) : undefined;

  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampBacktestNumber(value: number | undefined, min: number, max: number, fallback: number) {
  const nextValue = typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  return Math.min(max, Math.max(min, nextValue));
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
