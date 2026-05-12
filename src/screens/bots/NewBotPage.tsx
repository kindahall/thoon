'use client';

import { Play, Save, ShieldAlert, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { Badge, Button, Card, ErrorState, HelpPopover, Modal, Toggle } from '../../components/ui';
import { useBinanceLiveMarkets } from '../../hooks/useBinanceLiveMarkets';
import { patchJson, postJson } from '../../services/api-client';
import { evaluateRiskEngine, type RiskEngineIssue } from '../../services/risk-engine';
import { getTradingErrorDefinition } from '../../services/trading-error-service';
import type { MarketPair } from '../../types/market';
import type { BacktestReport, Bot as TradingBot, BotLog, ExchangeConnection, RiskRules, Strategy, TradeLimits } from '../../types/trading';
import { formatUsd } from '../../utils/format';

type NewBotPageProps = {
  backtestReports: BacktestReport[];
  botLogs: BotLog[];
  exchanges: ExchangeConnection[];
  initialBot?: TradingBot;
  initialPair?: string;
  initialReportId?: string;
  initialStrategyId?: string;
  initialTimeframe?: string;
  marketPairs: MarketPair[];
  riskRules: RiskRules;
  strategies: Strategy[];
  tradeLimits: TradeLimits;
};

type BotMode = 'paper' | 'live';
type BotStatusDraft = TradingBot['status'];
type BotMutation = Pick<TradingBot, 'allocatedCapital' | 'exchange' | 'mode' | 'name' | 'riskPerTrade' | 'status' | 'strategyId' | 'symbol'> &
  Pick<
    TradingBot,
    | 'sourceBacktestPeriod'
    | 'sourceBacktestReportId'
    | 'sourceCandleChecksum'
    | 'sourceExchangeId'
    | 'sourceExchangeName'
    | 'sourceExecutionSettings'
    | 'sourceFeesPct'
    | 'sourceInitialCapital'
    | 'sourceMarketDataSource'
    | 'sourceSlippagePct'
    | 'sourceTimeframe'
  >;

export function NewBotPage({ backtestReports: initialBacktestReports, botLogs, exchanges, initialBot, initialPair, initialReportId, initialStrategyId, initialTimeframe, marketPairs, riskRules, strategies, tradeLimits }: NewBotPageProps) {
  const router = useRouter();
  const { connected: isBinanceLive, pairs: liveMarketPairs } = useBinanceLiveMarkets(marketPairs);
  const requestedReport = initialReportId ? initialBacktestReports.find((report) => report.id === initialReportId) : undefined;
  const initialStrategy = strategies.find((strategy) => strategy.id === initialBot?.strategyId) ?? strategies.find((strategy) => strategy.id === requestedReport?.strategyId) ?? strategies.find((strategy) => strategy.id === initialStrategyId) ?? strategies.find((strategy) => strategy.market === initialPair) ?? strategies[0];
  const initialMarket = initialBot?.symbol ?? requestedReport?.market ?? initialPair ?? initialStrategy?.market ?? liveMarketPairs[0]?.symbol ?? 'BTC/USDT';
  const [botName, setBotName] = useState(initialBot?.name ?? `${initialMarket.split('/')[0]} ${initialStrategy?.type ?? 'Trend'} Bot`);
  const [strategyId, setStrategyId] = useState(initialBot?.strategyId ?? initialStrategy?.id ?? '');
  const [exchangeId, setExchangeId] = useState(exchanges.find((exchange) => exchange.name === initialBot?.exchange)?.id ?? exchanges.find((exchange) => exchange.status === 'connected')?.id ?? exchanges[0]?.id ?? 'paper');
  const [market, setMarket] = useState(initialMarket);
  const [mode, setMode] = useState<BotMode>(initialBot?.mode ?? 'paper');
  const [status, setStatus] = useState<BotStatusDraft>(initialBot?.status ?? 'draft');
  const [allocatedCapital, setAllocatedCapital] = useState(initialBot?.allocatedCapital ?? 10000);
  const [riskPerTrade, setRiskPerTrade] = useState(initialBot?.riskPerTrade ?? Math.min(1, riskRules.maxRiskPerTrade));
  const [maxDailyLoss, setMaxDailyLoss] = useState(riskRules.dailyLossLimit);
  const [maxLeverage, setMaxLeverage] = useState(Math.min(10, riskRules.maxLeverage));
  const [maxConcurrentTrades, setMaxConcurrentTrades] = useState(Math.min(3, tradeLimits.maxOpenPositions));
  const [schedule, setSchedule] = useState('24/7');
  const [entrySource, setEntrySource] = useState('Strategy signals');
  const [stopOnDrawdown, setStopOnDrawdown] = useState(true);
  const [requireStopLoss, setRequireStopLoss] = useState(riskRules.blockOrdersWithoutStop);
  const [launchState, setLaunchState] = useState('Draft ready');
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [backtestReports, setBacktestReports] = useState(initialBacktestReports);
  const [sourceReportId, setSourceReportId] = useState(initialBot?.sourceBacktestReportId ?? requestedReport?.id ?? '');

  const strategy = strategies.find((item) => item.id === strategyId) ?? strategies[0];
  const exchange = exchanges.find((item) => item.id === exchangeId) ?? exchanges[0];
  const selectedPair = liveMarketPairs.find((pair) => pair.symbol === market);
  const visibleBotLogs = useMemo(() => (initialBot ? botLogs.filter((log) => log.botId === initialBot.id) : []), [botLogs, initialBot]);
  const selectedSourceReport = useMemo(
    () => backtestReports.find((report) => report.id === sourceReportId) ?? findBestBotSourceReport(backtestReports, strategyId, market, normalizeBotTimeframe(initialTimeframe) ?? strategy?.timeframe),
    [backtestReports, initialTimeframe, market, sourceReportId, strategy?.timeframe, strategyId],
  );
  const validationGate = useMemo(
    () => buildBotValidationGate(backtestReports, strategyId, market, selectedSourceReport?.timeframe ?? normalizeBotTimeframe(initialTimeframe) ?? strategy?.timeframe, riskRules, selectedSourceReport?.id),
    [backtestReports, initialTimeframe, market, riskRules, selectedSourceReport?.id, selectedSourceReport?.timeframe, strategy?.timeframe, strategyId],
  );
  const launchBlockedByValidation = validationGate.status === 'blocked';
  const riskResult = useMemo(
    () =>
      evaluateRiskEngine({
        action: mode === 'live' ? 'launch-live-bot' : 'create-bot',
        bot: {
          allocatedCapital,
          drawdownPercent: strategy?.performance30d && strategy.performance30d < 0 ? Math.abs(strategy.performance30d) : 0,
          maxLeverage,
          riskPerTrade,
        },
        exchange,
        mode,
        order: {
          accountBalance: allocatedCapital,
          availableBalance: allocatedCapital,
          dailyLossPercent: 0,
          entry: selectedPair?.lastPrice ?? 1,
          leverage: maxLeverage,
          marginRequired: allocatedCapital / Math.max(maxLeverage, 1),
          openPositions: 0,
          ordersToday: visibleBotLogs.length,
          riskPercent: riskPerTrade,
          stopLoss: requireStopLoss ? (selectedPair?.lastPrice ?? 1) * 0.98 : undefined,
          symbol: market,
          weeklyLossPercent: 0,
        },
        riskRules,
        tradeLimits,
      }),
    [allocatedCapital, exchange, market, maxLeverage, mode, requireStopLoss, riskPerTrade, riskRules, selectedPair?.lastPrice, strategy?.performance30d, tradeLimits, visibleBotLogs.length],
  );
  const liveBlockers = riskResult.blockers;
  const launchDisabled = launchBlockedByValidation || (mode === 'live' && liveBlockers.length > 0);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/backtests')
      .then((response) => (response.ok ? response.json() : undefined))
      .then((reports: BacktestReport[] | undefined) => {
        if (!cancelled && Array.isArray(reports)) {
          setBacktestReports(reports);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  function changeStrategy(nextStrategyId: string) {
    const nextStrategy = strategies.find((item) => item.id === nextStrategyId);
    setStrategyId(nextStrategyId);

    if (nextStrategy) {
      setMarket(nextStrategy.market);
      setBotName(`${nextStrategy.market.split('/')[0]} ${formatStrategyType(nextStrategy.type)} Bot`);
      setSourceReportId(findBestBotSourceReport(backtestReports, nextStrategy.id, nextStrategy.market, nextStrategy.timeframe)?.id ?? '');
    }
  }

  function changeMarket(nextMarket: string) {
    setMarket(nextMarket);
    setSourceReportId(findBestBotSourceReport(backtestReports, strategyId, nextMarket, selectedSourceReport?.timeframe ?? normalizeBotTimeframe(initialTimeframe) ?? strategy?.timeframe)?.id ?? '');
  }

  function patchBot(botId: string, payload: BotMutation) {
    return patchJson<TradingBot>(`/api/bots/${encodeURIComponent(botId)}`, payload);
  }

  function buildBotPayload(nextStatus: BotStatusDraft, nextMode = mode): BotMutation {
    const sourceReport = validationGate.report;

    return {
      allocatedCapital,
      exchange: exchange?.name ?? (nextMode === 'live' ? 'Live' : 'Paper'),
      mode: nextMode,
      name: botName,
      riskPerTrade,
      sourceBacktestPeriod: sourceReport?.period,
      sourceBacktestReportId: sourceReport?.id,
      sourceCandleChecksum: sourceReport?.dataWindow?.candleChecksum,
      sourceExchangeId: sourceReport?.exchangeId,
      sourceExchangeName: sourceReport?.exchangeName,
      sourceExecutionSettings: sourceReport?.executionSettings,
      sourceFeesPct: sourceReport?.feesPct,
      sourceInitialCapital: sourceReport?.initialCapital,
      sourceMarketDataSource: sourceReport?.marketDataSource,
      sourceSlippagePct: sourceReport?.slippagePct,
      sourceTimeframe: sourceReport?.timeframe,
      status: nextStatus,
      strategyId,
      symbol: market,
    };
  }

  async function saveDraft() {
    setStatus('draft');
    setLaunchState('Saving draft');

    try {
      const payload = buildBotPayload('draft');
      const bot = initialBot ? await patchBot(initialBot.id, payload) : await postJson<TradingBot>('/api/bots', payload);
      setLaunchState('Draft saved');
      router.push(`/bots/${bot.id}`);
      router.refresh();
    } catch (error) {
      setLaunchState(error instanceof Error ? error.message : 'Save failed');
    }
  }

  async function launchBot() {
    if (launchBlockedByValidation) {
      setLaunchState(validationGate.title);
      return;
    }

    if (mode === 'live') {
      setConfirmationOpen(true);
      setLaunchState(liveBlockers.length ? 'Live blockers' : 'Live confirmation required');
      return;
    }

    setLaunchState('Launching paper');

    try {
      const payload = buildBotPayload('running', 'paper');
      const bot = initialBot ? await patchBot(initialBot.id, payload) : await postJson<TradingBot>('/api/bots', payload);
      setLaunchState('Paper bot running');
      router.push(`/bots/${bot.id}`);
      router.refresh();
    } catch (error) {
      setLaunchState(error instanceof Error ? error.message : 'Launch failed');
    }
  }

  async function confirmLiveBot() {
    if (liveBlockers.length > 0) {
      return;
    }

    setLaunchState('Launching live');

    try {
      const payload = buildBotPayload('running', 'live');
      const bot = initialBot ? await patchBot(initialBot.id, payload) : await postJson<TradingBot>('/api/bots', payload);
      setConfirmationOpen(false);
      setLaunchState('Live bot launched');
      router.push(`/bots/${bot.id}`);
      router.refresh();
    } catch (error) {
      setLaunchState(error instanceof Error ? error.message : 'Live launch failed');
    }
  }

  return (
    <section className="new-bot-page" aria-label="Create bot">
      <div className="workspace-header workspace-header--compact">
        <div>
          <h1>{initialBot ? 'Edit Bot' : 'Create Bot'}</h1>
          <p>Configure your bot, define risk rules, and launch with confidence.</p>
        </div>
        <div className="workspace-header__right">
          <Button icon={<Save size={15} />} onClick={saveDraft} size="sm" variant="ghost">
            Save Draft
          </Button>
          <Button disabled={launchDisabled} icon={<Play size={15} />} onClick={launchBot} size="sm" variant="primary">
            Launch Bot
          </Button>
          <HelpPopover items={['Live launch requires a confirmation step.', 'Disconnected exchanges block live launch.']} title="Create Bot" />
        </div>
      </div>

      <div className="bot-builder-layout">
        <div className="bot-builder-main">
          <Card className="bot-identity-card">
            <BotField label="Bot Name">
              <input onChange={(event) => setBotName(event.target.value)} value={botName} />
            </BotField>
            <BotField label="Strategy">
              <select onChange={(event) => changeStrategy(event.target.value)} value={strategyId}>
                {strategies.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </BotField>
            <BotField label="Exchange">
              <select onChange={(event) => setExchangeId(event.target.value)} value={exchangeId}>
                {exchanges.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.status}
                  </option>
                ))}
              </select>
            </BotField>
            <BotField label="Market / Pair">
              <select onChange={(event) => changeMarket(event.target.value)} value={market}>
                {liveMarketPairs.map((pair) => (
                  <option key={pair.symbol} value={pair.symbol}>
                    {pair.symbol}
                  </option>
                ))}
              </select>
            </BotField>
          </Card>

          <Card className="bot-config-card">
            <div className="bot-config-head">
              <div>
                <h2>Bot Configuration</h2>
                <span>{launchState}</span>
              </div>
              <Badge tone={mode === 'live' ? 'warning' : 'primary'}>{mode}</Badge>
              <Badge tone={isBinanceLive ? 'positive' : 'warning'}>{isBinanceLive ? 'Binance live' : 'Local fallback'}</Badge>
            </div>

            <div className="bot-mode-status">
              <div className="bot-mode-switch" aria-label="Mode">
                <button className={mode === 'paper' ? 'is-active' : undefined} onClick={() => setMode('paper')} type="button">
                  Paper
                </button>
                <button className={mode === 'live' ? 'is-active' : undefined} onClick={() => setMode('live')} type="button">
                  Live
                </button>
              </div>
              <BotField label="Status">
                <select onChange={(event) => setStatus(event.target.value as BotStatusDraft)} value={status}>
                  <option value="draft">Draft</option>
                  <option value="running">Running</option>
                  <option value="paused">Paused</option>
                  <option value="stopped">Stopped</option>
                </select>
              </BotField>
            </div>

            <div className="bot-config-grid">
              <BotNumberField label="Allocated Capital" onChange={setAllocatedCapital} suffix="USDT" value={allocatedCapital} />
              <BotNumberField label="Risk Per Trade" onChange={setRiskPerTrade} suffix="%" value={riskPerTrade} />
              <BotNumberField label="Max Daily Loss" onChange={setMaxDailyLoss} suffix="%" value={maxDailyLoss} />
              <BotNumberField label="Leverage Max" onChange={setMaxLeverage} suffix="x" value={maxLeverage} />
              <BotNumberField label="Max Concurrent Trades" onChange={setMaxConcurrentTrades} suffix="trades" value={maxConcurrentTrades} />
              <BotField label="Schedule / Active Hours">
                <select onChange={(event) => setSchedule(event.target.value)} value={schedule}>
                  <option>24/7</option>
                  <option>London + New York</option>
                  <option>Asia Session</option>
                  <option>Manual Window</option>
                </select>
              </BotField>
              <BotField label="Entry Source">
                <select onChange={(event) => setEntrySource(event.target.value)} value={entrySource}>
                  <option>Strategy signals</option>
                  <option>Saved setup</option>
                  <option>Webhook signal</option>
                </select>
              </BotField>
            </div>

            <div className="bot-safety-toggles">
              <Toggle checked={stopOnDrawdown} label="Stop Bot on Drawdown" onClick={() => setStopOnDrawdown((current) => !current)} />
              <Toggle checked={requireStopLoss} label="Require Stop-Loss on All Trades" onClick={() => setRequireStopLoss((current) => !current)} />
            </div>

            <BotValidationGateCard gate={validationGate} strategyId={strategyId} symbol={market} />
            <BotSourceReferenceCard report={validationGate.report} />

            {liveBlockers.length ? (
              <div className="bot-builder-warning">
                <ShieldAlert size={17} />
                <span>{liveBlockers.map((blocker) => blocker.message).join(' · ')}</span>
              </div>
            ) : (
              <div className="bot-builder-safe">
                <ShieldCheck size={17} />
                <span>{riskResult.warnings.length ? `${riskResult.warnings.length} warning checks` : 'Risk checks ready.'}</span>
              </div>
            )}
          </Card>

          <Card className="bot-events-card">
            <div className="bot-events-head">
              <h2>Recent Events</h2>
              <span>{visibleBotLogs.length} latest</span>
            </div>
            <div className="bot-events-table">
              <div className="bot-events-table__head">
                <span>Time</span>
                <span>Event</span>
                <span>Details</span>
                <span>Status</span>
              </div>
              {visibleBotLogs.map((log) => (
                <div className="bot-event-row" key={log.id}>
                  <span>{formatLogTime(log.time)}</span>
                  <strong>{log.level}</strong>
                  <span>{log.message}</span>
                  <Badge tone={log.level === 'error' ? 'negative' : log.level === 'warning' ? 'warning' : 'positive'}>{log.level}</Badge>
                </div>
              ))}
              {visibleBotLogs.length === 0 ? (
                <div className="bot-event-row bot-event-row--empty">
                  <span>-</span>
                  <strong>idle</strong>
                  <span>No event for this bot yet.</span>
                  <Badge>empty</Badge>
                </div>
              ) : null}
            </div>
          </Card>
        </div>

        <Card className="bot-build-preview-card">
          <div className="bot-preview-title">
            <div>
              <h2>Bot Preview</h2>
              <span>{botName}</span>
            </div>
            <Badge tone={status === 'draft' ? 'warning' : 'neutral'}>{status}</Badge>
          </div>

          <div className="bot-preview-stack">
            <PreviewItem label="Behavior" tone="positive" value={formatStrategyType(strategy?.type ?? 'trend')} />
            <PreviewItem label="Exchange" tone={exchange?.status === 'connected' ? 'positive' : 'negative'} value={exchange?.name ?? 'Paper'} />
            <PreviewItem label="Strategy" value={strategy?.name ?? '-'} />
            <PreviewItem label="Market / Pair" value={market} />
            <PreviewItem label="Mode" tone={mode === 'live' ? 'warning' : 'primary'} value={mode === 'paper' ? 'Paper Trading' : 'Live Trading'} />
            <PreviewItem label="Allocated Capital" value={formatUsd(allocatedCapital)} />
            <PreviewItem label="Risk Per Trade" value={`${riskPerTrade}%`} />
            <PreviewItem label="Max Daily Loss" value={`${maxDailyLoss}%`} />
            <PreviewItem label="Max Concurrent Trades" value={String(maxConcurrentTrades)} />
            <PreviewItem label="Leverage Max" value={`${maxLeverage}x`} />
            <PreviewItem label="Schedule" value={schedule} />
            <PreviewItem label="Entry Source" value={entrySource} />
            <PreviewItem label="Stop-Loss" tone={requireStopLoss ? 'positive' : 'warning'} value={requireStopLoss ? 'Required' : 'Warning'} />
            <PreviewItem label="Validation" tone={validationGate.status === 'passed' ? 'positive' : validationGate.status === 'warning' ? 'warning' : 'negative'} value={validationGate.badge} />
            <PreviewItem label="Source Report" tone={validationGate.report ? 'positive' : 'negative'} value={validationGate.report?.id ?? 'Missing'} />
            <PreviewItem label="Source TF" value={validationGate.report?.timeframe ?? strategy?.timeframe ?? '-'} />
            <PreviewItem label="Source Period" value={validationGate.report?.period ?? '-'} />
            <PreviewItem label="Source Fees" value={validationGate.report ? `${validationGate.report.feesPct ?? 0}% / ${validationGate.report.slippagePct ?? 0}% slip` : '-'} />
            <PreviewItem label="Checksum" tone={validationGate.report?.dataWindow?.candleChecksum ? 'positive' : 'negative'} value={validationGate.report?.dataWindow?.candleChecksum?.slice(0, 12) ?? 'missing'} />
            <PreviewItem label="Pair Price" value={formatUsd(selectedPair?.lastPrice ?? 0)} />
          </div>

          <div className="bot-builder-actions">
            <Button disabled={launchDisabled} icon={<Play size={15} />} onClick={launchBot} variant="primary">
              Launch Bot
            </Button>
            <Button icon={<Save size={15} />} onClick={saveDraft} variant="ghost">
              Save Draft
            </Button>
          </div>
        </Card>
      </div>

      <Modal onClose={() => setConfirmationOpen(false)} open={confirmationOpen} title="Confirm Live Bot">
        <div className="live-bot-modal">
          <div className="live-bot-warning">
            <ShieldAlert size={18} />
            <span>Live trading. Risk engine confirmation required.</span>
          </div>

          {liveBlockers.length > 0 ? <LiveBotError blockers={liveBlockers} onCancel={() => setConfirmationOpen(false)} /> : null}

          <div className="live-bot-grid">
            <LiveBotItem label="Bot name" value={botName} />
            <LiveBotItem label="Strategy" value={strategy?.name ?? '-'} />
            <LiveBotItem label="Exchange" value={exchange?.name ?? '-'} />
            <LiveBotItem label="Pair" value={market} />
            <LiveBotItem label="Mode" value="Live" />
            <LiveBotItem label="Allocated capital" value={formatUsd(allocatedCapital)} />
            <LiveBotItem label="Risk / trade" value={`${riskPerTrade}%`} />
            <LiveBotItem label="Max daily loss" value={`${maxDailyLoss}%`} />
            <LiveBotItem label="Max leverage" value={`${maxLeverage}x`} />
            <LiveBotItem label="Stop-loss" tone={requireStopLoss ? 'positive' : 'negative'} value={requireStopLoss ? 'Required' : 'Missing'} />
            <LiveBotItem label="Daily / weekly" value={`${riskRules.dailyLossLimit}% / ${riskRules.weeklyLossLimit}%`} />
            <LiveBotItem label="API permission" tone={exchange?.permissions.includes('trade') ? 'positive' : 'negative'} value={exchange?.permissions.includes('trade') ? 'Trade enabled' : 'No trade'} />
          </div>

          <div className="live-bot-blockers">
            {liveBlockers.length ? liveBlockers.map((blocker) => <span key={blocker.id}>{blocker.message}</span>) : <span className="positive">No blockers</span>}
          </div>

          <div className="live-bot-actions">
            <Button onClick={() => setConfirmationOpen(false)} variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={liveBlockers.length > 0}
              onClick={confirmLiveBot}
              variant="primary"
            >
              Confirm Launch Live Bot
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function LiveBotError({ blockers, onCancel }: { blockers: RiskEngineIssue[]; onCancel: () => void }) {
  const firstBlocker = blockers[0];
  const error = getTradingErrorDefinition(firstBlocker?.errorCode ?? 'order-rejected');

  return (
    <ErrorState
      actionHref={error.href}
      actionLabel={error.primaryActionLabel}
      cancelLabel="Cancel"
      description={error.reason}
      details={[
        { label: 'Blocker', tone: 'negative', value: firstBlocker?.message ?? 'Live blocker' },
        { label: 'Current', tone: 'warning', value: firstBlocker?.detail ?? 'Blocked' },
        { label: 'Fix', value: error.correctiveAction },
      ]}
      onCancel={onCancel}
      title={error.title}
    />
  );
}

type BotValidationGate = {
  badge: string;
  detail: string;
  issues: string[];
  report?: BacktestReport;
  status: 'blocked' | 'passed' | 'warning';
  title: string;
};

function BotValidationGateCard({ gate, strategyId, symbol }: { gate: BotValidationGate; strategyId: string; symbol: string }) {
  const tone = gate.status === 'passed' ? 'positive' : gate.status === 'warning' ? 'warning' : 'negative';
  const backtestHref = `/backtest?strategyId=${encodeURIComponent(strategyId)}&pair=${encodeURIComponent(symbol)}`;

  return (
    <div className={`bot-validation-gate is-${gate.status}`}>
      <div className="bot-validation-gate__head">
        <div>
          <span>Validation Gate</span>
          <strong>{gate.title}</strong>
        </div>
        <Badge tone={tone}>{gate.badge}</Badge>
      </div>
      <p>{gate.detail}</p>
      {gate.report ? (
        <div className="bot-validation-gate__metrics">
          <PreviewItem label="Period" value={gate.report.period} />
          <PreviewItem label="Trades" value={String(gate.report.totalTrades)} />
          <PreviewItem label="Profit Factor" tone={gate.report.profitFactor >= 1 ? 'positive' : 'negative'} value={`${gate.report.profitFactor.toFixed(2)} PF`} />
          <PreviewItem label="Net PnL" tone={gate.report.netProfit >= 0 ? 'positive' : 'negative'} value={formatUsd(gate.report.netProfit)} />
          <PreviewItem label="Max Drawdown" tone={gate.report.drawdown <= -8 ? 'negative' : 'neutral'} value={`${gate.report.drawdown.toFixed(2)}%`} />
        </div>
      ) : null}
      <div className="bot-validation-gate__issues">
        {gate.issues.map((issue) => (
          <span key={issue}>{issue}</span>
        ))}
      </div>
      <Link className="bot-validation-gate__link" href={backtestHref}>
        Open Backtest
      </Link>
    </div>
  );
}

function BotSourceReferenceCard({ report }: { report?: BacktestReport }) {
  if (!report) {
    return (
      <div className="bot-source-reference is-missing">
        <strong>Exact Source Reference</strong>
        <span>No verified source report is attached yet.</span>
      </div>
    );
  }

  return (
    <div className="bot-source-reference">
      <strong>Exact Source Reference</strong>
      <span>Report {report.id}</span>
      <span>{report.market ?? '-'} · {report.timeframe ?? '-'} · {report.marketDataSource ?? 'source'} · {report.candleCount ?? 0} candles</span>
      <span>Exchange {report.exchangeName ?? report.exchangeId ?? 'unknown'} · Period {report.period} · Capital {formatUsd(report.initialCapital ?? 0)}</span>
      <span>Fees {report.feesPct ?? 0}% · Slippage {report.slippagePct ?? 0}%</span>
      <span>Checksum {report.dataWindow?.candleChecksum ?? 'missing'}</span>
      <span>{formatBotExecutionSettings(report.executionSettings)}</span>
    </div>
  );
}

function buildBotValidationGate(reports: BacktestReport[], strategyId: string, symbol: string, timeframe: Strategy['timeframe'] | undefined, riskRules: RiskRules, sourceReportId?: string): BotValidationGate {
  const requestedSourceReport = sourceReportId
    ? reports.find((report) => report.id === sourceReportId && report.source === 'calculated' && report.strategyId === strategyId && report.market === symbol)
    : undefined;

  if (sourceReportId && !requestedSourceReport) {
    return {
      badge: 'BLOCKED',
      detail: 'The selected bot source report is missing or does not match this exact strategy and pair.',
      issues: ['Select the report used by the agent, or rerun the exact backtest.'],
      status: 'blocked',
      title: 'Source mismatch',
    };
  }

  const matchingReports = reports
    .filter((report) => report.source === 'calculated' && report.strategyId === strategyId && report.market === symbol && (!timeframe || report.timeframe === timeframe))
    .sort((left, right) => {
      const rightDays = periodDays(right.period);
      const leftDays = periodDays(left.period);

      if (rightDays !== leftDays) {
        return rightDays - leftDays;
      }

      return new Date(right.generatedAt ?? '').getTime() - new Date(left.generatedAt ?? '').getTime();
    });
  const outOfSampleReport = requestedSourceReport ?? matchingReports.find((report) => periodDays(report.period) >= 90) ?? matchingReports[0];

  if (!outOfSampleReport) {
    return {
      badge: 'BLOCKED',
      detail: 'No calculated backtest is available for this exact strategy and pair.',
      issues: ['Run at least a 90D backtest before launching a bot.'],
      status: 'blocked',
      title: 'Backtest required',
    };
  }

  const issues: string[] = [];
  const warnings: string[] = [];
  const maxAllowedDrawdown = Math.max(1, riskRules.stopBotsAtDrawdown);

  if (periodDays(outOfSampleReport.period) < 90) {
    issues.push('Needs 90D+ out-of-sample data.');
  }

  if (outOfSampleReport.totalTrades < 30) {
    issues.push('Needs at least 30 trades.');
  }

  if (outOfSampleReport.profitFactor < 1.15) {
    issues.push(`Profit factor ${outOfSampleReport.profitFactor.toFixed(2)} is below 1.15.`);
  }

  if (outOfSampleReport.netProfit <= 0) {
    issues.push(`Net PnL is ${formatUsd(outOfSampleReport.netProfit)}.`);
  }

  if (Math.abs(outOfSampleReport.drawdown) > maxAllowedDrawdown) {
    issues.push(`Drawdown ${outOfSampleReport.drawdown.toFixed(2)}% is beyond ${maxAllowedDrawdown}%.`);
  }

  if (outOfSampleReport.totalTrades < 60) {
    warnings.push('Sample is still small.');
  }

  if (outOfSampleReport.profitFactor < 1.4) {
    warnings.push('Profit factor is not strong enough for promotion.');
  }

  if (issues.length > 0) {
    return {
      badge: 'BLOCKED',
      detail: 'This strategy failed the bot launch gate. Save a draft if needed, but do not run it.',
      issues,
      report: outOfSampleReport,
      status: 'blocked',
      title: 'Launch blocked',
    };
  }

  if (warnings.length > 0) {
    return {
      badge: 'WATCH',
      detail: 'Paper launch is possible, but this bot should stay under close monitoring.',
      issues: warnings,
      report: outOfSampleReport,
      status: 'warning',
      title: 'Paper only',
    };
  }

  return {
    badge: 'READY',
    detail: 'Out-of-sample backtest clears the launch gate for paper validation.',
    issues: ['Paper validation only. Live still requires exchange and Risk Engine confirmation.'],
    report: outOfSampleReport,
    status: 'passed',
    title: 'Paper ready',
  };
}

function findBestBotSourceReport(reports: BacktestReport[], strategyId: string, symbol: string, timeframe: Strategy['timeframe'] | undefined) {
  return reports
    .filter((report) => report.source === 'calculated' && report.strategyId === strategyId && report.market === symbol && (!timeframe || report.timeframe === timeframe))
    .sort((left, right) => {
      const rightScore = right.profitFactor * 20 + right.winRate + right.totalTrades / 4 + Math.max(0, right.netProfit / 20) - Math.abs(right.drawdown);
      const leftScore = left.profitFactor * 20 + left.winRate + left.totalTrades / 4 + Math.max(0, left.netProfit / 20) - Math.abs(left.drawdown);

      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }

      return new Date(right.generatedAt ?? '').getTime() - new Date(left.generatedAt ?? '').getTime();
    })[0];
}

function normalizeBotTimeframe(value: string | undefined): Strategy['timeframe'] | undefined {
  return value === '1m' || value === '5m' || value === '15m' || value === '30m' || value === '1h' || value === '2h' || value === '4h' || value === '1d' || value === '1w' || value === '1M' || value === '1y' ? value : undefined;
}

function formatBotExecutionSettings(settings: BacktestReport['executionSettings']) {
  if (!settings) {
    return 'Execution settings missing';
  }

  return `${settings.marketType} · ${settings.directionMode} · ${settings.riskPerTradePct}% risk · ${settings.leverage}x leverage · SL ${settings.stopLossEnabled ? `${settings.stopLossAtr} ATR` : 'off'} · TP ${settings.takeProfitEnabled ? `${settings.takeProfitR}R` : 'off'}`;
}

function periodDays(period: string) {
  const parsed = Number(period.match(/(\d+)\s*D/i)?.[1]);

  return Number.isFinite(parsed) ? parsed : 0;
}

function BotField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="bot-builder-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function BotNumberField({ label, onChange, suffix, value }: { label: string; onChange: (value: number) => void; suffix: string; value: number }) {
  return (
    <label className="bot-builder-number-field">
      <span>{label}</span>
      <div>
        <input onChange={(event) => onChange(Number(event.target.value))} step="0.01" type="number" value={value} />
        <small>{suffix}</small>
      </div>
    </label>
  );
}

function PreviewItem({ label, tone = 'neutral', value }: { label: string; tone?: 'neutral' | 'primary' | 'positive' | 'negative' | 'warning'; value: string }) {
  return (
    <div className="bot-preview-item">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function LiveBotItem({ label, tone = 'neutral', value }: { label: string; tone?: 'neutral' | 'positive' | 'negative' | 'warning'; value: string }) {
  return (
    <div className="live-bot-item">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function formatStrategyType(type: Strategy['type']) {
  switch (type) {
    case 'mean-reversion':
      return 'Mean Reversion';
    case 'breakout':
      return 'Breakout';
    case 'trend':
      return 'Trend Following';
    case 'grid':
      return 'Grid';
  }
}

function formatLogTime(value: string) {
  return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
