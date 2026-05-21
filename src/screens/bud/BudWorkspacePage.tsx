'use client';

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  BrainCircuit,
  CheckCircle2,
  CircleStop,
  FlaskConical,
  History,
  LineChart,
  Pencil,
  Play,
  RefreshCcw,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { Badge, Button, Card } from '../../components/ui';
import { useBinanceLiveMarkets } from '../../hooks/useBinanceLiveMarkets';
import { apiJson, postJson } from '../../services/api-client';
import type { MarketDataStatus, MarketPair } from '../../types/market';
import { formatCompactUsd, formatPercent, formatUsd } from '../../utils/format';

export type BudWorkspaceKind = 'agents' | 'alerts' | 'backtest' | 'bots' | 'history' | 'orders' | 'strategies' | 'watchlist';

type BudWorkspacePageProps = {
  initialPairs?: MarketPair[];
  initialStatus?: MarketDataStatus;
  page: BudWorkspaceKind;
};

type JsonRecord = Record<string, unknown>;

type BudEnvelope<T> = {
  detail?: string;
  error?: string;
  payload?: T;
  receivedAt?: string;
  source?: string;
  status?: number;
};

type StrategyDraft = {
  conditions: JsonRecord;
  metadata: JsonRecord;
  name: string;
  parentStrategyId?: string;
  params: Record<string, number | string | boolean>;
  regimeTags: string[];
  status: string;
  strategyId?: string;
  strategyType: string;
  versionId?: string;
};

type StrategyParamField = {
  key: string;
  label: string;
  max?: number;
  min: number;
  step?: number;
};

const defaultMarketStatus: MarketDataStatus = {
  baseUrl: 'binance',
  live: false,
  pairCount: 0,
  provider: 'binance',
  updatedAt: new Date(0).toISOString(),
  warnings: [],
};

const pageMeta: Record<BudWorkspaceKind, { badge: string; icon: typeof BrainCircuit; title: string }> = {
  agents: { badge: 'Bud orchestration', icon: BrainCircuit, title: 'Agents' },
  alerts: { badge: 'Risk alerts', icon: ShieldAlert, title: 'Alerts' },
  backtest: { badge: 'Real candles', icon: BarChart3, title: 'Backtest' },
  bots: { badge: 'Guarded launch', icon: Bot, title: 'Bots' },
  history: { badge: 'Paper/live records', icon: History, title: 'History' },
  orders: { badge: 'Execution desk', icon: WalletCards, title: 'Orders' },
  strategies: { badge: 'Research registry', icon: Sparkles, title: 'Strategies' },
  watchlist: { badge: 'Binance live', icon: LineChart, title: 'Watchlist' },
};

const symbols = ['BTCUSDT', 'ETHUSDT', 'ONDOUSDT', 'SOLUSDT', 'BNBUSDT'];
const intervals = ['15m', '30m', '1h', '4h', '1d', '1w'];
const readinessExchanges = ['binance', 'bybit', 'bitget', 'hyperliquid', 'dydx'];
const strategyTypes = ['sma_cross', 'ema_trend', 'donchian_breakout', 'rsi_mean_reversion', 'bollinger_reversion', 'momentum_volatility', 'volume_breakout'];
const strategyStatuses = ['candidate', 'active', 'retired'];
const regimeOptions = ['bull_market', 'bear_market', 'high_volatility', 'low_liquidity'];
const strategyParamFields: Record<string, StrategyParamField[]> = {
  bollinger_reversion: [
    { key: 'bollinger_window', label: 'Window', min: 3, max: 500 },
    { key: 'bollinger_std', label: 'Std', min: 0.5, max: 5, step: 0.1 },
  ],
  donchian_breakout: [
    { key: 'donchian_window', label: 'Breakout', min: 3, max: 500 },
    { key: 'donchian_exit_window', label: 'Exit', min: 2, max: 500 },
  ],
  ema_trend: [
    { key: 'fast_window', label: 'Fast', min: 2, max: 500 },
    { key: 'slow_window', label: 'Slow', min: 3, max: 1000 },
  ],
  momentum_volatility: [
    { key: 'momentum_window', label: 'Momentum', min: 2, max: 500 },
    { key: 'volatility_window', label: 'Volatility', min: 3, max: 500 },
    { key: 'min_momentum', label: 'Min Mom', min: -1, max: 1, step: 0.001 },
    { key: 'max_volatility', label: 'Max Vol', min: 0.001, max: 1, step: 0.001 },
  ],
  rsi_mean_reversion: [
    { key: 'rsi_window', label: 'RSI', min: 2, max: 200 },
    { key: 'rsi_lower', label: 'Lower', min: 1, max: 60, step: 0.5 },
    { key: 'rsi_upper', label: 'Upper', min: 40, max: 99, step: 0.5 },
  ],
  sma_cross: [
    { key: 'fast_window', label: 'Fast', min: 2, max: 500 },
    { key: 'slow_window', label: 'Slow', min: 3, max: 1000 },
  ],
  volume_breakout: [
    { key: 'fast_window', label: 'Fast', min: 2, max: 500 },
    { key: 'slow_window', label: 'Slow', min: 3, max: 1000 },
    { key: 'volume_window', label: 'Volume', min: 2, max: 500 },
    { key: 'volume_multiplier', label: 'Volume x', min: 0.1, max: 10, step: 0.05 },
  ],
};

export function BudWorkspacePage({ initialPairs = [], initialStatus = defaultMarketStatus, page }: BudWorkspacePageProps) {
  const meta = pageMeta[page];
  const Icon = meta.icon;
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('1h');
  const [limit, setLimit] = useState(page === 'backtest' || page === 'strategies' ? 240 : 120);
  const [quantity, setQuantity] = useState(0.001);
  const [statusData, setStatusData] = useState<JsonRecord | null>(null);
  const [executionData, setExecutionData] = useState<JsonRecord | null>(null);
  const [paperData, setPaperData] = useState<JsonRecord | null>(null);
  const [readinessData, setReadinessData] = useState<JsonRecord | null>(null);
  const [killSwitchData, setKillSwitchData] = useState<JsonRecord | null>(null);
  const [researchData, setResearchData] = useState<JsonRecord | null>(null);
  const [deterministicAgentData, setDeterministicAgentData] = useState<JsonRecord | null>(null);
  const [hedgeFundData, setHedgeFundData] = useState<JsonRecord | null>(null);
  const [paperBotTestData, setPaperBotTestData] = useState<JsonRecord | null>(null);
  const [resultData, setResultData] = useState<JsonRecord | null>(null);
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState('');

  useEffect(() => {
    void refreshStatus();

    if (page === 'orders' || page === 'history') {
      void refreshTradingState();
    }

    if (page === 'alerts') {
      void refreshKillSwitch();
    }

    if (page === 'strategies' || page === 'history') {
      void loadResearch();
    }

    if (page === 'strategies') {
      void loadDeterministicAgents();
    }

    if (page === 'strategies' || page === 'bots') {
      void refreshHedgeFundReadiness();
    }

    if (page === 'bots' || page === 'history') {
      void loadPaperBotTests();
    }
  }, [page, symbol]);

  async function runAction<T extends JsonRecord>(label: string, request: () => Promise<T>) {
    setPendingAction(label);
    setError('');

    try {
      const response = await request();
      const payload = unwrapBudPayload(response);
      setResultData(asRecord(payload));
      return payload;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `${label} failed`);
      return null;
    } finally {
      setPendingAction('');
    }
  }

  async function refreshStatus() {
    try {
      setStatusData(asRecord(await apiJson<JsonRecord>('/api/bud/status')));
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Bud status unavailable');
    }
  }

  async function refreshTradingState() {
    setPendingAction('refresh-trading');
    setError('');

    try {
      const [execution, paper] = await Promise.all([
        apiJson<JsonRecord>(`/api/bud/execution?mode=paper&symbol=${encodeURIComponent(symbol)}`),
        apiJson<JsonRecord>(`/api/bud/paper?symbol=${encodeURIComponent(symbol)}&limit=80`),
      ]);
      setExecutionData(asRecord(unwrapBudPayload(execution)));
      setPaperData(asRecord(unwrapBudPayload(paper)));
    } catch (tradingError) {
      setError(tradingError instanceof Error ? tradingError.message : 'Trading state unavailable');
    } finally {
      setPendingAction('');
    }
  }

  async function refreshKillSwitch() {
    try {
      setKillSwitchData(asRecord(unwrapBudPayload(await apiJson<JsonRecord>('/api/bud/kill-switch'))));
    } catch (killError) {
      setError(killError instanceof Error ? killError.message : 'Kill switch status unavailable');
    }
  }

  async function loadResearch() {
    setPendingAction('load-research');
    setError('');

    try {
      setResearchData(asRecord(unwrapBudPayload(await apiJson<JsonRecord>('/api/bud/research?limit=25'))));
    } catch (researchError) {
      setResearchData(null);
      setError(researchError instanceof Error ? researchError.message : 'Research registry unavailable');
    } finally {
      setPendingAction('');
    }
  }

  async function loadDeterministicAgents() {
    try {
      setDeterministicAgentData(asRecord(readPath(await apiJson<JsonRecord>('/api/strategy-agents/deterministic'), ['payload'])));
    } catch (agentError) {
      setError(agentError instanceof Error ? agentError.message : 'Deterministic strategy agents unavailable');
    }
  }

  async function runDeterministicAgents() {
    const payload = await runAction('deterministic-agents', () =>
      postJson<JsonRecord>('/api/strategy-agents/deterministic', {
        limit: 3,
        queryLimit: 2,
      }),
    );

    if (payload) {
      setDeterministicAgentData(asRecord(payload));
      void loadResearch();
      void refreshHedgeFundReadiness();
    }
  }

  async function refreshHedgeFundReadiness() {
    try {
      setHedgeFundData(asRecord(unwrapBudPayload(await apiJson<JsonRecord>('/api/bud/hedge-fund-readiness'))));
    } catch (readinessError) {
      setError(readinessError instanceof Error ? readinessError.message : 'Hedge fund readiness unavailable');
    }
  }

  async function loadPaperBotTests() {
    try {
      setPaperBotTestData(asRecord(unwrapBudPayload(await apiJson<JsonRecord>('/api/bud/paper-bot-test'))));
    } catch (paperBotError) {
      setError(paperBotError instanceof Error ? paperBotError.message : 'Paper bot tests unavailable');
    }
  }

  async function startTwoHourPaperBot() {
    const payload = await runAction('paper-bot-2h', () =>
      postJson<JsonRecord>('/api/bud/paper-bot-test', {
        durationMinutes: 120,
        quantity,
        symbol,
      }),
    );

    if (payload) {
      setPaperBotTestData(asRecord(payload));
      void loadPaperBotTests();
      void refreshTradingState();
      void refreshHedgeFundReadiness();
    }
  }

  async function runOrchestration() {
    await runAction('orchestrate', () =>
      postJson<JsonRecord>('/api/bud/orchestrate', {
        include_fred: true,
        interval,
        limit: Math.min(Math.max(limit, 60), 500),
        symbol,
      }),
    );
  }

  async function runMacro() {
    await runAction('macro', () =>
      postJson<JsonRecord>('/api/bud/macro', {
        interval,
        limit: Math.max(limit, 240),
        symbols: [symbol, 'ETHUSDT'],
      }),
    );
  }

  async function runPortfolio() {
    await runAction('portfolio', () =>
      postJson<JsonRecord>('/api/bud/portfolio', {
        interval,
        limit: Math.max(limit, 240),
        max_weight: 0.45,
        regime: 'neutral',
        symbols: [symbol, 'ETHUSDT', 'ONDOUSDT'],
      }),
    );
  }

  async function runArbitrage() {
    await runAction('arbitrage', () =>
      postJson<JsonRecord>('/api/bud/arbitrage', {
        max_opportunities: 8,
        symbols: [symbol, 'ETHUSDT'],
        target_notional: 250,
      }),
    );
  }

  async function runBacktest() {
    await runAction('backtest', () =>
      postJson<JsonRecord>('/api/bud/backtest', {
        interval,
        limit: Math.max(limit, 240),
        symbol,
        validate_data_quality: true,
        walk_forward_validate: true,
      }),
    );
  }

  async function runResearch() {
    const payload = await runAction('research', () =>
      postJson<JsonRecord>('/api/bud/research', {
        exchange: 'binance',
        force_new_generation: false,
        interval,
        limit: Math.max(limit, 240),
        max_candidates: 10,
        symbol,
        top_n: 5,
      }),
    );

    if (payload) {
      void loadResearch();
      void refreshHedgeFundReadiness();
    }
  }

  async function saveResearchStrategy(strategy: StrategyDraft) {
    const payload = await runAction('save-strategy', () => postJson<JsonRecord>('/api/bud/research/strategy', strategyInputFromDraft(strategy)));

    if (payload) {
      void loadResearch();
      void refreshHedgeFundReadiness();
    }
  }

  async function backtestResearchStrategy(strategy: StrategyDraft) {
    await runAction('strategy-backtest', () =>
      postJson<JsonRecord>('/api/bud/backtest', {
        estimate_transaction_costs: true,
        interval,
        limit: Math.max(limit, 240),
        reject_if_walk_forward_fails: false,
        strategy: backtestStrategyFromDraft(strategy),
        symbol,
        validate_data_quality: true,
        walk_forward_validate: true,
      }),
    );
  }

  async function checkReadiness() {
    const payload = await runAction('readiness', () =>
      postJson<JsonRecord>('/api/bud/live-readiness', {
        exchanges: readinessExchanges,
        min_paper_trades: 1,
        paper_symbol: symbol,
        symbols: [symbol, 'ETHUSDT'],
      }),
    );

    if (payload) {
      setReadinessData(asRecord(payload));
      void refreshHedgeFundReadiness();
    }
  }

  async function placePaper(side: 'buy' | 'sell') {
    await runAction(`paper-${side}`, () =>
      postJson<JsonRecord>('/api/bud/paper', {
        quantity,
        side,
        symbol,
      }),
    );
    await refreshTradingState();
  }

  async function triggerKillSwitch() {
    const payload = await runAction('kill-switch', () =>
      postJson<JsonRecord>('/api/bud/kill-switch', {
        action: 'trigger',
        detail: `manual ${page} page emergency stop`,
        reason: 'manual',
      }),
    );

    if (payload) {
      setKillSwitchData(asRecord(payload));
    }
  }

  const liveEnabled = Boolean(readPath(statusData, ['capabilities', 'live_trading_enabled']));
  const backendOnline = readPath(statusData, ['status']) === 'online' || readPath(statusData, ['health', 'status']) === 'ok';
  const healthLabel = backendOnline ? 'Bud online' : statusData ? 'Bud degraded' : 'Checking';
  const activeResult = resultData;
  const hedgeFundReady = readPath(hedgeFundData, ['liveReady']) === true;

  return (
    <section className="bud-page" aria-label={`${meta.title} Bud workspace`}>
      <div className="cockpit-page-head">
        <div className="cockpit-page-title">
          <span className="cockpit-title-mark" aria-hidden="true">
            <Icon size={23} />
          </span>
          <div>
            <h1>{meta.title}</h1>
          </div>
        </div>
        <div className="cockpit-page-badges">
          <Badge tone={backendOnline ? 'positive' : 'warning'}>{healthLabel}</Badge>
          <Badge tone={liveEnabled ? 'positive' : 'warning'}>{liveEnabled ? 'Live enabled' : 'Live blocked'}</Badge>
          {page === 'strategies' || page === 'bots' ? <Badge tone={hedgeFundReady ? 'positive' : 'warning'}>{hedgeFundReady ? 'Hedge ready' : 'Hedge gated'}</Badge> : null}
          <Badge tone="primary">{meta.badge}</Badge>
        </div>
      </div>

      {page !== 'watchlist' ? (
        <BudControlStrip
          interval={interval}
          limit={limit}
          onIntervalChange={setInterval}
          onLimitChange={setLimit}
          onRefresh={() => {
            void refreshStatus();
            if (page === 'orders' || page === 'history') {
              void refreshTradingState();
            }
            if (page === 'strategies') {
              void loadResearch();
              void loadDeterministicAgents();
              void refreshHedgeFundReadiness();
            }
            if (page === 'bots') {
              void loadPaperBotTests();
              void refreshHedgeFundReadiness();
            }
            if (page === 'alerts') {
              void refreshKillSwitch();
            }
          }}
          onSymbolChange={setSymbol}
          pending={Boolean(pendingAction)}
          symbol={symbol}
        />
      ) : null}

      {error ? (
        <Card className="bud-error-card">
          <AlertTriangle size={18} />
          <strong>{error}</strong>
        </Card>
      ) : null}

      {page === 'agents' ? (
        <AgentsView
          onArbitrage={() => void runArbitrage()}
          onMacro={() => void runMacro()}
          onOrchestrate={() => void runOrchestration()}
          onPortfolio={() => void runPortfolio()}
          pendingAction={pendingAction}
          result={activeResult}
          statusData={statusData}
        />
      ) : null}

      {page === 'backtest' ? <BacktestView onRun={() => void runBacktest()} pendingAction={pendingAction} result={activeResult} /> : null}

      {page === 'strategies' ? (
        <StrategiesView
          deterministicAgentData={deterministicAgentData}
          onLoad={() => void loadResearch()}
          onRunDeterministicAgents={() => void runDeterministicAgents()}
          onResearch={() => void runResearch()}
          onSaveStrategy={(strategy) => void saveResearchStrategy(strategy)}
          onStrategyBacktest={(strategy) => void backtestResearchStrategy(strategy)}
          onTest={() => void runBacktest()}
          hedgeFundData={hedgeFundData}
          interval={interval}
          pendingAction={pendingAction}
          researchData={researchData}
          result={activeResult}
          symbol={symbol}
        />
      ) : null}

      {page === 'bots' ? (
        <BotsView
          executionData={executionData}
          onCheck={() => void checkReadiness()}
          onRefresh={() => void refreshTradingState()}
          onStartPaperBot={() => void startTwoHourPaperBot()}
          hedgeFundData={hedgeFundData}
          paperBotTestData={paperBotTestData}
          pendingAction={pendingAction}
          readinessData={readinessData}
          statusData={statusData}
        />
      ) : null}

      {page === 'orders' ? (
        <OrdersView
          executionData={executionData}
          onBuy={() => void placePaper('buy')}
          onKill={() => void triggerKillSwitch()}
          onQuantityChange={setQuantity}
          onRefresh={() => void refreshTradingState()}
          onSell={() => void placePaper('sell')}
          paperData={paperData}
          pendingAction={pendingAction}
          quantity={quantity}
        />
      ) : null}

      {page === 'alerts' ? (
        <AlertsView
          killSwitchData={killSwitchData}
          onCheck={() => void checkReadiness()}
          onKill={() => void triggerKillSwitch()}
          onStatus={() => void refreshKillSwitch()}
          pendingAction={pendingAction}
          readinessData={readinessData}
          statusData={statusData}
        />
      ) : null}

      {page === 'history' ? <HistoryView paperData={paperData} researchData={researchData} result={activeResult} /> : null}

      {page === 'watchlist' ? <WatchlistView initialPairs={initialPairs} initialStatus={initialStatus} /> : null}
    </section>
  );
}

function BudControlStrip({
  interval,
  limit,
  onIntervalChange,
  onLimitChange,
  onRefresh,
  onSymbolChange,
  pending,
  symbol,
}: {
  interval: string;
  limit: number;
  onIntervalChange: (value: string) => void;
  onLimitChange: (value: number) => void;
  onRefresh: () => void;
  onSymbolChange: (value: string) => void;
  pending: boolean;
  symbol: string;
}) {
  return (
    <Card className="bud-control-strip">
      <label>
        <span>Symbol</span>
        <select onChange={(event) => onSymbolChange(event.target.value)} value={symbol}>
          {symbols.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Timeframe</span>
        <select onChange={(event) => onIntervalChange(event.target.value)} value={interval}>
          {intervals.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Rows</span>
        <input min={60} onChange={(event) => onLimitChange(Number(event.target.value))} step={20} type="number" value={limit} />
      </label>
      <Button disabled={pending} icon={<RefreshCcw size={15} />} onClick={onRefresh} size="sm" variant="secondary">
        Refresh
      </Button>
    </Card>
  );
}

function AgentsView({
  onArbitrage,
  onMacro,
  onOrchestrate,
  onPortfolio,
  pendingAction,
  result,
  statusData,
}: {
  onArbitrage: () => void;
  onMacro: () => void;
  onOrchestrate: () => void;
  onPortfolio: () => void;
  pendingAction: string;
  result: JsonRecord | null;
  statusData: JsonRecord | null;
}) {
  const risk = asRecord(readPath(result, ['risk_profile']));
  const strategy = asRecord(readPath(result, ['strategy']));
  const opportunities = asArray(readPath(result, ['arbitrage_opportunities']));

  return (
    <div className="bud-grid bud-grid--main-side">
      <div className="bud-stack">
        <Card className="bud-action-panel bud-accent-cyan">
          <div className="bud-panel-head">
            <div>
              <h2>Decision Engine</h2>
            </div>
            <Badge tone="primary">LLM via Gateway</Badge>
          </div>
          <div className="bud-action-row">
            <Button icon={<Play size={15} />} isLoading={pendingAction === 'orchestrate'} onClick={onOrchestrate} variant="primary">
              Run decision
            </Button>
            <Button isLoading={pendingAction === 'macro'} onClick={onMacro}>Macro</Button>
            <Button isLoading={pendingAction === 'portfolio'} onClick={onPortfolio}>Portfolio</Button>
            <Button isLoading={pendingAction === 'arbitrage'} onClick={onArbitrage}>Arbitrage</Button>
          </div>
        </Card>

        <div className="bud-metric-grid">
          <BudMetric label="Strategy" tone="primary" value={formatValue(readPath(strategy, ['name']) ?? readPath(result, ['strategy', 'name']))} />
          <BudMetric label="Regime" tone="cyan" value={formatValue(readPath(result, ['regime']) ?? readPath(result, ['macro_regime']))} />
          <BudMetric label="Confidence" tone="green" value={formatMaybePercent(readPath(result, ['confidence']) ?? readPath(strategy, ['confidence']))} />
          <BudMetric label="Risk" tone={readPath(risk, ['within_limits']) === false ? 'red' : 'green'} value={readPath(risk, ['within_limits']) === false ? 'Blocked' : result ? 'Within limits' : 'Not run'} />
        </div>

        <Card className="bud-card">
          <div className="bud-panel-head">
            <h2>Agent Output</h2>
            <Badge tone={result ? 'positive' : 'neutral'}>{result ? 'Structured JSON' : 'Idle'}</Badge>
          </div>
          {result ? <BudKeyValues record={flattenDecision(result)} /> : <BudEmpty label="Run a Bud agent action to produce a real backend result." />}
        </Card>

        {opportunities.length ? <OpportunityTable opportunities={opportunities} /> : null}
      </div>

      <div className="bud-stack">
        <SystemStatusCard statusData={statusData} />
        <JsonPanel data={result} title="Raw Bud Result" />
      </div>
    </div>
  );
}

function BacktestView({ onRun, pendingAction, result }: { onRun: () => void; pendingAction: string; result: JsonRecord | null }) {
  const metrics = asRecord(readPath(result, ['metrics']));
  const quality = asRecord(readPath(result, ['data_quality']));
  const walkForward = asRecord(readPath(result, ['walk_forward']));

  return (
    <div className="bud-grid bud-grid--main-side">
      <div className="bud-stack">
        <Card className="bud-action-panel bud-accent-green">
          <div className="bud-panel-head">
            <h2>Walk-forward Backtest</h2>
            <Badge tone="positive">Binance historical candles</Badge>
          </div>
          <Button icon={<Play size={15} />} isLoading={pendingAction === 'backtest'} onClick={onRun} variant="primary">
            Run backtest
          </Button>
        </Card>

        <div className="bud-metric-grid">
          <BudMetric label="Sharpe" tone="cyan" value={formatNumber(readPath(metrics, ['sharpe_ratio']))} />
          <BudMetric label="Return" tone={Number(readPath(metrics, ['total_return']) ?? 0) >= 0 ? 'green' : 'red'} value={formatMaybePercent(readPath(metrics, ['total_return']), true)} />
          <BudMetric label="Drawdown" tone="red" value={formatMaybePercent(readPath(metrics, ['max_drawdown']), true)} />
          <BudMetric label="Win rate" tone="green" value={formatMaybePercent(readPath(metrics, ['win_rate']), true)} />
          <BudMetric label="Trades" tone="primary" value={formatValue(readPath(metrics, ['total_trades']))} />
          <BudMetric label="Quality" tone="cyan" value={formatMaybePercent(readPath(quality, ['quality_score']), true)} />
        </div>

        <Card className="bud-card">
          <div className="bud-panel-head">
            <h2>Validation</h2>
            <Badge tone={readPath(walkForward, ['accepted']) ? 'positive' : result ? 'warning' : 'neutral'}>{result ? (readPath(walkForward, ['accepted']) ? 'Accepted' : 'Rejected') : 'Not run'}</Badge>
          </div>
          <BudKeyValues record={flattenBacktest(result)} />
        </Card>
      </div>

      <div className="bud-stack">
        <JsonPanel data={readPath(result, ['walk_forward'])} title="Walk-forward" />
        <JsonPanel data={result} title="Raw Backtest" />
      </div>
    </div>
  );
}

function StrategiesView({
  deterministicAgentData,
  hedgeFundData,
  interval,
  onLoad,
  onRunDeterministicAgents,
  onResearch,
  onSaveStrategy,
  onStrategyBacktest,
  onTest,
  pendingAction,
  researchData,
  result,
  symbol,
}: {
  deterministicAgentData: JsonRecord | null;
  hedgeFundData: JsonRecord | null;
  interval: string;
  onLoad: () => void;
  onRunDeterministicAgents: () => void;
  onResearch: () => void;
  onSaveStrategy: (strategy: StrategyDraft) => void;
  onStrategyBacktest: (strategy: StrategyDraft) => void;
  onTest: () => void;
  pendingAction: string;
  researchData: JsonRecord | null;
  result: JsonRecord | null;
  symbol: string;
}) {
  const strategies = asArray(readPath(researchData, ['strategies']));
  const evaluations = asArray(readPath(researchData, ['evaluations']));
  const runs = asArray(readPath(researchData, ['runs']));
  const deterministicAgents = asArray(readPath(deterministicAgentData, ['agents']));
  const deterministicRuns = asArray(readPath(deterministicAgentData, ['runs']));
  const deterministicQueue = asArray(readPath(deterministicAgentData, ['queue']));
  const firstStrategyKey = strategyRecordKey(strategies[0]);
  const [selectedStrategyKey, setSelectedStrategyKey] = useState(firstStrategyKey);
  const selectedStrategy = asRecord(strategies.find((strategy) => strategyRecordKey(strategy) === selectedStrategyKey) ?? strategies[0]);
  const [draft, setDraft] = useState<StrategyDraft>(() => strategyDraftFromRecord(selectedStrategy, symbol, interval));
  const selectedEvaluations = evaluations.filter((evaluation) => {
    const record = asRecord(evaluation);

    return (
      readPath(record, ['strategy_id']) === draft.strategyId ||
      readPath(record, ['version_id']) === draft.versionId ||
      readPath(record, ['strategy_id']) === readPath(selectedStrategy, ['strategy_id'])
    );
  });
  const latestEvaluation = asRecord(selectedEvaluations[0] ?? evaluations[0]);

  useEffect(() => {
    if (!selectedStrategyKey && firstStrategyKey) {
      setSelectedStrategyKey(firstStrategyKey);
    }
  }, [firstStrategyKey, selectedStrategyKey]);

  useEffect(() => {
    setDraft(strategyDraftFromRecord(selectedStrategy, symbol, interval));
  }, [selectedStrategy, symbol, interval]);

  return (
    <div className="bud-grid bud-grid--main-side">
      <div className="bud-stack">
        <Card className="bud-action-panel bud-accent-violet">
          <div className="bud-panel-head">
            <h2>Research Registry</h2>
            <Badge tone={strategies.length ? 'positive' : 'warning'}>{strategies.length ? `${strategies.length} strategies` : 'Registry check'}</Badge>
          </div>
          <div className="bud-action-row">
            <Button icon={<RefreshCcw size={15} />} isLoading={pendingAction === 'load-research'} onClick={onLoad}>
              Load registry
            </Button>
            <Button icon={<Sparkles size={15} />} isLoading={pendingAction === 'research'} onClick={onResearch} variant="primary">
              Run research
            </Button>
            <Button icon={<BrainCircuit size={15} />} isLoading={pendingAction === 'deterministic-agents'} onClick={onRunDeterministicAgents}>
              Run deterministic agents
            </Button>
            <Button isLoading={pendingAction === 'backtest'} onClick={onTest}>Backtest current</Button>
          </div>
        </Card>

        <div className="bud-metric-grid">
          <BudMetric label="Strategies" tone="primary" value={strategies.length || '0'} />
          <BudMetric label="Evaluations" tone="cyan" value={evaluations.length || '0'} />
          <BudMetric label="Runs" tone="green" value={runs.length || '0'} />
          <BudMetric label="Deterministic" tone="primary" value={deterministicRuns.length || deterministicAgents.length || '0'} />
        </div>

        <StrategyWorkbench
          draft={draft}
          evaluations={selectedEvaluations}
          latestEvaluation={latestEvaluation}
          onBacktest={() => onStrategyBacktest(draft)}
          onDraftChange={setDraft}
          onSave={() => onSaveStrategy(draft)}
          onSelect={setSelectedStrategyKey}
          pendingAction={pendingAction}
          selectedKey={strategyRecordKey(selectedStrategy)}
          strategies={strategies}
        />

        <HedgeFundReadinessPanel data={hedgeFundData} withGates />

        <RecordTable empty="No Bud evaluation rows available." records={selectedEvaluations.length ? selectedEvaluations : evaluations} title="Evaluations" />
      </div>

      <div className="bud-stack">
        <RecordTable compact empty="No deterministic agent queue rows." records={deterministicQueue} title="Deterministic Queue" />
        <RecordTable compact empty="No research runs available." records={runs} title="Runs" />
        <JsonPanel data={result ?? deterministicAgentData ?? researchData} title="Research Payload" />
      </div>
    </div>
  );
}

function StrategyWorkbench({
  draft,
  evaluations,
  latestEvaluation,
  onBacktest,
  onDraftChange,
  onSave,
  onSelect,
  pendingAction,
  selectedKey,
  strategies,
}: {
  draft: StrategyDraft;
  evaluations: unknown[];
  latestEvaluation: JsonRecord;
  onBacktest: () => void;
  onDraftChange: (draft: StrategyDraft) => void;
  onSave: () => void;
  onSelect: (key: string) => void;
  pendingAction: string;
  selectedKey: string;
  strategies: unknown[];
}) {
  if (!strategies.length) {
    return (
      <Card className="bud-card">
        <div className="bud-panel-head">
          <h2>Strategy Workbench</h2>
          <Badge tone="warning">Empty</Badge>
        </div>
        <BudEmpty label="Load or run research to populate editable Bud strategies." />
      </Card>
    );
  }

  const fields = strategyParamFields[draft.strategyType] ?? strategyParamFields.sma_cross;

  return (
    <Card className="bud-card bud-strategy-workbench">
      <div className="bud-panel-head">
        <h2>Strategy Workbench</h2>
        <Badge tone={readPath(latestEvaluation, ['selection_status']) === 'selected' ? 'positive' : 'warning'}>{formatValue(readPath(latestEvaluation, ['selection_status']) ?? draft.status)}</Badge>
      </div>

      <div className="bud-strategy-workbench__layout">
        <div className="bud-strategy-list" aria-label="Bud strategies">
          {strategies.map((strategy, index) => {
            const record = asRecord(strategy);
            const key = strategyRecordKey(record) || String(index);
            const isActive = key === selectedKey;
            const evaluation = asRecord(evaluations.find((item) => readPath(item, ['strategy_id']) === readPath(record, ['strategy_id'])) ?? {});

            return (
              <button aria-pressed={isActive} className={isActive ? 'is-active' : undefined} key={key} onClick={() => onSelect(key)} type="button">
                <span>
                  <strong>{strategyName(record)}</strong>
                  <em>{formatValue(readPath(record, ['strategy_type']))} · v{formatValue(readPath(record, ['version']))}</em>
                </span>
                <small>{formatScore(readPath(evaluation, ['ranking_score']) ?? readPath(record, ['selection_score']))}</small>
              </button>
            );
          })}
        </div>

        <div className="bud-strategy-editor">
          <div className="bud-strategy-editor__head">
            <div>
              <span>{draft.strategyId ?? 'new-version'}</span>
              <strong>{draft.name}</strong>
            </div>
            <div className="bud-action-row">
              <Button icon={<Save size={15} />} isLoading={pendingAction === 'save-strategy'} onClick={onSave} size="sm" variant="primary">
                Save version
              </Button>
              <Button icon={<FlaskConical size={15} />} isLoading={pendingAction === 'strategy-backtest'} onClick={onBacktest} size="sm">
                Backtest edited
              </Button>
            </div>
          </div>

          <div className="bud-strategy-form">
            <label>
              <span>Name</span>
              <input aria-label="Strategy name" onChange={(event) => onDraftChange({ ...draft, name: event.target.value })} value={draft.name} />
            </label>
            <label>
              <span>Type</span>
              <select
                aria-label="Strategy type"
                onChange={(event) => {
                  const nextType = event.target.value;
                  onDraftChange({ ...draft, params: { ...defaultParamsForStrategy(nextType), ...draft.params }, strategyType: nextType });
                }}
                value={draft.strategyType}
              >
                {strategyTypes.map((type) => (
                  <option key={type} value={type}>
                    {humanize(type)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select aria-label="Strategy status" onChange={(event) => onDraftChange({ ...draft, status: event.target.value })} value={draft.status}>
                {strategyStatuses.map((status) => (
                  <option key={status} value={status}>
                    {humanize(status)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="bud-strategy-param-grid">
            {fields.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                <input
                  aria-label={field.label}
                  max={field.max}
                  min={field.min}
                  onChange={(event) => onDraftChange({ ...draft, params: { ...draft.params, [field.key]: numberOrExisting(event.target.value, draft.params[field.key]) } })}
                  step={field.step ?? 1}
                  type="number"
                  value={String(draft.params[field.key] ?? defaultParamsForStrategy(draft.strategyType)[field.key] ?? field.min)}
                />
              </label>
            ))}
          </div>

          <div className="bud-strategy-form bud-strategy-form--conditions">
            <label>
              <span>Entry</span>
              <input aria-label="Entry condition" onChange={(event) => onDraftChange({ ...draft, conditions: { ...draft.conditions, entry: event.target.value } })} value={String(draft.conditions.entry ?? '')} />
            </label>
            <label>
              <span>Exit</span>
              <input aria-label="Exit condition" onChange={(event) => onDraftChange({ ...draft, conditions: { ...draft.conditions, exit: event.target.value } })} value={String(draft.conditions.exit ?? '')} />
            </label>
          </div>

          <label className="bud-strategy-review-note">
            <span>Review note</span>
            <textarea aria-label="Review note" onChange={(event) => onDraftChange({ ...draft, metadata: { ...draft.metadata, user_review_note: event.target.value } })} rows={3} value={String(draft.metadata.user_review_note ?? '')} />
          </label>

          <div className="bud-strategy-regimes" aria-label="Regime tags">
            {regimeOptions.map((regime) => {
              const isActive = draft.regimeTags.includes(regime);
              return (
                <button
                  className={isActive ? 'is-active' : undefined}
                  key={regime}
                  onClick={() =>
                    onDraftChange({
                      ...draft,
                      regimeTags: isActive ? draft.regimeTags.filter((item) => item !== regime) : [...draft.regimeTags, regime],
                    })
                  }
                  type="button"
                >
                  {isActive ? <CheckCircle2 size={14} /> : <SlidersHorizontal size={14} />}
                  {humanize(regime)}
                </button>
              );
            })}
          </div>

          <StrategyEvaluationPanel evaluation={latestEvaluation} evaluations={evaluations} />
        </div>
      </div>
    </Card>
  );
}

function StrategyEvaluationPanel({ evaluation, evaluations }: { evaluation: JsonRecord; evaluations: unknown[] }) {
  const rejectionReasons = asArray(readPath(evaluation, ['rejection_reasons']));

  return (
    <div className="bud-strategy-evaluation">
      <div className="bud-strategy-evaluation__head">
        <span>
          <Pencil size={14} />
          Personal review
        </span>
        <strong>{evaluations.length} evals</strong>
      </div>
      <div className="bud-strategy-mini-metrics">
        <StrategyMiniMetric label="Rank" value={formatScore(readPath(evaluation, ['ranking_score']))} />
        <StrategyMiniMetric label="Test return" tone={Number(readPath(evaluation, ['test', 'metrics', 'total_return']) ?? 0) >= 0 ? 'positive' : 'negative'} value={formatMaybePercent(readPath(evaluation, ['test', 'metrics', 'total_return']), true)} />
        <StrategyMiniMetric label="Sharpe" value={formatNumber(readPath(evaluation, ['test', 'metrics', 'sharpe_ratio']))} />
        <StrategyMiniMetric label="Drawdown" tone="negative" value={formatMaybePercent(readPath(evaluation, ['test', 'metrics', 'max_drawdown']), true)} />
      </div>
      {rejectionReasons.length ? (
        <div className="bud-blocker-list">
          {rejectionReasons.slice(0, 6).map((reason, index) => (
            <span key={`${String(reason)}-${index}`}>
              <AlertTriangle size={14} />
              {String(reason)}
            </span>
          ))}
        </div>
      ) : (
        <BudEmpty label="No rejection reason attached to this strategy." />
      )}
    </div>
  );
}

function StrategyMiniMetric({ label, tone = 'neutral', value }: { label: string; tone?: 'negative' | 'neutral' | 'positive'; value: string }) {
  return (
    <div className={`bud-strategy-mini-metric bud-strategy-mini-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BotsView({
  executionData,
  hedgeFundData,
  onCheck,
  onRefresh,
  onStartPaperBot,
  paperBotTestData,
  pendingAction,
  readinessData,
  statusData,
}: {
  executionData: JsonRecord | null;
  hedgeFundData: JsonRecord | null;
  onCheck: () => void;
  onRefresh: () => void;
  onStartPaperBot: () => void;
  paperBotTestData: JsonRecord | null;
  pendingAction: string;
  readinessData: JsonRecord | null;
  statusData: JsonRecord | null;
}) {
  const blockers = asArray(readPath(readinessData, ['blockers']));
  const liveReady = readPath(readinessData, ['live_ready']) === true;
  const paperSessions = asArray(readPath(paperBotTestData, ['sessions']));
  const runningPaperSessions = paperSessions.filter((session) => readPath(session, ['status']) === 'running');

  return (
    <div className="bud-grid bud-grid--main-side">
      <div className="bud-stack">
        <Card className="bud-action-panel bud-accent-orange">
          <div className="bud-panel-head">
            <h2>Bot Launch Gate</h2>
            <Badge tone={liveReady ? 'positive' : 'warning'}>{liveReady ? 'Launch ready' : 'Launch locked'}</Badge>
          </div>
          <div className="bud-action-row">
            <Button icon={<ShieldAlert size={15} />} isLoading={pendingAction === 'readiness'} onClick={onCheck} variant="primary">
              Check readiness
            </Button>
            <Button icon={<RefreshCcw size={15} />} isLoading={pendingAction === 'refresh-trading'} onClick={onRefresh}>
              Refresh positions
            </Button>
            <Button icon={<Play size={15} />} isLoading={pendingAction === 'paper-bot-2h'} onClick={onStartPaperBot}>
              Start 2h paper bot
            </Button>
          </div>
        </Card>

        <div className="bud-metric-grid">
          <BudMetric label="Live Ready" tone={liveReady ? 'green' : 'red'} value={liveReady ? 'Yes' : 'No'} />
          <BudMetric label="Safety Score" tone="cyan" value={formatMaybePercent(readPath(readinessData, ['safety_score']), true)} />
          <BudMetric label="Blockers" tone={blockers.length ? 'red' : 'green'} value={blockers.length || '0'} />
          <BudMetric label="Paper 2h" tone={runningPaperSessions.length ? 'green' : 'primary'} value={runningPaperSessions.length || paperSessions.length || '0'} />
        </div>

        <BlockerList blockers={blockers} />
        <RecordTable empty="No 2h paper bot test has been started." records={paperSessions} title="2h Paper Bot Tests" />
        <RecordTable empty="No running Bud bot positions returned by execution engine." records={asArray(readPath(executionData, ['positions']))} title="Execution Positions" />
      </div>

      <div className="bud-stack">
        <SystemStatusCard statusData={statusData} />
        <HedgeFundReadinessPanel data={hedgeFundData} />
        <JsonPanel data={readinessData} title="Readiness Payload" />
      </div>
    </div>
  );
}

function OrdersView({
  executionData,
  onBuy,
  onKill,
  onQuantityChange,
  onRefresh,
  onSell,
  paperData,
  pendingAction,
  quantity,
}: {
  executionData: JsonRecord | null;
  onBuy: () => void;
  onKill: () => void;
  onQuantityChange: (value: number) => void;
  onRefresh: () => void;
  onSell: () => void;
  paperData: JsonRecord | null;
  pendingAction: string;
  quantity: number;
}) {
  const state = asRecord(readPath(paperData, ['state']));
  const position = asRecord(readPath(state, ['position']));
  const trades = asArray(readPath(paperData, ['trades']));

  return (
    <div className="bud-grid bud-grid--main-side">
      <div className="bud-stack">
        <Card className="bud-action-panel bud-accent-cyan">
          <div className="bud-panel-head">
            <h2>Paper Execution</h2>
            <Badge tone="warning">Live blocked by default</Badge>
          </div>
          <div className="bud-order-ticket">
            <label>
              <span>Quantity</span>
              <input min={0} onChange={(event) => onQuantityChange(Number(event.target.value))} step={0.001} type="number" value={quantity} />
            </label>
            <Button isLoading={pendingAction === 'paper-buy'} onClick={onBuy} variant="primary">Paper buy</Button>
            <Button isLoading={pendingAction === 'paper-sell'} onClick={onSell}>Paper sell</Button>
            <Button icon={<RefreshCcw size={15} />} isLoading={pendingAction === 'refresh-trading'} onClick={onRefresh}>Refresh</Button>
            <Button icon={<CircleStop size={15} />} isLoading={pendingAction === 'kill-switch'} onClick={onKill} variant="danger">Kill switch</Button>
          </div>
        </Card>

        <div className="bud-metric-grid">
          <BudMetric label="Position Qty" tone="primary" value={formatNumber(readPath(position, ['quantity']))} />
          <BudMetric label="Market Price" tone="cyan" value={formatCurrency(readPath(position, ['market_price']))} />
          <BudMetric label="Total PnL" tone={Number(readPath(position, ['total_pnl']) ?? 0) >= 0 ? 'green' : 'red'} value={formatCurrency(readPath(position, ['total_pnl']))} />
          <BudMetric label="Trades" tone="green" value={formatValue(readPath(state, ['trades_count']) ?? trades.length)} />
        </div>

        <RecordTable empty="No Bud execution positions." records={asArray(readPath(executionData, ['positions']))} title="Positions" />
        <RecordTable empty="No paper trades yet." records={trades} title="Paper Trades" />
      </div>

      <div className="bud-stack">
        <JsonPanel data={readPath(paperData, ['riskLimits'])} title="Risk Limits" />
        <JsonPanel data={paperData} title="Paper State" />
      </div>
    </div>
  );
}

function AlertsView({
  killSwitchData,
  onCheck,
  onKill,
  onStatus,
  pendingAction,
  readinessData,
  statusData,
}: {
  killSwitchData: JsonRecord | null;
  onCheck: () => void;
  onKill: () => void;
  onStatus: () => void;
  pendingAction: string;
  readinessData: JsonRecord | null;
  statusData: JsonRecord | null;
}) {
  const blockers = asArray(readPath(readinessData, ['blockers']));
  const warnings = asArray(readPath(statusData, ['warnings']));
  const activeKill = readPath(killSwitchData, ['active']) === true;

  return (
    <div className="bud-grid bud-grid--main-side">
      <div className="bud-stack">
        <Card className="bud-action-panel bud-accent-red">
          <div className="bud-panel-head">
            <h2>Risk Monitor</h2>
            <Badge tone={activeKill ? 'negative' : 'positive'}>{activeKill ? 'Kill active' : 'Kill clear'}</Badge>
          </div>
          <div className="bud-action-row">
            <Button icon={<ShieldAlert size={15} />} isLoading={pendingAction === 'readiness'} onClick={onCheck} variant="primary">
              Run checks
            </Button>
            <Button icon={<RefreshCcw size={15} />} onClick={onStatus}>Kill status</Button>
            <Button icon={<CircleStop size={15} />} isLoading={pendingAction === 'kill-switch'} onClick={onKill} variant="danger">
              Trigger kill
            </Button>
          </div>
        </Card>

        <div className="bud-metric-grid">
          <BudMetric label="Kill Switch" tone={activeKill ? 'red' : 'green'} value={activeKill ? 'Active' : 'Clear'} />
          <BudMetric label="Readiness" tone={readPath(readinessData, ['live_ready']) ? 'green' : 'red'} value={readinessData ? (readPath(readinessData, ['live_ready']) ? 'Ready' : 'Blocked') : 'Not checked'} />
          <BudMetric label="Safety Score" tone="cyan" value={formatMaybePercent(readPath(readinessData, ['safety_score']), true)} />
          <BudMetric label="Warnings" tone={warnings.length ? 'red' : 'green'} value={warnings.length || '0'} />
        </div>

        <BlockerList blockers={[...warnings, ...blockers]} />
      </div>

      <div className="bud-stack">
        <JsonPanel data={killSwitchData} title="Kill Switch" />
        <JsonPanel data={readinessData} title="Readiness" />
      </div>
    </div>
  );
}

function HistoryView({ paperData, researchData, result }: { paperData: JsonRecord | null; researchData: JsonRecord | null; result: JsonRecord | null }) {
  const trades = asArray(readPath(paperData, ['trades']));
  const runs = asArray(readPath(researchData, ['runs']));
  const evaluations = asArray(readPath(researchData, ['evaluations']));

  return (
    <div className="bud-grid bud-grid--main-side">
      <div className="bud-stack">
        <div className="bud-metric-grid">
          <BudMetric label="Paper Trades" tone="primary" value={trades.length || '0'} />
          <BudMetric label="Research Runs" tone="cyan" value={runs.length || '0'} />
          <BudMetric label="Evaluations" tone="green" value={evaluations.length || '0'} />
          <BudMetric label="Latest Action" tone={result ? 'green' : 'primary'} value={result ? 'Available' : 'None'} />
        </div>
        <RecordTable empty="No paper trade history returned by Bud." records={trades} title="Paper Trade History" />
        <RecordTable empty="No research evaluations returned by Bud." records={evaluations} title="Research Evaluation History" />
      </div>

      <div className="bud-stack">
        <RecordTable compact empty="No research run records returned by Bud." records={runs} title="Research Runs" />
        <JsonPanel data={paperData ?? researchData} title="Raw History Source" />
      </div>
    </div>
  );
}

function WatchlistView({ initialPairs, initialStatus }: { initialPairs: MarketPair[]; initialStatus: MarketDataStatus }) {
  const { connected, pairs } = useBinanceLiveMarkets(initialPairs, initialStatus);
  const [query, setQuery] = useState('');
  const [quote, setQuote] = useState('USDT');
  const visiblePairs = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return pairs
      .filter((pair) => pair.quote === quote)
      .filter((pair) => (normalized ? `${pair.symbol} ${pair.name}`.toLowerCase().includes(normalized) : true))
      .slice(0, 18);
  }, [pairs, query, quote]);

  return (
    <div className="bud-stack">
      <Card className="bud-action-panel bud-accent-cyan">
        <div className="bud-panel-head">
          <h2>Live Watchlist</h2>
          <Badge tone={connected ? 'positive' : 'warning'}>{connected ? 'Binance live' : 'Binance cache'}</Badge>
        </div>
        <div className="bud-watch-controls">
          <input onChange={(event) => setQuery(event.target.value)} placeholder="Search real market" value={query} />
          <select onChange={(event) => setQuote(event.target.value)} value={quote}>
            <option value="USDT">USDT</option>
            <option value="BTC">BTC</option>
          </select>
        </div>
      </Card>

      <div className="bud-market-table">
        <div className="bud-market-table__head">
          <span>Symbol</span>
          <span>Price</span>
          <span>24h</span>
          <span>Volume</span>
          <span>Market Cap</span>
          <span>Open</span>
        </div>
        {visiblePairs.map((pair) => (
          <div className="bud-market-table__row" key={pair.symbol}>
            <strong>{pair.symbol}</strong>
            <span>{formatUsd(pair.lastPrice)}</span>
            <span className={pair.change24h >= 0 ? 'positive' : 'negative'}>{formatPercent(pair.change24h)}</span>
            <span>{formatCompactUsd(pair.volume24h)}</span>
            <span>{formatCompactUsd(pair.marketCap)}</span>
            <Link href={`/charts?pair=${encodeURIComponent(pair.symbol)}`}>Chart</Link>
          </div>
        ))}
      </div>
    </div>
  );
}

function HedgeFundReadinessPanel({ data, withGates = false }: { data: JsonRecord | null; withGates?: boolean }) {
  const summary = asRecord(readPath(data, ['summary']));
  const gates = asArray(readPath(data, ['gates']));
  const blockers = asArray(readPath(data, ['blockers']));
  const liveReady = readPath(data, ['liveReady']) === true;
  const score = readPath(data, ['score']);

  return (
    <>
      <Card className={liveReady ? 'bud-card bud-accent-green' : 'bud-card bud-accent-red'}>
        <div className="bud-panel-head">
          <h2>Hedge Fund Readiness</h2>
          <Badge tone={liveReady ? 'positive' : data ? 'negative' : 'neutral'}>{liveReady ? 'Ready' : data ? 'Blocked' : 'Not checked'}</Badge>
        </div>
        <BudKeyValues
          record={{
            Status: readPath(data, ['status']),
            Score: typeof score === 'number' ? `${score}%` : score,
            Roadmap: readPath(data, ['roadmap']),
            VisibleStrategies: readPath(summary, ['visibleStrategies']),
            ActiveBacktested: readPath(summary, ['activeBacktestedStrategies']),
            CompletedPaper: readPath(summary, ['completedPaperSessions']),
            LiveReadyStrategies: readPath(summary, ['liveReadyStrategies']),
            BudSelected: readPath(summary, ['budSelectedEvaluations']),
            BudRejected: readPath(summary, ['budRejectedEvaluations']),
          }}
        />
      </Card>

      {withGates ? (
        <RecordTable
          compact
          columns={[
            ['Step', ['step']],
            ['Gate', ['title']],
            ['Status', ['status']],
            ['Blockers', ['blockers']],
          ]}
          empty="No hedge fund readiness gates returned."
          records={gates}
          title="Hedge Fund Gates"
        />
      ) : null}

      {blockers.length ? <BlockerList blockers={blockers.slice(0, withGates ? 8 : 6)} /> : null}
    </>
  );
}

function SystemStatusCard({ statusData }: { statusData: JsonRecord | null }) {
  return (
    <Card className="bud-card">
      <div className="bud-panel-head">
        <h2>Bud Status</h2>
        <Badge tone={readPath(statusData, ['status']) === 'online' ? 'positive' : 'warning'}>{formatValue(readPath(statusData, ['status']))}</Badge>
      </div>
      <BudKeyValues
        record={{
          Backend: readPath(statusData, ['backendUrl']),
          Health: readPath(statusData, ['health', 'status']),
          Binance: readPath(statusData, ['health', 'binance_rest']),
          Live: readPath(statusData, ['capabilities', 'live_trading_enabled']) ? 'enabled' : 'blocked',
          Source: readPath(statusData, ['source']),
        }}
      />
    </Card>
  );
}

function OpportunityTable({ opportunities }: { opportunities: unknown[] }) {
  return (
    <RecordTable
      records={opportunities}
      title="Arbitrage Opportunities"
      columns={[
        ['Symbol', ['symbol']],
        ['Buy', ['buy_exchange']],
        ['Sell', ['sell_exchange']],
        ['Profit', ['expected_profit']],
        ['Risk', ['risk_score']],
        ['Feasible', ['execution_feasibility']],
      ]}
      empty="No arbitrage opportunities returned."
    />
  );
}

function BlockerList({ blockers }: { blockers: unknown[] }) {
  return (
    <Card className="bud-card">
      <div className="bud-panel-head">
        <h2>Blockers</h2>
        <Badge tone={blockers.length ? 'negative' : 'positive'}>{blockers.length ? blockers.length : 'Clear'}</Badge>
      </div>
      {blockers.length ? (
        <div className="bud-blocker-list">
          {blockers.slice(0, 18).map((blocker, index) => (
            <span key={`${String(blocker)}-${index}`}>
              <AlertTriangle size={14} />
              {String(blocker)}
            </span>
          ))}
        </div>
      ) : (
        <BudEmpty label="No blockers returned by Bud." />
      )}
    </Card>
  );
}

function BudMetric({ label, tone = 'primary', value }: { label: string; tone?: 'cyan' | 'green' | 'primary' | 'red' | 'violet'; value: unknown }) {
  return (
    <Card className={`bud-metric bud-metric--${tone}`}>
      <span>{label}</span>
      <strong>{formatValue(value)}</strong>
    </Card>
  );
}

function BudKeyValues({ record }: { record: JsonRecord }) {
  const entries = Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== '');

  if (!entries.length) {
    return <BudEmpty label="No structured fields available yet." />;
  }

  return (
    <div className="bud-kv">
      {entries.map(([key, value]) => (
        <div key={key}>
          <span>{humanize(key)}</span>
          <strong>{formatValue(value)}</strong>
        </div>
      ))}
    </div>
  );
}

function RecordTable({
  columns,
  compact = false,
  empty,
  records,
  title,
}: {
  columns?: Array<[string, string[]]>;
  compact?: boolean;
  empty: string;
  records: unknown[];
  title: string;
}) {
  const resolvedColumns = columns ?? inferColumns(records);

  return (
    <Card className="bud-card">
      <div className="bud-panel-head">
        <h2>{title}</h2>
        <Badge tone={records.length ? 'positive' : 'neutral'}>{records.length}</Badge>
      </div>
      {records.length && resolvedColumns.length ? (
        <div className={compact ? 'bud-record-table bud-record-table--compact' : 'bud-record-table'} style={{ '--bud-columns': `repeat(${resolvedColumns.length}, minmax(0, 1fr))` } as CSSProperties}>
          <div className="bud-record-table__head">
            {resolvedColumns.map(([label]) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          {records.slice(0, compact ? 8 : 12).map((record, index) => {
            const row = asRecord(record);

            return (
              <div className="bud-record-table__row" key={String(readPath(row, ['id']) ?? readPath(row, ['strategy_id']) ?? index)}>
                {resolvedColumns.map(([label, path]) => (
                  <span key={label}>{formatValue(readPath(row, path))}</span>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <BudEmpty label={empty} />
      )}
    </Card>
  );
}

function JsonPanel({ data, title }: { data: unknown; title: string }) {
  return (
    <Card className="bud-card bud-json-card">
      <div className="bud-panel-head">
        <h2>{title}</h2>
        <Badge tone={data ? 'primary' : 'neutral'}>{data ? 'JSON' : 'Empty'}</Badge>
      </div>
      {data ? <pre>{JSON.stringify(data, null, 2)}</pre> : <BudEmpty label="No payload available." />}
    </Card>
  );
}

function BudEmpty({ label }: { label: string }) {
  return (
    <div className="bud-empty">
      <Activity size={16} />
      <span>{label}</span>
    </div>
  );
}

function flattenDecision(record: JsonRecord | null): JsonRecord {
  if (!record) {
    return {};
  }

  return {
    Strategy: readPath(record, ['strategy', 'name']),
    Status: readPath(record, ['strategy', 'status']),
    Side: readPath(record, ['strategy', 'side']),
    Entry: readPath(record, ['strategy', 'entry_price']),
    Stop: readPath(record, ['strategy', 'stop_loss_price']),
    TakeProfit: readPath(record, ['strategy', 'take_profit_price']),
    Regime: readPath(record, ['regime']) ?? readPath(record, ['macro_regime']),
    Confidence: formatMaybePercent(readPath(record, ['confidence']) ?? readPath(record, ['strategy', 'confidence'])),
    Violations: asArray(readPath(record, ['risk_profile', 'violations'])).join(', '),
  };
}

function flattenBacktest(record: JsonRecord | null): JsonRecord {
  if (!record) {
    return {};
  }

  return {
    Symbol: readPath(record, ['symbol']),
    Interval: readPath(record, ['interval']),
    Rows: readPath(record, ['rows']),
    Strategy: readPath(record, ['strategy', 'name']),
    Entries: readPath(record, ['signals', 'entries_count']),
    Exits: readPath(record, ['signals', 'exits_count']),
    WalkForwardScore: formatMaybePercent(readPath(record, ['walk_forward', 'walk_forward_score']), true),
    OverfitRisk: formatMaybePercent(readPath(record, ['walk_forward', 'overfit_risk']), true),
    Rejections: asArray(readPath(record, ['walk_forward', 'rejection_reasons'])).join(', '),
  };
}

function inferColumns(records: unknown[]): Array<[string, string[]]> {
  const first = asRecord(records[0]);
  const preferred = ['id', 'strategy_id', 'name', 'symbol', 'status', 'regime', 'sharpe_ratio', 'max_drawdown', 'win_rate', 'created_at', 'timestamp'];
  const keys = preferred.filter((key) => key in first);
  const fallback = Object.keys(first).filter((key) => typeof first[key] !== 'object').slice(0, 6);

  return (keys.length ? keys : fallback).slice(0, 6).map((key) => [humanize(key), [key]]);
}

function strategyRecordKey(record: unknown) {
  return String(readPath(record, ['version_id']) ?? readPath(record, ['strategy_id']) ?? readPath(record, ['id']) ?? '');
}

function strategyName(record: JsonRecord) {
  return formatValue(readPath(record, ['name']) ?? readPath(record, ['proposal', 'name']) ?? readPath(record, ['strategy_id']));
}

function strategyDraftFromRecord(record: JsonRecord, symbol: string, interval: string): StrategyDraft {
  const strategyType = String(readPath(record, ['strategy_type']) ?? readPath(record, ['proposal', 'name']) ?? 'sma_cross');
  const normalizedType = strategyTypes.includes(strategyType) ? strategyType : 'sma_cross';
  const status = String(readPath(record, ['status']) ?? 'candidate');
  const conditions = asRecord(readPath(record, ['conditions']));
  const metadata = asRecord(readPath(record, ['metadata']));
  const params = {
    ...defaultParamsForStrategy(normalizedType),
    ...asRecord(readPath(record, ['params'])),
  };

  return {
    conditions,
    metadata: {
      ...metadata,
      source_symbol: metadata.source_symbol ?? symbol,
      source_timeframe: metadata.source_timeframe ?? interval,
    },
    name: String(readPath(record, ['name']) ?? humanize(normalizedType)),
    parentStrategyId: optionalDraftString(readPath(record, ['parent_strategy_id'])) ?? optionalDraftString(readPath(record, ['strategy_id'])),
    params: normalizeStrategyParams(params),
    regimeTags: asArray(readPath(record, ['regime_tags'])).filter((item): item is string => typeof item === 'string'),
    status: strategyStatuses.includes(status) ? status : 'candidate',
    strategyId: optionalDraftString(readPath(record, ['strategy_id'])),
    strategyType: normalizedType,
    versionId: optionalDraftString(readPath(record, ['version_id'])),
  };
}

function strategyInputFromDraft(draft: StrategyDraft): JsonRecord {
  return {
    conditions: draft.conditions,
    metadata: draft.metadata,
    name: draft.name,
    params: normalizeStrategyParams(draft.params),
    parent_strategy_id: draft.parentStrategyId,
    regime_tags: draft.regimeTags,
    status: draft.status,
    strategy_type: draft.strategyType,
  };
}

function backtestStrategyFromDraft(draft: StrategyDraft): JsonRecord {
  return {
    ...normalizeStrategyParams(draft.params),
    name: draft.strategyType,
  };
}

function defaultParamsForStrategy(strategyType: string): Record<string, number> {
  switch (strategyType) {
    case 'bollinger_reversion':
      return { bollinger_std: 2, bollinger_window: 20 };
    case 'donchian_breakout':
      return { donchian_exit_window: 20, donchian_window: 55 };
    case 'ema_trend':
      return { fast_window: 12, slow_window: 48 };
    case 'momentum_volatility':
      return { max_volatility: 0.025, min_momentum: 0.01, momentum_window: 24, volatility_window: 48 };
    case 'rsi_mean_reversion':
      return { rsi_lower: 30, rsi_upper: 55, rsi_window: 14 };
    case 'volume_breakout':
      return { fast_window: 20, slow_window: 50, volume_multiplier: 1.35, volume_window: 20 };
    case 'sma_cross':
    default:
      return { fast_window: 20, slow_window: 50 };
  }
}

function normalizeStrategyParams(params: Record<string, unknown>): Record<string, number | string | boolean> {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean')
      .map(([key, value]) => [key, typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : value as number | string | boolean]),
  );
}

function numberOrExisting(value: string, fallback: unknown) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : typeof fallback === 'number' || typeof fallback === 'string' || typeof fallback === 'boolean' ? fallback : 0;
}

function optionalDraftString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function formatScore(value: unknown) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue.toFixed(3).replace(/\.?0+$/, '') : 'NON DEFINI';
}

function unwrapBudPayload<T>(value: T | BudEnvelope<T>): T {
  if (isRecord(value) && 'payload' in value) {
    return value.payload as T;
  }

  return value as T;
}

function readPath(record: unknown, path: string[]): unknown {
  let current = record;

  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatCurrency(value: unknown): string {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? formatUsd(numberValue) : 'NON DEFINI';
}

function formatMaybePercent(value: unknown, ratio = false): string {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return 'NON DEFINI';
  }

  return `${(ratio ? numberValue * 100 : numberValue).toFixed(2)}%`;
}

function formatNumber(value: unknown): string {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return 'NON DEFINI';
  }

  return Math.abs(numberValue) >= 1000 ? numberValue.toLocaleString('en-US', { maximumFractionDigits: 2 }) : numberValue.toFixed(4).replace(/\.?0+$/, '');
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'NON DEFINI';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'number') {
    return formatNumber(value);
  }

  if (Array.isArray(value)) {
    return value.length ? value.map((item) => formatValue(item)).join(', ') : '[]';
  }

  if (isRecord(value)) {
    return JSON.stringify(value);
  }

  return String(value);
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
