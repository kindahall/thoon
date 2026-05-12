'use client';

import {
  Activity,
  AlertTriangle,
  Bell,
  Camera,
  ChevronDown,
  ChevronsUpDown,
  CircleDot,
  FileText,
  Flag,
  Maximize2,
  MousePointer2,
  MoveDiagonal,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { TradingChart, type ChartDrawing, type ChartDrawingType, type ChartIndicatorConfig, type TradeMarker, type TradeMarkerType } from '../../components/chart/TradingChart';
import { TradingViewChart } from '../../components/chart/TradingViewChart';
import { StrategyAgentDrawer } from '../../components/agent/StrategyAgentDrawer';
import { Button, Card, ErrorState, HelpPopover, IconButton, InfoButton, Modal, TooltipInfo } from '../../components/ui';
import { useBinanceLiveMarkets } from '../../hooks/useBinanceLiveMarkets';
import { apiJson, postJson } from '../../services/api-client';
import { buildRiskOrderInputFromDraft, evaluateRiskEngine, lossPercentFromPnl, type RiskEngineCheck } from '../../services/risk-engine';
import { getTradingErrorDefinition } from '../../services/trading-error-service';
import type { Candle, MarketCategory, MarketPair, PositionDraft, Timeframe } from '../../types/market';
import type { AgentReport, AgentRun, AgentSettings, AgentSuggestion, Bot as TradingBot, ExchangeConnection, JournalTrade, Order, OrderExecutionSource, Position, RiskRules, Strategy, StrategyVersion, TradeLimits, UserPreferences } from '../../types/trading';
import { normalizeCandle, sanitizeCandles } from '../../utils/candles';
import {
  adxSeries,
  aroonSeries,
  atrSeries,
  bollingerBands,
  cciSeries,
  cmfSeries,
  defaultChartIndicatorConfig,
  donchianChannel,
  exponentialAverageSeries,
  hullMovingAverageSeries,
  keltnerChannel,
  latestValue,
  macdSeries,
  mfiSeries,
  momentumSeries,
  movingAverageSeries,
  normalizeChartIndicatorConfig,
  obvSeries,
  rocSeries,
  rsiSeries,
  stochasticSeries,
  stochRsiSeries,
  supertrendSeries,
  trixSeries,
  volumeWeightedMovingAverageSeries,
  vwapSeries,
  weightedMovingAverageSeries,
  williamsRSeries,
} from '../../utils/chart-indicators';
import { formatCompact, formatCompactUsd, formatPercent, formatUsd } from '../../utils/format';

type ChartsWorkspaceProps = {
  agentReports: AgentReport[];
  agentRuns: AgentRun[];
  agentSettings: AgentSettings;
  agentSuggestions: AgentSuggestion[];
  agentVersions: StrategyVersion[];
  bots: TradingBot[];
  defaultPreferences: UserPreferences;
  exchangeConnections: ExchangeConnection[];
  initialPair?: string;
  journalTrades: JournalTrade[];
  marketPairs: MarketPair[];
  openOrders: Order[];
  orderHistory: Order[];
  positions: Position[];
  riskRules: RiskRules;
  strategies: Strategy[];
  tradeLimits: TradeLimits;
};

const chartTimeframes: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w', '1M', '1y'];
const chartRanges = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All'] as const;
const chartCandleRequestTimeoutMs = 12_000;
const pairThemes: Array<{ key: MarketCategory; label: string }> = [
  { key: 'all', label: 'Tous themes' },
  { key: 'trending', label: 'Tendance' },
  { key: 'layer-1', label: 'Layer 1' },
  { key: 'defi', label: 'DeFi' },
  { key: 'meme', label: 'Meme' },
  { key: 'ai', label: 'AI' },
];
const activePairStorageKey = 'thoon.activePair';
const chartEngineStorageKey = 'thoon.chartEngine';
const markerDropDataType = 'application/x-thoon-marker';
const chartWorkspaceDraftsStorageKey = 'thoon.chartWorkspaceDrafts';
const savedSetupStorageKey = 'thoon.savedSetups';
const maximumSavedSetups = 8;
const publicRestExchangeIds = new Set(['bybit', 'okx', 'bitget', 'kraken', 'kucoin', 'coinbase-advanced']);
const defaultIndicatorConfig = defaultChartIndicatorConfig;
type IndicatorCategory = 'Trend' | 'Momentum' | 'Volatility' | 'Volume';
type IndicatorField = {
  key: string;
  label: string;
  max?: number;
  min: number;
  step?: number;
};
type IndicatorCatalogItem = {
  category: IndicatorCategory;
  description: string;
  fields: IndicatorField[];
  key: keyof ChartIndicatorConfig;
  label: string;
};
const indicatorCategories: Array<IndicatorCategory | 'All'> = ['All', 'Trend', 'Momentum', 'Volatility', 'Volume'];
const indicatorCatalog: IndicatorCatalogItem[] = [
  { category: 'Trend', description: 'Classic fast SMA overlay.', fields: [{ key: 'period', label: 'Period', min: 1, max: 500 }], key: 'maFast', label: 'Moving Average Fast' },
  { category: 'Trend', description: 'Classic slow SMA overlay.', fields: [{ key: 'period', label: 'Period', min: 1, max: 500 }], key: 'maSlow', label: 'Moving Average Slow' },
  { category: 'Trend', description: 'Exponential moving average.', fields: [{ key: 'period', label: 'Period', min: 1, max: 500 }], key: 'ema', label: 'EMA' },
  { category: 'Trend', description: 'Weighted moving average.', fields: [{ key: 'period', label: 'Period', min: 1, max: 500 }], key: 'wma', label: 'WMA' },
  { category: 'Trend', description: 'Hull moving average.', fields: [{ key: 'period', label: 'Period', min: 1, max: 500 }], key: 'hma', label: 'HMA' },
  { category: 'Trend', description: 'Volume weighted moving average.', fields: [{ key: 'period', label: 'Period', min: 1, max: 500 }], key: 'vwma', label: 'VWMA' },
  { category: 'Trend', description: 'Session volume weighted average price.', fields: [], key: 'vwap', label: 'VWAP' },
  { category: 'Trend', description: 'ATR based trend line.', fields: [{ key: 'period', label: 'ATR', min: 1, max: 100 }, { key: 'multiplier', label: 'Factor', min: 0.1, max: 10, step: 0.1 }], key: 'supertrend', label: 'Supertrend' },
  { category: 'Trend', description: 'Stop and reverse trend dots.', fields: [{ key: 'step', label: 'Step', min: 0.001, max: 1, step: 0.001 }, { key: 'max', label: 'Max', min: 0.01, max: 1, step: 0.01 }], key: 'parabolicSar', label: 'Parabolic SAR' },
  { category: 'Trend', description: 'Conversion, base and cloud lines.', fields: [{ key: 'conversionPeriod', label: 'Tenkan', min: 1, max: 100 }, { key: 'basePeriod', label: 'Kijun', min: 1, max: 200 }, { key: 'spanBPeriod', label: 'Span B', min: 1, max: 300 }], key: 'ichimoku', label: 'Ichimoku' },
  { category: 'Volatility', description: 'Standard deviation envelope.', fields: [{ key: 'period', label: 'Period', min: 1, max: 300 }, { key: 'stdDev', label: 'Std Dev', min: 0.1, max: 5, step: 0.1 }], key: 'bollinger', label: 'Bollinger Bands' },
  { category: 'Volatility', description: 'Highest high and lowest low channel.', fields: [{ key: 'period', label: 'Period', min: 1, max: 300 }], key: 'donchian', label: 'Donchian Channel' },
  { category: 'Volatility', description: 'EMA channel using ATR width.', fields: [{ key: 'period', label: 'Period', min: 1, max: 300 }, { key: 'multiplier', label: 'Factor', min: 0.1, max: 10, step: 0.1 }], key: 'keltner', label: 'Keltner Channel' },
  { category: 'Volatility', description: 'Average true range.', fields: [{ key: 'period', label: 'Period', min: 1, max: 100 }], key: 'atr', label: 'ATR' },
  { category: 'Momentum', description: 'Relative strength oscillator.', fields: [{ key: 'period', label: 'Period', min: 1, max: 100 }], key: 'rsi', label: 'RSI' },
  { category: 'Momentum', description: 'Trend momentum and signal histogram.', fields: [{ key: 'fastPeriod', label: 'Fast', min: 1, max: 100 }, { key: 'slowPeriod', label: 'Slow', min: 1, max: 200 }, { key: 'signalPeriod', label: 'Signal', min: 1, max: 100 }], key: 'macd', label: 'MACD' },
  { category: 'Momentum', description: 'Fast stochastic oscillator.', fields: [{ key: 'kPeriod', label: '%K', min: 1, max: 100 }, { key: 'dPeriod', label: '%D', min: 1, max: 50 }], key: 'stochastic', label: 'Stochastic' },
  { category: 'Momentum', description: 'Stochastic applied to RSI.', fields: [{ key: 'rsiPeriod', label: 'RSI', min: 1, max: 100 }, { key: 'stochPeriod', label: 'Stoch', min: 1, max: 100 }, { key: 'dPeriod', label: '%D', min: 1, max: 50 }], key: 'stochRsi', label: 'Stoch RSI' },
  { category: 'Momentum', description: 'Commodity channel index.', fields: [{ key: 'period', label: 'Period', min: 1, max: 100 }], key: 'cci', label: 'CCI' },
  { category: 'Momentum', description: 'Williams percent range.', fields: [{ key: 'period', label: 'Period', min: 1, max: 100 }], key: 'williamsR', label: 'Williams %R' },
  { category: 'Momentum', description: 'Rate of change.', fields: [{ key: 'period', label: 'Period', min: 1, max: 100 }], key: 'roc', label: 'ROC' },
  { category: 'Momentum', description: 'Close minus prior close.', fields: [{ key: 'period', label: 'Period', min: 1, max: 100 }], key: 'momentum', label: 'Momentum' },
  { category: 'Momentum', description: 'Triple EMA momentum.', fields: [{ key: 'period', label: 'Period', min: 1, max: 100 }], key: 'trix', label: 'TRIX' },
  { category: 'Momentum', description: 'Trend strength index.', fields: [{ key: 'period', label: 'Period', min: 1, max: 100 }], key: 'adx', label: 'ADX' },
  { category: 'Momentum', description: 'Aroon up and down oscillator.', fields: [{ key: 'period', label: 'Period', min: 1, max: 100 }], key: 'aroon', label: 'Aroon' },
  { category: 'Volume', description: 'Exchange volume histogram.', fields: [], key: 'volume', label: 'Volume' },
  { category: 'Volume', description: 'On balance volume.', fields: [], key: 'obv', label: 'OBV' },
  { category: 'Volume', description: 'Money flow index.', fields: [{ key: 'period', label: 'Period', min: 1, max: 100 }], key: 'mfi', label: 'MFI' },
  { category: 'Volume', description: 'Chaikin money flow.', fields: [{ key: 'period', label: 'Period', min: 1, max: 100 }], key: 'cmf', label: 'CMF' },
];
const markerDefinitions: Array<{
  color: string;
  icon: ReactNode;
  label: string;
  shortLabel: string;
  type: TradeMarkerType;
}> = [
  { color: '#26c8ff', icon: <CircleDot size={15} />, label: 'Entry', shortLabel: 'Entry', type: 'entry' },
  { color: '#a56cff', icon: <Flag size={15} />, label: 'Exit', shortLabel: 'Exit', type: 'exit' },
  { color: '#ff5f75', icon: <ShieldCheck size={15} />, label: 'Stop Loss', shortLabel: 'SL', type: 'stopLoss' },
  { color: '#62e6a8', icon: <TargetIcon />, label: 'Take Profit', shortLabel: 'TP', type: 'takeProfit' },
  { color: '#48d77f', icon: <TargetIcon />, label: 'TP2', shortLabel: 'TP2', type: 'tp2' },
  { color: '#22d3ee', icon: <TrendingUp size={15} />, label: 'Buy Limit', shortLabel: 'Buy L', type: 'buyLimit' },
  { color: '#ffd45a', icon: <TrendingDown size={15} />, label: 'Sell Limit', shortLabel: 'Sell L', type: 'sellLimit' },
  { color: '#f6b84d', icon: <Bell size={15} />, label: 'Alert', shortLabel: 'Alert', type: 'alert' },
];

type SavedChartSetup = {
  chartHeight?: number;
  draft: PositionDraft;
  drawings?: ChartDrawing[];
  exchangeId?: string;
  id: string;
  indicators?: ChartIndicatorConfig;
  executionIntent?: TradeExecutionIntent;
  markers: TradeMarker[];
  name: string;
  notes: string;
  pair: string;
  plannedOrders: Order[];
  riskSettings: {
    breakEven: boolean;
    executionMode: 'paper' | 'live';
    leverage: number;
    riskPercent: number;
    trailingStop: boolean;
  };
  savedAt: string;
  selectedRange?: ChartRange;
  strategyId?: string;
  timeframe: Timeframe;
};

type ChartToolId = 'cursor' | 'line' | 'zone' | 'long' | 'short' | 'alert' | 'indicators' | 'replay';
type ChartEngine = 'thoon' | 'tradingview';
type ChartMarketType = 'perpetual' | 'spot';
type ChartRange = (typeof chartRanges)[number];
type NoteFormat = 'bold' | 'italic' | 'list';
type TradeExecutionIntent = OrderExecutionSource;

export function ChartsWorkspace({
  agentReports,
  agentRuns,
  agentSettings,
  agentSuggestions,
  agentVersions,
  bots: _bots,
  defaultPreferences,
  exchangeConnections,
  initialPair,
  journalTrades,
  marketPairs,
  openOrders,
  orderHistory,
  positions,
  riskRules,
  strategies,
  tradeLimits,
}: ChartsWorkspaceProps) {
  const router = useRouter();
  const defaultExchangeId =
    exchangeConnections.find((exchangeConnection) => exchangeConnection.name === defaultPreferences.defaultExchange && exchangeConnection.status === 'connected')?.id ??
    exchangeConnections.find((exchangeConnection) => exchangeConnection.status === 'connected' && exchangeConnection.permissions.includes('trade'))?.id ??
    exchangeConnections[0]?.id ??
    'paper';
  const [selectedExchangeId, setSelectedExchangeId] = useState(defaultExchangeId);
  const selectedExchange = exchangeConnections.find((exchangeConnection) => exchangeConnection.id === selectedExchangeId) ?? exchangeConnections.find((exchangeConnection) => exchangeConnection.id === defaultExchangeId) ?? exchangeConnections[0];
  const chartMarketType = resolveChartMarketType(selectedExchange?.id ?? selectedExchangeId, defaultPreferences.preferredMarketType);
  const { connected: isBinanceLive, lastEventAt, pairs: liveMarketPairs } = useBinanceLiveMarkets(marketPairs, undefined, {
    exchangeId: selectedExchange?.id ?? selectedExchangeId,
    marketType: chartMarketType,
  });
  const defaultSymbol = resolveInitialSymbol(liveMarketPairs, initialPair);
  const [selectedSymbol, setSelectedSymbol] = useState(defaultSymbol);
  const [selectedPairTheme, setSelectedPairTheme] = useState<MarketCategory>('all');
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const market = useMemo(() => liveMarketPairs.find((pair) => pair.symbol === selectedSymbol) ?? liveMarketPairs[0], [liveMarketPairs, selectedSymbol]);
  const hasBinancePrices = market.exchange === 'Binance';
  const [draft, setDraft] = useState(market.draft);
  const [chartDrawings, setChartDrawings] = useState<ChartDrawing[]>([]);
  const [indicatorConfig, setIndicatorConfig] = useState<ChartIndicatorConfig>(() => normalizeChartIndicatorConfig(defaultIndicatorConfig));
  const [tradeMarkers, setTradeMarkers] = useState<TradeMarker[]>([]);
  const [plannedOrderDrafts, setPlannedOrderDrafts] = useState<Order[]>([]);
  const [selectedMarkerType, setSelectedMarkerType] = useState<TradeMarkerType | null>(null);
  const [activeChartTool, setActiveChartTool] = useState<ChartToolId>('cursor');
  const [executionMode, setExecutionMode] = useState<'paper' | 'live'>('paper');
  const [executionIntent, setExecutionIntent] = useState<TradeExecutionIntent>('manual');
  const [selectedStrategyId, setSelectedStrategyId] = useState('');
  const [chartEngine, setChartEngine] = useState<ChartEngine>('thoon');
  const [leverage, setLeverage] = useState(defaultPreferences.defaultLeverage);
  const [chartHeight, setChartHeight] = useState(640);
  const [selectedRange, setSelectedRange] = useState<ChartRange>('1D');
  const [noteFormats, setNoteFormats] = useState<NoteFormat[]>([]);
  const [chartCandles, setChartCandles] = useState<Candle[]>([]);
  const [chartCandleStatus, setChartCandleStatus] = useState<'loading' | 'live' | 'fallback'>(() => (market.candles.length ? 'live' : 'loading'));
  const [candleRequestNonce, setCandleRequestNonce] = useState(0);
  const [isBreakEvenOn, setIsBreakEvenOn] = useState(defaultPreferences.breakEvenAutomation);
  const [isTrailingOn, setIsTrailingOn] = useState(defaultPreferences.trailingStopEnabled);
  const [indicatorPanelOpen, setIndicatorPanelOpen] = useState(false);
  const [liveConfirmationOpen, setLiveConfirmationOpen] = useState(false);
  const [liveOrderConfirmationOpen, setLiveOrderConfirmationOpen] = useState(false);
  const [workspaceDrafts, setWorkspaceDrafts] = useState<Record<string, SavedChartSetup>>({});
  const [savedSetups, setSavedSetups] = useState<SavedChartSetup[]>([]);
  const [savedSetupNotes, setSavedSetupNotes] = useState('');
  const [setupMessage, setSetupMessage] = useState('Ready');
  const [autoSavedAt, setAutoSavedAt] = useState<string>();
  const [hasLoadedSavedSetups, setHasLoadedSavedSetups] = useState(false);
  const hasHydratedActivePairRef = useRef(false);
  const hydratedSetupKeyRef = useRef<string | null>(null);
  const setupReloadPairRef = useRef<string | null>(null);
  const previousMarketSymbolRef = useRef(market.symbol);
  const selectedMarkerDefinition = markerDefinitions.find((markerDefinition) => markerDefinition.type === selectedMarkerType);
  const selectedExchangeCanTrade = Boolean(selectedExchange?.permissions.includes('trade'));
  const selectedExchangeHasPublicRest = hasPublicRestMarketData(selectedExchange?.id);
  const chartVenueName = selectedExchange?.name ?? 'Thoon';
  const chartMarketLabel = chartMarketType === 'perpetual' ? 'perpetual' : 'spot';
  const marketStripPairs = useMemo(() => getMarketStripPairs(liveMarketPairs, selectedSymbol), [liveMarketPairs, selectedSymbol]);
  const pairThemeGroups = useMemo(() => buildPairThemeGroups(liveMarketPairs, selectedPairTheme), [liveMarketPairs, selectedPairTheme]);
  const strategyOptions = useMemo(() => strategies.filter((strategy) => strategy.status !== 'archived'), [strategies]);
  const selectedStrategy = useMemo(() => strategyOptions.find((strategy) => strategy.id === selectedStrategyId), [selectedStrategyId, strategyOptions]);
  const selectedStrategyMatchesMarket = Boolean(selectedStrategy && selectedStrategy.market === market.symbol);
  const currentWorkspaceKey = useMemo(() => chartWorkspaceKey(market.symbol, timeframe), [market.symbol, timeframe]);
  const candles = useMemo(() => sanitizeCandles(chartCandles), [chartCandles]);
  const hasChartCandles = candles.length > 0;
  const priceAnchor = market.lastPrice || market.draft.entry || 1;
  const fallbackCandle = liveFallbackCandle(market.candles.at(-1), priceAnchor);
  const hasPositionMarker = tradeMarkers.some((marker) => marker.type !== 'alert');
  const hasEntryMarker = hasMarkerType(tradeMarkers, 'entry') || hasMarkerType(tradeMarkers, 'buyLimit') || hasMarkerType(tradeMarkers, 'sellLimit');
  const hasStopLossMarker = hasMarkerType(tradeMarkers, 'stopLoss');
  const hasTakeProfitMarker = hasMarkerType(tradeMarkers, 'takeProfit') || hasMarkerType(tradeMarkers, 'exit');
  const hasCompletePosition = hasEntryMarker && hasStopLossMarker && hasTakeProfitMarker;
  const hasChartSetup = hasPositionMarker || plannedOrderDrafts.length > 0;
  const tp2Marker = tradeMarkers.find((marker) => marker.type === 'tp2');
  const markerSyncRows = buildMarkerSyncRows(tradeMarkers, draft);
  const orders = [...openOrders, ...plannedOrderDrafts].filter((order) => order.symbol === market.symbol);
  const high = hasChartCandles ? Math.max(...candles.map((candle) => candle.high)) : priceAnchor;
  const low = hasChartCandles ? Math.min(...candles.map((candle) => candle.low)) : priceAnchor;
  const lastCandle = candles[candles.length - 1] ?? fallbackCandle;
  const previousCandle = candles[candles.length - 2] ?? lastCandle;
  const visibleMarketPrice = lastCandle?.close ?? market.lastPrice;
  const chartDataIdentity = `${selectedExchangeId}:${chartMarketType}:${market.symbol}:${timeframe}`;
  const isTradingViewEngine = chartEngine === 'tradingview';
  const selectedMarketDataIsLive = selectedExchange?.id === 'binance' ? isBinanceLive : chartCandleStatus === 'live' && selectedExchangeHasPublicRest;
  const alertBuilderHref = `/alerts?pair=${encodeURIComponent(market.symbol)}`;
  const strategyBuilderHref = `/strategies/new?pair=${encodeURIComponent(market.symbol)}`;
  const lastMove = lastCandle.close - previousCandle.close;
  const lastMovePercent = previousCandle.close ? (lastMove / previousCandle.close) * 100 : 0;
  const indicatorReadouts = hasChartCandles ? buildIndicatorReadouts(candles, indicatorConfig) : [];
  const riskReward = hasCompletePosition ? calculateRiskReward(draft) : 0;
  const positionValue = hasCompletePosition ? draft.entry * draft.size : 0;
  const potentialProfit = hasCompletePosition ? Math.abs((draft.takeProfit - draft.entry) * draft.size) : 0;
  const potentialLoss = hasCompletePosition ? Math.abs((draft.entry - draft.stopLoss) * draft.size) : 0;
  const estimatedFees = positionValue * 0.0008;
  const margin = positionValue / Math.max(leverage, 1);
  const liquidationPrice = hasCompletePosition ? (draft.direction === 'long' ? draft.entry * (1 - 0.9 / Math.max(leverage, 1)) : draft.entry * (1 + 0.9 / Math.max(leverage, 1))) : 0;
  const positionPreview = hasCompletePosition
    ? {
        direction: draft.direction,
        entry: draft.entry,
        riskReward,
        stopLoss: draft.stopLoss,
        takeProfit: draft.takeProfit,
      }
    : undefined;
  const liveExchange = selectedExchange;
  const accountBalance = 25000;
  const marginUsed = positions.reduce((sum, position) => sum + position.margin, 0);
  const availableBalance = accountBalance + positions.reduce((sum, position) => sum + position.pnl, 0) - marginUsed;
  const todayLossPercent = lossPercentFromPnl(sumClosedPnl(journalTrades, 1), accountBalance);
  const weeklyLossPercent = lossPercentFromPnl(sumClosedPnl(journalTrades, 7), accountBalance);
  const ordersToday = countOrdersInDays([...openOrders, ...plannedOrderDrafts, ...orderHistory], 1);
  const liveRiskResult = evaluateRiskEngine({
    action: 'execute-trade',
    exchange: liveExchange,
    mode: 'live',
    order: buildRiskOrderInputFromDraft({
      accountBalance,
      availableBalance,
      dailyLossPercent: todayLossPercent,
      draft,
      leverage,
      marginRequired: margin,
      openPositions: positions.length,
      ordersToday,
      weeklyLossPercent,
    }),
    riskRules,
    tradeLimits,
  });
  const liveOrderChecks = liveRiskResult.checks;
  const strategyExecutionReady = executionIntent === 'manual' || Boolean(selectedStrategy && selectedStrategyMatchesMarket);
  const isExecutionBlocked = !hasCompletePosition || !strategyExecutionReady;
  const isLiveOrderBlocked = isExecutionBlocked || !liveRiskResult.allowed;

  useEffect(() => {
    if (executionIntent !== 'strategy') {
      return;
    }

    setSelectedStrategyId((currentStrategyId) => {
      if (currentStrategyId && strategyOptions.some((strategy) => strategy.id === currentStrategyId)) {
        return currentStrategyId;
      }

      return bestStrategyForSymbol(strategyOptions, market.symbol)?.id ?? '';
    });
  }, [executionIntent, market.symbol, strategyOptions]);

  useEffect(() => {
    if (hasHydratedActivePairRef.current && !initialPair) {
      return;
    }

    if (initialPair) {
      setSelectedSymbol(resolveInitialSymbol(liveMarketPairs, initialPair));
      hasHydratedActivePairRef.current = true;
      return;
    }

    const storedSymbol = window.localStorage.getItem(activePairStorageKey);

    if (storedSymbol && liveMarketPairs.some((pair) => pair.symbol === storedSymbol)) {
      setSelectedSymbol(storedSymbol);
    }

    hasHydratedActivePairRef.current = true;
  }, [initialPair, liveMarketPairs]);

  useEffect(() => {
    window.localStorage.setItem(activePairStorageKey, selectedSymbol);
  }, [selectedSymbol]);

  useEffect(() => {
    const storedEngine = window.localStorage.getItem(chartEngineStorageKey);

    if (storedEngine === 'thoon' || storedEngine === 'tradingview') {
      setChartEngine(storedEngine);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(chartEngineStorageKey, chartEngine);
  }, [chartEngine]);

  function chooseSymbol(nextSymbol: string) {
    const nextPair = liveMarketPairs.find((pair) => pair.symbol === nextSymbol);

    if (nextSymbol !== selectedSymbol) {
      setChartCandleStatus('loading');
      setChartCandles([]);
    }

    if (nextPair && selectedPairTheme !== 'all' && nextPair.category !== selectedPairTheme) {
      setSelectedPairTheme(nextPair.category);
    }

    setSelectedSymbol(nextSymbol);
  }

  function choosePairTheme(nextTheme: MarketCategory) {
    setSelectedPairTheme(nextTheme);

    if (nextTheme === 'all' || market.category === nextTheme) {
      return;
    }

    const firstThemePair = sortThemePairs(liveMarketPairs.filter((pair) => pair.category === nextTheme))[0];

    if (firstThemePair) {
      chooseSymbol(firstThemePair.symbol);
    }
  }

  useEffect(() => {
    if (!exchangeConnections.some((exchangeConnection) => exchangeConnection.id === selectedExchangeId)) {
      setSelectedExchangeId(defaultExchangeId);
    }
  }, [defaultExchangeId, exchangeConnections, selectedExchangeId]);

  useEffect(() => {
    const controller = new AbortController();
    let didCleanup = false;
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, chartCandleRequestTimeoutMs);
    setChartCandleStatus('loading');
    setChartCandles([]);

    apiJson<Candle[]>(`/api/markets/candles?symbol=${encodeURIComponent(market.symbol)}&timeframe=${timeframe}&exchangeId=${encodeURIComponent(selectedExchangeId)}&marketType=${chartMarketType}`, undefined, {
      signal: controller.signal,
    })
      .then((nextCandles) => {
        if (!controller.signal.aborted) {
          const cleanCandles = sanitizeCandles(nextCandles);
          setChartCandles(cleanCandles);
          setChartCandleStatus(cleanCandles.length ? 'live' : 'fallback');
        }
      })
      .catch(() => {
        if (!didCleanup) {
          setChartCandles([]);
          setChartCandleStatus('fallback');
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });

    return () => {
      didCleanup = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [candleRequestNonce, chartMarketType, market.symbol, selectedExchangeId, timeframe]);

  useEffect(() => {
    const isPerpetualChartMarket = chartMarketType !== 'spot';

    if (selectedExchange?.id !== 'binance' || !isPerpetualChartMarket || !isBinanceLive || !Number.isFinite(market.lastPrice)) {
      return;
    }

    setChartCandles((currentCandles) => syncLastCandleToTicker(currentCandles, market.lastPrice, timeframe, lastEventAt));
  }, [chartMarketType, isBinanceLive, lastEventAt, market.lastPrice, selectedExchange?.id, timeframe]);

  useEffect(() => {
    if (chartMarketType === 'spot' || selectedExchange?.id !== 'binance') {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setCandleRequestNonce((currentNonce) => currentNonce + 1);
    }, 30_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [chartMarketType, market.symbol, selectedExchange?.id, timeframe]);

  useEffect(() => {
    if (hasChartSetup || !Number.isFinite(visibleMarketPrice)) {
      return;
    }

    setDraft((currentDraft) => {
      const roundedEntry = roundPrice(visibleMarketPrice);

      if (Math.abs(currentDraft.entry - roundedEntry) < 0.000001) {
        return currentDraft;
      }

      const stopRatio = currentDraft.entry ? currentDraft.stopLoss / currentDraft.entry : 0.98;
      const takeProfitRatio = currentDraft.entry ? currentDraft.takeProfit / currentDraft.entry : 1.05;

      return {
        ...currentDraft,
        entry: roundedEntry,
        stopLoss: roundPrice(visibleMarketPrice * stopRatio),
        takeProfit: roundPrice(visibleMarketPrice * takeProfitRatio),
      };
    });
  }, [hasChartSetup, visibleMarketPrice]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectedMarkerType(null);
        setActiveChartTool('cursor');
        setIndicatorPanelOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (setupReloadPairRef.current === market.symbol) {
      setupReloadPairRef.current = null;
      previousMarketSymbolRef.current = market.symbol;
      return;
    }

    if (previousMarketSymbolRef.current !== market.symbol) {
      previousMarketSymbolRef.current = market.symbol;
      setDraft(market.draft);
      setChartDrawings([]);
      setTradeMarkers([]);
      setPlannedOrderDrafts([]);
      setSelectedMarkerType(null);
      setActiveChartTool('cursor');
      setSavedSetupNotes('');
      setSetupMessage('Ready');
      return;
    }

    if (!hasChartSetup) {
      setDraft(market.draft);
    }
  }, [hasChartSetup, market.draft, market.symbol]);

  useEffect(() => {
    const rawSetups = window.localStorage.getItem(savedSetupStorageKey);
    const rawWorkspaceDrafts = window.localStorage.getItem(chartWorkspaceDraftsStorageKey);

    if (rawSetups) {
      try {
        const parsedSetups = JSON.parse(rawSetups) as unknown;
        setSavedSetups(Array.isArray(parsedSetups) ? parsedSetups.slice(0, maximumSavedSetups) as SavedChartSetup[] : []);
      } catch {
        setSavedSetups([]);
      }
    }

    if (rawWorkspaceDrafts) {
      try {
        const parsedDrafts = JSON.parse(rawWorkspaceDrafts) as unknown;
        setWorkspaceDrafts(isRecord(parsedDrafts) ? (parsedDrafts as Record<string, SavedChartSetup>) : {});
      } catch {
        setWorkspaceDrafts({});
      }
    }

    setHasLoadedSavedSetups(true);
  }, []);

  useEffect(() => {
    if (hasLoadedSavedSetups) {
      window.localStorage.setItem(savedSetupStorageKey, JSON.stringify(savedSetups));
    }
  }, [hasLoadedSavedSetups, savedSetups]);

  useEffect(() => {
    if (!hasLoadedSavedSetups) {
      return;
    }

    if (hydratedSetupKeyRef.current === currentWorkspaceKey) {
      return;
    }

    hydratedSetupKeyRef.current = currentWorkspaceKey;
    const storedSetup = workspaceDrafts[currentWorkspaceKey];

    if (storedSetup) {
      reloadSetup(storedSetup, 'Restored');
      setAutoSavedAt(storedSetup.savedAt);
    }
  }, [currentWorkspaceKey, hasLoadedSavedSetups, workspaceDrafts]);

  useEffect(() => {
    if (!hasLoadedSavedSetups || hydratedSetupKeyRef.current !== currentWorkspaceKey) {
      return undefined;
    }

    const saveTimeout = window.setTimeout(() => {
      const setup = createCurrentSetup({
        id: `draft-${clientSlug(market.symbol)}-${timeframe}`,
        name: `Autosave ${market.symbol} ${timeframe}`,
      });

      setWorkspaceDrafts((currentDrafts) => {
        const nextDrafts = { ...currentDrafts, [currentWorkspaceKey]: setup };
        window.localStorage.setItem(chartWorkspaceDraftsStorageKey, JSON.stringify(nextDrafts));

        return nextDrafts;
      });
      setAutoSavedAt(setup.savedAt);
    }, 250);

    return () => {
      window.clearTimeout(saveTimeout);
    };
  }, [
    chartDrawings,
    chartHeight,
    currentWorkspaceKey,
    draft,
    executionIntent,
    executionMode,
    hasLoadedSavedSetups,
    indicatorConfig,
    isBreakEvenOn,
    isTrailingOn,
    leverage,
    market.symbol,
    plannedOrderDrafts,
    savedSetupNotes,
    selectedExchange?.id,
    selectedRange,
    selectedStrategy?.id,
    selectedStrategy?.name,
    timeframe,
    tradeMarkers,
  ]);

  function selectMarkerTool(type: TradeMarkerType) {
    const definition = markerDefinitions.find((item) => item.type === type);
    setSelectedMarkerType((currentType) => (currentType === type ? null : type));
    setActiveChartTool(type === 'alert' ? 'alert' : 'cursor');
    setSetupMessage(definition ? `${definition.shortLabel} armed` : 'Marker armed');
  }

  function placeMarker(type: TradeMarkerType, rawPrice: number) {
    upsertMarker(type, rawPrice);
    setSelectedMarkerType(null);
    setActiveChartTool('cursor');
  }

  function upsertMarker(type: TradeMarkerType, rawPrice: number) {
    const price = roundPrice(rawPrice);

    setTradeMarkers((currentMarkers) => {
      const existingMarker = currentMarkers.find((marker) => marker.type === type);

      if (existingMarker) {
        return currentMarkers.map((marker) => (marker.id === existingMarker.id ? { ...marker, price } : marker));
      }

      return [...currentMarkers, createMarker(type, price, market.symbol)];
    });
    setDraft((currentDraft) => {
      const nextDraft = syncDraftWithMarker(currentDraft, type, price);
      setPlannedOrderDrafts((currentOrders) => syncPlannedOrdersWithDraft(currentOrders, nextDraft));

      return nextDraft;
    });
    setSetupMessage(`${definitionLabel(type)} placed`);
  }

  function removeMarker(id: string) {
    const marker = tradeMarkers.find((item) => item.id === id);

    if (!marker) {
      return;
    }

    setTradeMarkers((currentMarkers) => currentMarkers.filter((item) => item.id !== id));
    setPlannedOrderDrafts((currentOrders) => removePlannedOrdersForMarkerType(currentOrders, marker.type));
    setSelectedMarkerType((currentType) => (currentType === marker.type ? null : currentType));
    setSetupMessage(`${definitionLabel(marker.type)} removed`);
  }

  function placeDrawing(type: ChartDrawingType, rawPrice: number) {
    const drawing = createDrawing(type, rawPrice, market.symbol, candles);
    setChartDrawings((currentDrawings) => [...currentDrawings, drawing]);
    setActiveChartTool('cursor');
    setSetupMessage(`${drawing.label} placed`);
  }

  function removeDrawing(id: string) {
    const drawing = chartDrawings.find((item) => item.id === id);
    setChartDrawings((currentDrawings) => currentDrawings.filter((item) => item.id !== id));
    setSetupMessage(drawing ? `${drawing.label} removed` : 'Drawing removed');
  }

  function updateIndicatorGroup(key: keyof ChartIndicatorConfig, patch: Partial<ChartIndicatorConfig[keyof ChartIndicatorConfig]>) {
    setIndicatorConfig((currentConfig) => ({
      ...currentConfig,
      [key]: {
        ...currentConfig[key],
        ...patch,
      },
    }) as ChartIndicatorConfig);
  }

  function handleChartToolSelect(tool: ChartToolId) {
    setActiveChartTool(tool);

    if (tool === 'cursor') {
      setSelectedMarkerType(null);
      setSetupMessage('Ready');
      return;
    }

    if (tool === 'long' || tool === 'short') {
      updateDirection(tool);
      setSelectedMarkerType('entry');
      setSetupMessage(`${tool === 'long' ? 'Long' : 'Short'} entry armed`);
      return;
    }

    if (tool === 'alert') {
      setSelectedMarkerType('alert');
      setSetupMessage('Alert armed');
      return;
    }

    if (tool === 'line' || tool === 'zone') {
      setSelectedMarkerType(null);
      setSetupMessage(`${toolLabel(tool)} armed`);
      return;
    }

    if (tool === 'indicators') {
      setSelectedMarkerType(null);
      setIndicatorPanelOpen(true);
      setSetupMessage('Indicators opened');
      return;
    }

    if (tool === 'replay') {
      setSelectedMarkerType(null);
      setSetupMessage('Opening replay');
      router.push(`/backtest/replay?pair=${encodeURIComponent(market.symbol)}`);
      return;
    }

    setSelectedMarkerType(null);
    setSetupMessage(`${toolLabel(tool)} selected`);
  }

  function moveMarker(id: string, rawPrice: number) {
    const marker = tradeMarkers.find((item) => item.id === id);

    if (!marker) {
      return;
    }

    const price = roundPrice(rawPrice);
    setTradeMarkers((currentMarkers) => currentMarkers.map((item) => (item.id === id ? { ...item, price } : item)));
    setDraft((currentDraft) => {
      const nextDraft = syncDraftWithMarker(currentDraft, marker.type, price);
      setPlannedOrderDrafts((currentOrders) => syncPlannedOrdersWithDraft(currentOrders, nextDraft));

      return nextDraft;
    });
  }

  function updateRiskPercent(riskPercent: number) {
    setDraft((currentDraft) => {
      const nextDraft = recalculateDraftSize({ ...currentDraft, riskPercent });
      setPlannedOrderDrafts((currentOrders) => syncPlannedOrdersWithDraft(currentOrders, nextDraft));

      return nextDraft;
    });
  }

  function updateLeverage(nextLeverage: number) {
    setLeverage(Math.min(100, Math.max(1, nextLeverage)));
  }

  function updateDirection(direction: PositionDraft['direction']) {
    setDraft((currentDraft) => {
      const nextDraft = { ...currentDraft, direction };
      setPlannedOrderDrafts((currentOrders) => syncPlannedOrdersWithDraft(currentOrders, nextDraft));

      return nextDraft;
    });
  }

  function selectExecutionIntent(nextIntent: TradeExecutionIntent) {
    setExecutionIntent(nextIntent);

    if (nextIntent === 'manual') {
      setSetupMessage('Manual trade ready');
      return;
    }

    const strategy = selectedStrategy ?? bestStrategyForSymbol(strategyOptions, market.symbol);

    if (strategy) {
      setSelectedStrategyId(strategy.id);
      setSetupMessage(`Strategy source · ${strategy.name}`);
    } else {
      setSetupMessage('No strategy available');
    }
  }

  function chooseExecutionStrategy(strategyId: string) {
    const strategy = strategyOptions.find((item) => item.id === strategyId);

    setExecutionIntent('strategy');
    setSelectedStrategyId(strategyId);

    if (!strategy) {
      setSetupMessage('Strategy unavailable');
      return;
    }

    chooseSymbol(strategy.market);
    setTimeframe(strategy.timeframe);
    setPlannedOrderDrafts([]);

    if (strategy.positionDraft) {
      const nextDraft = recalculateDraftSize({
        ...strategy.positionDraft,
        riskPercent: strategy.riskPerTrade || strategy.positionDraft.riskPercent,
      });
      setDraft(nextDraft);
      setTradeMarkers(markersFromDraft(nextDraft, strategy.market));
    } else {
      setDraft((currentDraft) => recalculateDraftSize({ ...currentDraft, riskPercent: strategy.riskPerTrade || currentDraft.riskPercent }));
    }

    setSetupMessage(`Loaded · ${strategy.name}`);
  }

  function validateExecutionDraft() {
    if (!hasCompletePosition) {
      setSetupMessage('Place Entry + SL + TP');
      return false;
    }

    if (executionIntent === 'strategy' && !selectedStrategy) {
      setSetupMessage('Select strategy first');
      return false;
    }

    if (executionIntent === 'strategy' && !selectedStrategyMatchesMarket) {
      setSetupMessage('Load strategy market');
      return false;
    }

    return true;
  }

  function tradeExecutionPayload(mode: 'paper' | 'live') {
    return {
      draft,
      exchangeId: selectedExchange?.id,
      exchangeName: selectedExchange?.name,
      executionSource: executionIntent,
      leverage,
      mode,
      strategyId: executionIntent === 'strategy' ? selectedStrategy?.id : undefined,
      strategyName: executionIntent === 'strategy' ? selectedStrategy?.name : undefined,
      symbol: market.symbol,
    };
  }

  function requestLiveMode() {
    setLiveConfirmationOpen(true);
  }

  function confirmLiveMode() {
    setExecutionMode('live');
    setLiveConfirmationOpen(false);
  }

  async function executePaperOrder() {
    if (!validateExecutionDraft()) {
      return;
    }

    setSetupMessage('Routing paper');

    try {
      const result = await postJson<{ allowed: boolean }>('/api/trading/execute', tradeExecutionPayload('paper'));

      setSetupMessage(result.allowed ? (executionIntent === 'strategy' ? 'Strategy paper filled' : 'Manual paper filled') : 'Paper blocked');
    } catch (error) {
      setSetupMessage(error instanceof Error ? error.message : 'Paper failed');
    }
  }

  function requestLiveOrderConfirmation() {
    if (!validateExecutionDraft()) {
      return;
    }

    setLiveOrderConfirmationOpen(true);
  }

  async function confirmLiveOrder() {
    if (isLiveOrderBlocked) {
      return;
    }

    setSetupMessage('Routing live');

    try {
      const result = await postJson<{ allowed: boolean }>('/api/trading/execute', tradeExecutionPayload('live'));

      setLiveOrderConfirmationOpen(false);
      setSetupMessage(result.allowed ? (executionIntent === 'strategy' ? 'Strategy live sent' : 'Manual live sent') : 'Live blocked');
    } catch (error) {
      setSetupMessage(error instanceof Error ? error.message : 'Live failed');
    }
  }

  async function addPlannedOrder() {
    if (!hasEntryMarker) {
      setSetupMessage('Place Entry first');
      return;
    }

    if (executionIntent === 'strategy' && !selectedStrategy) {
      setSetupMessage('Select strategy first');
      return;
    }

    if (executionIntent === 'strategy' && !selectedStrategyMatchesMarket) {
      setSetupMessage('Load strategy market');
      return;
    }

    const timestamp = Date.now();
    const orderExchange = executionMode === 'paper' ? 'Paper' : selectedExchange?.name ?? 'Live';
    const nextOrders = [
      createPlannedOrder({
        draft,
        exchange: orderExchange,
        executionSource: executionIntent,
        id: `${clientSlug(market.symbol)}-${timestamp}-plan-entry`,
        kind: 'entry',
        strategy: executionIntent === 'strategy' ? selectedStrategy : undefined,
        symbol: market.symbol,
      }),
      ...(hasCompletePosition
        ? [
            createPlannedOrder({
              draft,
              exchange: orderExchange,
              executionSource: executionIntent,
              id: `${clientSlug(market.symbol)}-${timestamp}-plan-sl`,
              kind: 'stopLoss',
              strategy: executionIntent === 'strategy' ? selectedStrategy : undefined,
              symbol: market.symbol,
            }),
            createPlannedOrder({
              draft,
              exchange: orderExchange,
              executionSource: executionIntent,
              id: `${clientSlug(market.symbol)}-${timestamp}-plan-tp`,
              kind: 'takeProfit',
              strategy: executionIntent === 'strategy' ? selectedStrategy : undefined,
              symbol: market.symbol,
            }),
          ]
        : []),
    ];

    setPlannedOrderDrafts((currentOrders) => [
      ...currentOrders.filter((order) => order.symbol !== market.symbol || (!order.id.endsWith('plan-entry') && !order.id.endsWith('plan-sl') && !order.id.endsWith('plan-tp'))),
      ...nextOrders,
    ]);

    try {
      await Promise.all(nextOrders.map((order) => postJson('/api/orders', order)));
      setSetupMessage(hasCompletePosition ? 'Bracket planned' : 'Entry planned');
    } catch {
      setSetupMessage('Plan not saved');
    }
  }

  async function createSetupAlert() {
    const alertMarker = tradeMarkers.find((marker) => marker.type === 'alert');
    const value = alertMarker?.price ?? draft.takeProfit ?? market.lastPrice;

    setSetupMessage('Creating alert');

    try {
      await postJson('/api/alerts', {
        channel: 'app',
        condition: draft.direction === 'long' ? 'crosses above' : 'crosses below',
        symbol: market.symbol,
        trigger: 'once',
        type: 'price',
        value: String(roundPrice(value)),
      });
      setSetupMessage('Alert active');
    } catch (error) {
      setSetupMessage(error instanceof Error ? error.message : 'Alert failed');
    }
  }

  async function convertSetupToStrategy() {
    if (!hasEntryMarker) {
      setSetupMessage('Place Entry first');
      return;
    }

    setSetupMessage('Converting');

    try {
      const strategy = await postJson<{ id: string }>('/api/strategies', {
        entryConditions: [
          { connector: 'IF', field: 'Entry', id: `entry-${Date.now()}`, operator: draft.direction === 'long' ? 'crosses-above' : 'crosses-below', value: String(roundPrice(draft.entry)) },
          { connector: 'AND', field: 'Stop Loss', id: `stop-${Date.now()}`, operator: draft.direction === 'long' ? 'greater-than' : 'less-than', value: String(roundPrice(draft.stopLoss)) },
        ],
        exitConditions: [
          { connector: 'IF', field: 'Take Profit', id: `tp-${Date.now()}`, operator: draft.direction === 'long' ? 'greater-than' : 'less-than', value: String(roundPrice(draft.takeProfit)) },
          { connector: 'OR', field: 'Risk Engine', id: `risk-${Date.now()}`, operator: 'greater-than', value: `${draft.riskPercent}% risk` },
        ],
        market: market.symbol,
        name: `${market.symbol} ${draft.direction} setup`,
        positionDraft: draft,
        riskPerTrade: draft.riskPercent,
        riskSettings: {
          accountBalance: 25000,
          maxOpenTrades: tradeLimits.maxOpenPositions,
          positionSizing: defaultPreferences.positionSizingMethod,
          rrTarget: riskReward,
          stopLoss: 'Chart marker',
          stopRequired: hasStopLossMarker,
          takeProfit: hasTakeProfitMarker ? 'Chart marker' : 'Manual',
          trailingStop: isTrailingOn,
        },
        setupSnapshot: {
          drawings: chartDrawings,
          markers: tradeMarkers,
          notes: savedSetupNotes,
        },
        status: 'draft',
        timeframe,
        type: draft.direction === 'long' ? 'trend' : 'mean-reversion',
      });
      setSetupMessage('Strategy created');
      router.push(`/strategies/${strategy.id}`);
    } catch (error) {
      setSetupMessage(error instanceof Error ? error.message : 'Convert failed');
    }
  }

  function createCurrentSetup({ id, name }: { id: string; name: string }): SavedChartSetup {
    return {
      chartHeight,
      draft,
      drawings: chartDrawings,
      exchangeId: selectedExchange?.id,
      executionIntent,
      id,
      indicators: indicatorConfig,
      markers: tradeMarkers,
      name,
      notes: savedSetupNotes,
      pair: market.symbol,
      plannedOrders: plannedOrderDrafts,
      riskSettings: {
        breakEven: isBreakEvenOn,
        executionMode,
        leverage,
        riskPercent: draft.riskPercent,
        trailingStop: isTrailingOn,
      },
      savedAt: new Date().toISOString(),
      selectedRange,
      strategyId: executionIntent === 'strategy' ? selectedStrategy?.id : undefined,
      timeframe,
    };
  }

  async function saveSetup() {
    const savedAt = new Date().toISOString();
    const setup = createCurrentSetup({
      id: `setup-${Date.now()}`,
      name: `${market.symbol} ${timeframe} · ${new Date(savedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
    });

    setSavedSetups((currentSetups) => [setup, ...currentSetups].slice(0, maximumSavedSetups));
    setSetupMessage('Saving');

    try {
      await postJson('/api/setups', setup);
      setSetupMessage('Saved');
    } catch {
      setSetupMessage('Saved local');
    }
  }

  function reloadSetup(setup: SavedChartSetup, message = 'Loaded') {
    setupReloadPairRef.current = setup.pair;
    chooseSymbol(setup.pair);
    setTimeframe(setup.timeframe);
    setDraft(setup.draft);
    setChartDrawings(setup.drawings ?? []);
    setIndicatorConfig(normalizeChartIndicatorConfig(setup.indicators));
    setTradeMarkers(setup.markers);
    setPlannedOrderDrafts(setup.plannedOrders);
    setExecutionIntent(setup.executionIntent ?? 'manual');
    setSelectedStrategyId(setup.strategyId ?? '');
    setSelectedRange(setup.selectedRange ?? '1D');
    setSelectedMarkerType(null);
    setActiveChartTool('cursor');
    setLeverage(setup.riskSettings.leverage ?? defaultPreferences.defaultLeverage);
    setIsBreakEvenOn(setup.riskSettings.breakEven ?? defaultPreferences.breakEvenAutomation);
    setIsTrailingOn(setup.riskSettings.trailingStop ?? defaultPreferences.trailingStopEnabled);
    setExecutionMode(setup.riskSettings.executionMode ?? 'paper');
    setSelectedExchangeId(setup.exchangeId ?? defaultExchangeId);
    setChartHeight(setup.chartHeight ?? 640);
    setSavedSetupNotes(setup.notes);
    setSetupMessage(message);
  }

  function resetSetup() {
    reloadSetup({
      draft: market.draft,
      drawings: [],
      exchangeId: defaultExchangeId,
      executionIntent: 'manual',
      id: 'reset',
      indicators: normalizeChartIndicatorConfig(defaultIndicatorConfig),
      markers: [],
      name: 'Reset',
      notes: '',
      pair: market.symbol,
      plannedOrders: [],
      riskSettings: {
        breakEven: defaultPreferences.breakEvenAutomation,
        executionMode: 'paper',
        leverage: defaultPreferences.defaultLeverage,
        riskPercent: market.draft.riskPercent,
        trailingStop: defaultPreferences.trailingStopEnabled,
      },
      savedAt: new Date().toISOString(),
      selectedRange: '1D',
      strategyId: undefined,
      timeframe,
    });
  }

  function handleChartSettings() {
    setIndicatorPanelOpen(true);
    setSetupMessage(`Indicators · ${selectedRange} · ${chartHeight}px`);
  }

  function selectChartEngine(nextEngine: ChartEngine) {
    setChartEngine(nextEngine);
    setSelectedMarkerType(null);
    setActiveChartTool('cursor');
    setIndicatorPanelOpen(false);
    setSetupMessage(nextEngine === 'tradingview' ? 'TradingView ready' : 'Thoon chart ready');
  }

  function expandChart() {
    setChartHeight((currentHeight) => (currentHeight >= 860 ? 640 : 880));
    setSetupMessage(chartHeight >= 860 ? 'Chart restored' : 'Chart expanded');
  }

  function exportChartSnapshot() {
    const snapshot = {
      candles: candles.slice(-60),
      exportedAt: new Date().toISOString(),
      markers: tradeMarkers,
      pair: market.symbol,
      range: selectedRange,
      timeframe,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = href;
    link.download = `thoon-chart-${market.symbol.replace('/', '-')}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(href);
    setSetupMessage('Chart snapshot exported');
  }

  function selectChartRange(range: ChartRange) {
    setSelectedRange(range);
    setSetupMessage(`${range} range selected`);
  }

  function toggleNoteFormat(format: NoteFormat) {
    setNoteFormats((currentFormats) => {
      const isActive = currentFormats.includes(format);

      return isActive ? currentFormats.filter((item) => item !== format) : [...currentFormats, format];
    });
    setSetupMessage(`${format} note mode`);
  }

  function insertNoteTemplate() {
    setSavedSetupNotes((currentNotes) => {
      const nextLine = `- ${market.symbol} ${timeframe}: `;

      return currentNotes ? `${currentNotes}\n${nextLine}` : nextLine;
    });
    setNoteFormats((currentFormats) => (currentFormats.includes('list') ? currentFormats : [...currentFormats, 'list']));
    setSetupMessage('List inserted');
  }

  function openNotesOnChart() {
    setSavedSetupNotes((currentNotes) => currentNotes || `${market.symbol} setup: watch entry, SL and TP alignment.`);
    setSetupMessage('Notes linked to setup');
  }

  return (
    <section className="charts-page charts-page--terminal" aria-label="Charts workspace">
      <div className="cockpit-page-head">
        <div className="cockpit-page-title">
          <span className="cockpit-title-mark" aria-hidden="true">
            <ShieldCheck size={24} />
          </span>
          <div>
            <p className="workspace-kicker">Thoon cockpit</p>
            <h1>Cockpit trading</h1>
          </div>
        </div>
        <div className="cockpit-page-badges" aria-label="Workspace status">
          <StrategyAgentDrawer context="chart" reports={agentReports} runs={agentRuns} settings={agentSettings} strategyName={`${market.symbol} setup`} suggestions={agentSuggestions} versions={agentVersions.filter((version) => version.marketsTested.includes(market.symbol))} />
          <span className={selectedMarketDataIsLive ? 'cockpit-chip cockpit-chip--positive' : 'cockpit-chip cockpit-chip--warning'}>
            {exchangeMarketStatusLabel(selectedExchange, selectedMarketDataIsLive, hasBinancePrices, chartCandleStatus)}
          </span>
          <span className="cockpit-chip cockpit-chip--primary">Journal · {journalTrades.length} trades</span>
          <span className="cockpit-chip cockpit-chip--warning">Risk · runtime</span>
          <span className={executionMode === 'live' ? (selectedExchangeCanTrade ? 'cockpit-chip cockpit-chip--positive' : 'cockpit-chip cockpit-chip--negative') : 'cockpit-chip cockpit-chip--warning'}>
            {executionMode === 'live' ? (selectedExchangeCanTrade ? 'Live arme' : 'Live bloque') : 'Paper actif'}
          </span>
        </div>
      </div>

      <div className="cockpit-health-strip" aria-label="Runtime health">
        <span className="cockpit-chip cockpit-chip--warning">
          <AlertTriangle size={15} />
          {selectedMarketDataIsLive ? `Prix live · ${selectedExchange?.name ?? 'Exchange'}` : chartCandleStatus === 'loading' ? 'Prix public · chargement' : 'Prix public indisponible'}
        </span>
        <label className="cockpit-chip cockpit-chip--primary cockpit-chip--select">
          <span>{selectedExchange?.name ?? 'Exchange'} · {chartMarketLabel}</span>
          <select aria-label="Chart exchange" onChange={(event) => setSelectedExchangeId(event.target.value)} value={selectedExchange?.id ?? ''}>
            {exchangeConnections.map((exchangeConnection) => (
              <option key={exchangeConnection.id} value={exchangeConnection.id}>
                {exchangeConnection.name} · {exchangeConnection.status}
              </option>
            ))}
          </select>
        </label>
        <span className={selectedExchange?.status === 'connected' ? 'cockpit-chip cockpit-chip--positive' : 'cockpit-chip cockpit-chip--warning'}>
          {exchangeCapabilityLabel(selectedExchange, isBinanceLive, chartCandleStatus, chartMarketType)}
        </span>
        <span className="cockpit-chip cockpit-chip--positive">Live {market.symbol} · {formatUsd(visibleMarketPrice)}</span>
        <span className="cockpit-chip cockpit-chip--negative">Entrees suspendues</span>
        <span className="cockpit-chip cockpit-chip--violet">{lastEventAt ? `Tick · ${new Date(lastEventAt).toLocaleTimeString('fr-FR')}` : 'Verifie · risk engine · config'}</span>
      </div>

      <div className="charts-market-strip" aria-label="Market ticker">
        {marketStripPairs.map((pair) => {
          const isActivePair = pair.symbol === market.symbol;
          const stripPrice = isActivePair ? visibleMarketPrice : pair.lastPrice;

          return (
            <button className={isActivePair ? 'is-active' : undefined} key={pair.symbol} onClick={() => chooseSymbol(pair.symbol)} type="button">
              <span className="charts-market-strip__coin">{pair.base.slice(0, 1)}</span>
              <strong>{pair.symbol}</strong>
              <span>{formatUsd(stripPrice)}</span>
              <em className={pair.change24h >= 0 ? 'positive' : 'negative'}>{formatPercent(pair.change24h)}</em>
            </button>
          );
        })}
      </div>

      <div className="charts-terminal-grid">
        <Card className="chart-panel chart-panel--terminal" style={{ '--chart-height': `${chartHeight}px` } as CSSProperties}>
          <div className="chart-panel__bar">
            <div className="chart-panel__bar-data">
              <select
                aria-label="Pair theme"
                className="chart-theme-select"
                onChange={(event) => choosePairTheme(event.target.value as MarketCategory)}
                value={selectedPairTheme}
              >
                {pairThemes
                  .filter((theme) => theme.key === 'all' || theme.key === selectedPairTheme || countPairsByTheme(liveMarketPairs, theme.key) > 0)
                  .map((theme) => (
                    <option key={theme.key} value={theme.key}>
                      {theme.label} · {countPairsByTheme(liveMarketPairs, theme.key)}
                    </option>
                  ))}
              </select>
              <select
                aria-label="Market pair"
                className="chart-pair-select"
                onChange={(event) => chooseSymbol(event.target.value)}
                value={market.symbol}
              >
                {pairThemeGroups.map((group) => (
                  <optgroup key={group.key} label={`${group.label} · ${group.pairs.length}`}>
                    {group.pairs.map((pair) => (
                      <option key={pair.symbol} value={pair.symbol}>
                        {formatPairOption(pair)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="chart-instrument-name">{market.symbol} · {timeframeLabel(timeframe)} · {chartVenueName} · {chartMarketLabel}</span>
              {hasChartCandles ? (
                <>
                  <span className="positive">O {formatUsd(candles[0].open)}</span>
                  <span>H {formatUsd(high)}</span>
                  <span>L {formatUsd(low)}</span>
                  <span>C {formatUsd(lastCandle.close)}</span>
                </>
              ) : (
                <span className={chartCandleStatus === 'loading' ? 'warning' : 'negative'}>
                  {chartCandleStatus === 'loading' ? `Loading ${chartVenueName} public candles` : `No public candles from ${chartVenueName}`}
                </span>
              )}
              <span className={chartCandleStatus === 'live' ? 'positive' : 'warning'}>{timeframeLabel(timeframe)} {chartCandleStatus === 'loading' ? 'loading' : chartCandleStatus === 'fallback' ? 'unavailable' : 'live'}</span>
            </div>
            <div className="chart-panel__actions" aria-label="Chart actions">
              <div className="chart-engine-switch" aria-label="Chart engine">
                <button className={chartEngine === 'thoon' ? 'is-active' : undefined} onClick={() => selectChartEngine('thoon')} type="button">
                  Thoon
                </button>
                <button className={chartEngine === 'tradingview' ? 'is-active' : undefined} onClick={() => selectChartEngine('tradingview')} type="button">
                  TradingView
                </button>
              </div>
              <TimeframeMenu items={chartTimeframes} onChange={setTimeframe} value={timeframe} />
              <IconButton icon={<Settings2 size={17} />} label="Chart settings" onClick={handleChartSettings} />
              <IconButton icon={<Maximize2 size={17} />} label="Fullscreen" onClick={expandChart} />
              <IconButton icon={<Camera size={17} />} label="Screenshot" onClick={exportChartSnapshot} />
              <label className="chart-height-control" title="Chart height">
                <ChevronsUpDown size={16} />
                <span className="sr-only">Chart height</span>
                <input aria-label="Chart height" max="900" min="520" onChange={(event) => setChartHeight(Number(event.target.value))} step="20" type="range" value={chartHeight} />
              </label>
              <HelpPopover items={['Markers update the position panel.', 'Live execution is gated by the Risk Engine.']} title="Charts" />
            </div>
          </div>

          <div className={`chart-panel__body${isTradingViewEngine ? ' chart-panel__body--tradingview' : ''}`}>
            {!isTradingViewEngine ? (
              <div className="chart-tools" aria-label="Chart tools">
                <Tool icon={<MousePointer2 size={18} />} isActive={activeChartTool === 'cursor' && !selectedMarkerType} label="Cursor" onClick={() => handleChartToolSelect('cursor')} />
                <Tool icon={<MoveDiagonal size={18} />} isActive={activeChartTool === 'line'} label="Line" onClick={() => handleChartToolSelect('line')} />
                <Tool icon={<Square size={18} />} isActive={activeChartTool === 'zone'} label="Zone" onClick={() => handleChartToolSelect('zone')} />
                <Tool icon={<TrendingUp size={18} />} isActive={activeChartTool === 'long'} label="Long" onClick={() => handleChartToolSelect('long')} />
                <Tool icon={<TrendingDown size={18} />} isActive={activeChartTool === 'short'} label="Short" onClick={() => handleChartToolSelect('short')} />
                <Tool icon={<Bell size={18} />} isActive={activeChartTool === 'alert' || selectedMarkerType === 'alert'} label="Alert" onClick={() => handleChartToolSelect('alert')} />
                <Tool icon={<Activity size={18} />} isActive={indicatorPanelOpen} label="Indicators" onClick={() => handleChartToolSelect('indicators')} />
                <Tool icon={<RotateCcw size={18} />} isActive={activeChartTool === 'replay'} label="Replay" onClick={() => handleChartToolSelect('replay')} />
              </div>
            ) : null}

            <div className={`chart-canvas${isTradingViewEngine ? ' chart-canvas--tradingview' : ''}`} aria-label={`${market.symbol} ${isTradingViewEngine ? 'TradingView' : 'candlestick'} chart`}>
              {isTradingViewEngine ? (
                <TradingViewChart exchangeId={selectedExchange?.id ?? selectedExchangeId} marketType={chartMarketType} symbol={market.symbol} timeframe={timeframe} />
              ) : (
                <>
                  {hasChartCandles ? (
                    <>
                      <div className="chart-indicator-readout" aria-label="Chart indicators">
                        <strong>{market.symbol} · {timeframeLabel(timeframe)} · {chartVenueName} · {chartMarketLabel}</strong>
                        <span>
                          O {formatUsd(lastCandle.open)} H {formatUsd(lastCandle.high)} L {formatUsd(lastCandle.low)} C {formatUsd(lastCandle.close)}
                          <b className={lastMove >= 0 ? 'positive' : 'negative'}>
                            {lastMove >= 0 ? ' +' : ' '}
                            {formatUsd(lastMove)} ({formatPercent(lastMovePercent)})
                          </b>
                        </span>
                        {indicatorReadouts.map((indicator) => (
                          <span key={indicator.label}>
                            {indicator.label} <b className={indicator.tone}>{indicator.value}</b>
                          </span>
                        ))}
                      </div>
                      <TradingChart
                        activeDrawingTool={activeChartTool === 'line' || activeChartTool === 'zone' ? activeChartTool : undefined}
                        activeMarkerLabel={selectedMarkerDefinition?.label}
                        activeMarkerType={selectedMarkerType ?? undefined}
                        candles={candles}
                        dataIdentity={chartDataIdentity}
                        drawings={chartDrawings}
                        fallbackPrice={draft.entry}
                        indicators={indicatorConfig}
                        markers={tradeMarkers}
                        onAddDrawing={placeDrawing}
                        onDropMarker={placeMarker}
                        onRemoveDrawing={removeDrawing}
                        onRemoveMarker={removeMarker}
                        onUpdateMarkerPrice={moveMarker}
                        positionPreview={positionPreview}
                      />
                    </>
                  ) : (
                    <ChartCandleState
                      exchangeName={chartVenueName}
                      onRetry={() => setCandleRequestNonce((current) => current + 1)}
                      status={chartCandleStatus}
                      symbol={market.symbol}
                      timeframe={timeframe}
                    />
                  )}

                  <div className="trade-markers-panel trade-markers-panel--floating" aria-label="Trade Markers">
                    <div className="trade-markers-panel__head">
                      <strong>Trade Markers</strong>
                      <InfoButton content="Select an instrument, then place it on the chart." label="Trade Markers info" />
                    </div>
                    {selectedMarkerDefinition ? (
                      <div className="marker-placement-status" style={{ '--marker-color': selectedMarkerDefinition.color } as CSSProperties}>
                        <span>{selectedMarkerDefinition.shortLabel} armed</span>
                        <button aria-label="Cancel marker placement" onClick={() => setSelectedMarkerType(null)} type="button">
                          ×
                        </button>
                      </div>
                    ) : null}
                    <div className="trade-marker-tools">
                      {markerDefinitions.map((markerDefinition) => (
                        <button
                          aria-pressed={selectedMarkerType === markerDefinition.type}
                          className={selectedMarkerType === markerDefinition.type ? 'is-active' : undefined}
                          draggable
                          key={markerDefinition.type}
                          onClick={() => selectMarkerTool(markerDefinition.type)}
                          onDragStart={(event) => {
                            event.dataTransfer.setData(markerDropDataType, markerDefinition.type);
                            setSelectedMarkerType(null);
                            setSetupMessage(`${markerDefinition.shortLabel} drag`);
                          }}
                          style={{ '--marker-color': markerDefinition.color } as CSSProperties}
                          type="button"
                        >
                          {markerDefinition.icon}
                          <span>{markerDefinition.label}</span>
                          <MoveDiagonal size={13} />
                        </button>
                      ))}
                    </div>
                    {tradeMarkers.length ? (
                      <div className="placed-marker-list">
                        {tradeMarkers.map((marker) => (
                          <div className="placed-marker-row" key={marker.id} style={{ '--marker-color': marker.color } as CSSProperties}>
                            <span>{marker.label}</span>
                            <strong>{formatUsd(marker.price)}</strong>
                            <button aria-label={`Edit ${marker.label}`} onClick={() => selectMarkerTool(marker.type)} type="button">
                              <MoveDiagonal size={12} />
                            </button>
                            <button aria-label={`Remove ${marker.label}`} onClick={() => removeMarker(marker.id)} type="button">
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>

          {hasCompletePosition ? (
            <div className="chart-scenario" aria-label="Scenario notes">
              <span>
                <FileText size={15} />
                {draft.direction === 'long' ? 'Long setup' : 'Short setup'}
              </span>
              <strong>Invalid {draft.direction === 'long' ? '<' : '>'} {formatUsd(draft.stopLoss)}</strong>
            </div>
          ) : null}

          <div className="chart-footer">
            <span />
            <div>
              {chartRanges.map((range) => (
                <button className={selectedRange === range ? 'is-active' : undefined} key={range} onClick={() => selectChartRange(range)} type="button">
                  {range}
                </button>
              ))}
              <b>%</b>
              <b>log</b>
              <b>auto</b>
            </div>
          </div>
        </Card>

        <Card className="trade-panel trade-panel--terminal">
          <div className="trade-panel__header">
            <div>
              <h2>Position Builder</h2>
              <span className="trade-panel__status">{setupMessage}</span>
            </div>
            <button className="trade-panel__reset" onClick={resetSetup} type="button">
              Reset
            </button>
          </div>

          <div className="segmented-control" aria-label="Direction">
            <Button isActive={draft.direction === 'long'} onClick={() => updateDirection('long')} size="sm" variant={draft.direction === 'long' ? 'primary' : 'ghost'}>
              Long
            </Button>
            <Button isActive={draft.direction === 'short'} onClick={() => updateDirection('short')} size="sm" variant={draft.direction === 'short' ? 'primary' : 'ghost'}>
              Short
            </Button>
          </div>

          <label className="trade-pair-control">
            <span>{market.symbol}</span>
            <select aria-label="Trade pair" onChange={(event) => chooseSymbol(event.target.value)} value={market.symbol}>
              {pairThemeGroups.map((group) => (
                <optgroup key={group.key} label={`${group.label} · ${group.pairs.length}`}>
                  {group.pairs.map((pair) => (
                    <option key={pair.symbol} value={pair.symbol}>
                      {formatPairOption(pair)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="trade-pair-control">
            <span>{selectedExchange?.name ?? 'Exchange'}</span>
            <select aria-label="Execution exchange" onChange={(event) => setSelectedExchangeId(event.target.value)} value={selectedExchange?.id ?? ''}>
              {exchangeConnections.map((exchangeConnection) => (
                <option key={exchangeConnection.id} value={exchangeConnection.id}>
                  {exchangeConnection.name} · {exchangeConnection.permissions.includes('trade') ? 'trade' : exchangeConnection.status}
                </option>
              ))}
            </select>
          </label>

          <div className="trade-source-card">
            <div className="trade-source-row" aria-label="Trade source">
              <button className={executionIntent === 'manual' ? 'is-active' : undefined} onClick={() => selectExecutionIntent('manual')} type="button">
                Manuel
              </button>
              <button className={executionIntent === 'strategy' ? 'is-active' : undefined} onClick={() => selectExecutionIntent('strategy')} type="button">
                Strategie
              </button>
            </div>
            {executionIntent === 'strategy' ? (
              <label className="trade-strategy-control">
                <span>Strategie</span>
                <select aria-label="Trade strategy" disabled={strategyOptions.length === 0} onChange={(event) => chooseExecutionStrategy(event.target.value)} value={selectedStrategyId}>
                  <option value="">Choisir</option>
                  {strategyOptions.map((strategy) => (
                    <option key={strategy.id} value={strategy.id}>
                      {strategy.name} · {strategy.market} · {strategy.timeframe}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="trade-source-note">Trade libre sur tes prix, avec confirmation live.</span>
            )}
            {executionIntent === 'strategy' && selectedStrategy ? (
              <span className={selectedStrategyMatchesMarket ? 'trade-source-note is-linked' : 'trade-source-note is-warning'}>
                {selectedStrategyMatchesMarket ? `${selectedStrategy.name} liee a ${market.symbol}` : `Charge ${selectedStrategy.market} pour executer cette strategie.`}
              </span>
            ) : null}
          </div>

          <div className="position-builder-fields position-builder-fields--terminal">
            <BuilderField label="Entry" onChange={(value) => upsertMarker('entry', value)} value={draft.entry} />
            <BuilderField info="Live orders are invalid without stop-loss." label="Stop Loss" onChange={(value) => upsertMarker('stopLoss', value)} tone="negative" value={draft.stopLoss} />
            <BuilderField info="Main target used for R/R." label="Take Profit" onChange={(value) => upsertMarker('takeProfit', value)} tone="positive" value={draft.takeProfit} />
            <BuilderField label="TP2" onChange={(value) => upsertMarker('tp2', value)} tone="positive" value={tp2Marker?.price ?? roundPrice(suggestedMarkerPrice('tp2', draft))} />
          </div>

          <div className="marker-sync-strip" aria-label="Linked trade markers">
            {markerSyncRows.map((row) => (
              <span className={row.placed ? 'is-linked' : undefined} key={row.label}>
                {row.label}
                <strong>{row.value}</strong>
              </span>
            ))}
          </div>

          <div className="builder-risk-row">
            <span>
              Risk %
              <TooltipInfo content="Changing risk recalculates position size." label="Risk percent info" />
            </span>
            <div>
              {[0.5, 1, 2, 5].map((riskOption) => (
                <button className={draft.riskPercent === riskOption ? 'is-active' : undefined} key={riskOption} onClick={() => updateRiskPercent(riskOption)} type="button">
                  {riskOption}%
                </button>
              ))}
            </div>
          </div>

          <div className="builder-toggle-grid" aria-label="Position automation">
            <button className={`builder-toggle${isBreakEvenOn ? ' is-on' : ''}`} onClick={() => setIsBreakEvenOn((current) => !current)} type="button">
              Break-even {isBreakEvenOn ? 'ON' : 'OFF'}
            </button>
            <button className={`builder-toggle${isTrailingOn ? ' is-on' : ''}`} onClick={() => setIsTrailingOn((current) => !current)} type="button">
              Trailing {isTrailingOn ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="trade-risk-card">
            <div className="trade-risk-card__visual">
              <span />
            </div>
            <div>
              <Metric label="R/R" value={hasCompletePosition ? riskReward.toFixed(2) : '--'} />
              <Metric label="Potential Profit" tone="positive" value={hasCompletePosition ? `${formatCompact(potentialProfit)} USDT` : '--'} />
              <Metric label="Potential Loss" tone="negative" value={hasCompletePosition ? `${formatCompact(potentialLoss)} USDT` : '--'} />
            </div>
          </div>

          <div className="trade-compact-grid">
            <BuilderField label="Size" readOnly value={hasCompletePosition ? `${draft.size.toFixed(4)} ${market.base}` : `-- ${market.base}`} />
            <BuilderField label="Leverage" onChange={updateLeverage} suffix="x" value={leverage} />
            <Metric label="Fees" value={hasCompletePosition ? formatCompactUsd(estimatedFees) : '--'} />
            <Metric label="Break-even" value={hasCompletePosition && isBreakEvenOn ? formatUsd(draft.entry + estimatedFees / Math.max(draft.size, 1)) : '--'} />
            <Metric label="Margin" value={hasCompletePosition ? formatCompactUsd(margin) : '--'} />
            <Metric label="Liq." tone="negative" value={hasCompletePosition ? formatUsd(liquidationPrice) : '--'} />
          </div>

          <div className="trade-mode-row" aria-label="Execution mode">
            <button className={executionMode === 'paper' ? 'is-active' : undefined} onClick={() => setExecutionMode('paper')} type="button">
              Paper Trade
            </button>
            <button className={executionMode === 'live' ? 'is-active' : undefined} onClick={requestLiveMode} type="button">
              Live Trade
            </button>
          </div>

          {executionMode === 'live' && !selectedExchangeCanTrade ? (
            <div className="trade-panel-alert">
              <AlertTriangle size={14} />
              <span>{selectedExchange?.name ?? 'Exchange'} n'a pas la permission trade.</span>
            </div>
          ) : null}

          <Button className="execute-button" disabled={isExecutionBlocked} onClick={executionMode === 'live' ? requestLiveOrderConfirmation : executePaperOrder} variant="primary">
            {executionMode === 'live' ? (executionIntent === 'strategy' ? 'Execute Strategy Live' : 'Execute Manual Live') : executionIntent === 'strategy' ? 'Execute Strategy Paper' : 'Execute Manual Paper'}
          </Button>

          <div className="trade-panel__actions">
            <Link
              aria-label="Create setup alert"
              className="ui-button ui-button--ghost ui-button--sm"
              href={alertBuilderHref}
              onClick={(event) => {
                event.preventDefault();
                void createSetupAlert();
              }}
            >
              <span className="ui-button__icon">
                <Bell size={15} />
              </span>
              <span>Create Alert</span>
            </Link>
            <Button icon={<Save size={15} />} onClick={saveSetup} size="sm" variant="ghost">
              Save Setup
            </Button>
            <Link
              aria-label="Convert setup to strategy"
              className="ui-button ui-button--ghost ui-button--sm"
              href={strategyBuilderHref}
              onClick={(event) => {
                event.preventDefault();
                void convertSetupToStrategy();
              }}
            >
              <span className="ui-button__icon">
                <FileText size={15} />
              </span>
              <span>Convert</span>
            </Link>
          </div>

          <small className="trade-panel__note">Manuel ou strategie: tu peux armer le live quand tu veux, puis le Risk Engine confirme avant envoi.</small>
        </Card>

        <div className="bottom-panels">
          <Card className="planned-orders-card">
            <div className="bottom-card-header">
              <h2>Planned Orders</h2>
              <button onClick={addPlannedOrder} type="button">+ Add Order</button>
            </div>
            <div className="planned-orders-table">
              <span>Type</span>
              <span>Side</span>
              <span>Price</span>
              <span>Size</span>
              <span>Status</span>
              {orders.slice(0, 4).map((order) => (
                <div className="planned-orders-table__row" key={order.id}>
                  <strong className={order.type === 'stop' ? 'negative' : order.type === 'take-profit' ? 'positive' : undefined}>{formatOrderKind(order.type)}</strong>
                  <b className={order.side === 'buy' ? 'positive' : 'negative'}>{order.side}</b>
                  <span>{formatUsd(order.price)}</span>
                  <span>
                    {order.size.toFixed(3)} {market.base}
                  </span>
                  <em className={order.status === 'planned' ? 'warning' : 'positive'}>{order.status}</em>
                </div>
              ))}
              {orders.length === 0 ? <div className="planned-orders-table__empty">No orders</div> : null}
            </div>
          </Card>

          <Card className="scenario-notes-card">
            <div className="bottom-card-header">
              <h2>Scenario Notes</h2>
              <span>{savedSetupNotes.length}/2000</span>
            </div>
            <div className="scenario-notes-toolbar" aria-label="Scenario note tools">
              <button className={noteFormats.includes('bold') ? 'is-active' : undefined} onClick={() => toggleNoteFormat('bold')} type="button">B</button>
              <button className={noteFormats.includes('italic') ? 'is-active' : undefined} onClick={() => toggleNoteFormat('italic')} type="button">I</button>
              <button className={noteFormats.includes('list') ? 'is-active' : undefined} onClick={insertNoteTemplate} type="button">≡</button>
              <button onClick={openNotesOnChart} type="button">↗</button>
            </div>
            <div className="scenario-notes-body">
              <textarea aria-label="Scenario notes" maxLength={2000} onChange={(event) => setSavedSetupNotes(event.target.value)} placeholder="Notes" value={savedSetupNotes} />
            </div>
          </Card>

          <Card className="analysis-setups-card">
            <div className="bottom-card-header">
              <h2>Analyses</h2>
              <button onClick={() => void saveSetup()} type="button">+ Save</button>
            </div>
            <div className="analysis-autosave-row">
              <span>Autosave</span>
              <strong>{autoSavedAt ? formatSetupTime(autoSavedAt) : 'Ready'}</strong>
            </div>
            <div className="analysis-current-summary" aria-label="Current analysis summary">
              {analysisSummaryItems({ drawings: chartDrawings, markers: tradeMarkers, notes: savedSetupNotes, orders: plannedOrderDrafts }).map((item) => (
                <span key={item.label}>
                  {item.label}
                  <strong>{item.value}</strong>
                </span>
              ))}
            </div>
            <div className="analysis-setups-list" aria-label="Saved analysis setups">
              {savedSetups.length ? (
                savedSetups.slice(0, 5).map((setup) => (
                  <button key={setup.id} onClick={() => reloadSetup(setup)} type="button">
                    <span>
                      <strong>{setup.name}</strong>
                      <small>{setupSummary(setup)}</small>
                    </span>
                    <em>{formatSetupTime(setup.savedAt)}</em>
                  </button>
                ))
              ) : (
                <div className="analysis-setups-empty">No saved analysis yet</div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Modal onClose={() => setLiveConfirmationOpen(false)} open={liveConfirmationOpen} title="Confirm Live Mode">
        <div className="confirmation-modal-body">
          <p>Live trading requires risk engine validation before any real order.</p>
          <div>
            <Button size="sm" variant="ghost" onClick={() => setLiveConfirmationOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={confirmLiveMode}>
              Confirm
            </Button>
          </div>
        </div>
      </Modal>

      <IndicatorSettingsModal
        config={indicatorConfig}
        onClose={() => setIndicatorPanelOpen(false)}
        onUpdate={updateIndicatorGroup}
        open={indicatorPanelOpen}
      />

      <LiveOrderModal
        account={defaultPreferences.defaultAccount}
        draft={draft}
        exchange={liveExchange}
        executionIntent={executionIntent}
        estimatedFees={estimatedFees}
        isBlocked={isLiveOrderBlocked}
        leverage={leverage}
        onCancel={() => setLiveOrderConfirmationOpen(false)}
        onConfirm={confirmLiveOrder}
        open={liveOrderConfirmationOpen}
        orderType={defaultPreferences.orderType}
        pair={market.symbol}
        potentialLoss={potentialLoss}
        potentialProfit={potentialProfit}
        riskChecks={liveOrderChecks}
        strategyName={executionIntent === 'strategy' ? selectedStrategy?.name : undefined}
      />
    </section>
  );
}

function TargetIcon() {
  return <CircleDot size={15} />;
}

function ChartCandleState({
  exchangeName,
  onRetry,
  status,
  symbol,
  timeframe,
}: {
  exchangeName: string;
  onRetry: () => void;
  status: 'fallback' | 'live' | 'loading';
  symbol: string;
  timeframe: Timeframe;
}) {
  const isLoading = status === 'loading';

  return (
    <div className="chart-candle-state" role={isLoading ? 'status' : 'alert'}>
      <Activity size={22} />
      <div>
        <h2>{isLoading ? 'Loading public candles' : 'Public candles unavailable'}</h2>
        <p>{symbol} · {timeframe} · {exchangeName}</p>
      </div>
      <Button disabled={isLoading} onClick={onRetry} size="sm" variant="ghost">
        Retry
      </Button>
    </div>
  );
}

type IndicatorSettingsModalProps = {
  config: ChartIndicatorConfig;
  onClose: () => void;
  onUpdate: (key: keyof ChartIndicatorConfig, patch: Partial<ChartIndicatorConfig[keyof ChartIndicatorConfig]>) => void;
  open: boolean;
};

function IndicatorSettingsModal({ config, onClose, onUpdate, open }: IndicatorSettingsModalProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<IndicatorCategory | 'All'>('All');
  const normalizedConfig = normalizeChartIndicatorConfig(config);
  const activeCount = indicatorCatalog.filter((indicator) => normalizedConfig[indicator.key].enabled).length;
  const filteredCatalog = indicatorCatalog.filter((indicator) => {
    const matchesCategory = category === 'All' || indicator.category === category;
    const haystack = `${indicator.label} ${indicator.description} ${indicator.category}`.toLowerCase();

    return matchesCategory && haystack.includes(query.trim().toLowerCase());
  });

  return (
    <Modal onClose={onClose} open={open} title="Indicators">
      <div className="indicator-settings-panel">
        <div className="indicator-library-head">
          <div>
            <strong>{indicatorCatalog.length} indicators</strong>
            <span>{activeCount} active · Trend, momentum, volatility and volume</span>
          </div>
          <button
            onClick={() => {
              setQuery('');
              setCategory('All');
            }}
            type="button"
          >
            Reset View
          </button>
        </div>
        <label className="indicator-search-field">
          <Search size={15} />
          <input aria-label="Search indicators" onChange={(event) => setQuery(event.target.value)} placeholder="Search RSI, MACD, Ichimoku..." value={query} />
        </label>
        <div className="indicator-category-tabs" aria-label="Indicator categories">
          {indicatorCategories.map((item) => (
            <button className={category === item ? 'is-active' : undefined} key={item} onClick={() => setCategory(item)} type="button">
              {item}
            </button>
          ))}
        </div>
        <div className="indicator-library-list">
          {filteredCatalog.map((indicator) => (
            <IndicatorControl
              config={normalizedConfig[indicator.key] as Record<string, boolean | number>}
              indicator={indicator}
              key={indicator.key}
              onUpdate={(patch) => onUpdate(indicator.key, patch as Partial<ChartIndicatorConfig[keyof ChartIndicatorConfig]>)}
            />
          ))}
        </div>
        <Button onClick={onClose} size="sm" variant="primary">
          Apply
        </Button>
      </div>
    </Modal>
  );
}

function IndicatorControl({
  config,
  indicator,
  onUpdate,
}: {
  config: Record<string, boolean | number>;
  indicator: IndicatorCatalogItem;
  onUpdate: (patch: Record<string, boolean | number>) => void;
}) {
  const enabled = Boolean(config.enabled);

  return (
    <div className={`indicator-control-row${enabled ? ' is-active' : ''}`}>
      <button className={enabled ? 'is-active' : undefined} onClick={() => onUpdate({ enabled: !enabled })} type="button">
        <span>
          <strong>{indicator.label}</strong>
          <small>{indicator.category}</small>
        </span>
      </button>
      <p>{indicator.description}</p>
      {indicator.fields.length ? (
        <div className="indicator-field-grid">
          {indicator.fields.map((field) => (
            <label key={field.key}>
              <span>{field.label}</span>
              <input
                max={field.max}
                min={field.min}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);

                  if (Number.isFinite(nextValue)) {
                    onUpdate({ [field.key]: clampIndicatorField(nextValue, field) });
                  }
                }}
                step={field.step ?? 1}
                type="number"
                value={Number(config[field.key] ?? field.min)}
              />
            </label>
          ))}
        </div>
      ) : (
        <span className="indicator-no-fields">No parameters</span>
      )}
    </div>
  );
}

function clampIndicatorField(value: number, field: IndicatorField) {
  const clamped = Math.min(field.max ?? Number.POSITIVE_INFINITY, Math.max(field.min, value));

  return field.step && field.step < 1 ? Number(clamped.toFixed(3)) : Math.round(clamped);
}

function TimeframeMenu({ items, onChange, value }: { items: Timeframe[]; onChange: (value: Timeframe) => void; value: Timeframe }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`chart-timeframe-menu${open ? ' is-open' : ''}`}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;

        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          setOpen(false);
        }
      }}
    >
      <button aria-expanded={open} aria-haspopup="menu" className="chart-timeframe-menu__trigger" onClick={() => setOpen((current) => !current)} type="button">
        <span>{timeframeLabel(value)}</span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="chart-timeframe-menu__content" role="menu" aria-label="Timeframes">
          {items.map((item) => (
            <button
              aria-checked={item === value}
              className={item === value ? 'is-active' : undefined}
              key={item}
              onClick={() => {
                onChange(item);
                setOpen(false);
              }}
              role="menuitemradio"
              type="button"
            >
              {timeframeLabel(item)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function createMarker(type: TradeMarkerType, price: number, symbol: string): TradeMarker {
  const definition = markerDefinitions.find((item) => item.type === type) ?? markerDefinitions[0];

  return {
    color: definition.color,
    id: `${symbol}-${type}`,
    label: definition.shortLabel,
    price: roundPrice(price),
    type,
  };
}

function createDrawing(type: ChartDrawingType, rawPrice: number, symbol: string, candles: Candle[]): ChartDrawing {
  const price = roundPrice(rawPrice);
  const candleHigh = Math.max(...candles.map((candle) => candle.high));
  const candleLow = Math.min(...candles.map((candle) => candle.low));
  const zoneSpan = Math.max((candleHigh - candleLow) * 0.08, price * 0.002);
  const id = `${clientSlug(symbol)}-${type}-${Date.now()}`;

  if (type === 'zone') {
    return {
      color: '#a56cff',
      id,
      label: 'Zone',
      lowerPrice: roundPrice(price - zoneSpan),
      price,
      type,
      upperPrice: roundPrice(price + zoneSpan),
    };
  }

  return {
    color: '#26c8ff',
    id,
    label: 'Line',
    price,
    type,
  };
}

function hasMarkerType(markers: TradeMarker[], type: TradeMarkerType) {
  return markers.some((marker) => marker.type === type);
}

function definitionLabel(type: TradeMarkerType) {
  return markerDefinitions.find((item) => item.type === type)?.shortLabel ?? 'Marker';
}

function toolLabel(tool: ChartToolId) {
  switch (tool) {
    case 'cursor':
      return 'Cursor';
    case 'line':
      return 'Line';
    case 'zone':
      return 'Zone';
    case 'long':
      return 'Long';
    case 'short':
      return 'Short';
    case 'alert':
      return 'Alert';
    case 'indicators':
      return 'Indicators';
    case 'replay':
      return 'Replay';
  }
}

function syncDraftWithMarker(draft: PositionDraft, type: TradeMarkerType, price: number): PositionDraft {
  switch (type) {
    case 'entry':
    case 'buyLimit':
    case 'sellLimit':
      return recalculateDraftSize({ ...draft, entry: price });
    case 'exit':
    case 'takeProfit':
      return recalculateDraftSize({ ...draft, takeProfit: price });
    case 'stopLoss':
      return recalculateDraftSize({ ...draft, stopLoss: price });
    case 'alert':
    case 'tp2':
      return draft;
  }
}

function syncLastCandleToTicker(candles: Candle[], lastPrice: number, timeframe: Timeframe, eventTimeMs?: number) {
  const normalizedCandles = sanitizeCandles(candles);

  if (!normalizedCandles.length || !Number.isFinite(lastPrice) || lastPrice <= 0) {
    return candles;
  }

  const lastIndex = normalizedCandles.length - 1;
  const lastCandle = normalizedCandles[lastIndex];
  const close = roundPrice(lastPrice);
  const eventTimeSeconds = Math.floor((eventTimeMs ?? Date.now()) / 1000);
  const currentCandleTime = timeframeBucketStart(eventTimeSeconds, timeframe);

  if (currentCandleTime < lastCandle.time) {
    return normalizedCandles;
  }

  if (currentCandleTime > lastCandle.time) {
    const nextCandle = normalizeCandle({
      close,
      high: Math.max(lastCandle.close, close),
      low: Math.min(lastCandle.close, close),
      open: lastCandle.close,
      time: currentCandleTime,
      volume: 0,
    });

    return nextCandle ? [...normalizedCandles, nextCandle].slice(-Math.max(normalizedCandles.length, 120)) : normalizedCandles;
  }

  if (Math.abs(lastCandle.close - close) < 0.000001) {
    return normalizedCandles;
  }

  return normalizedCandles.map((candle, index) => {
    if (index !== lastIndex) {
      return candle;
    }

    return normalizeCandle({
      ...candle,
      close,
      high: Math.max(candle.high, close),
      low: Math.min(candle.low, close),
    }) ?? candle;
  });
}

function timeframeBucketStart(timestampSeconds: number, timeframe: Timeframe) {
  const date = new Date(timestampSeconds * 1000);

  if (timeframe === '1M') {
    return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000);
  }

  if (timeframe === '1y') {
    return Math.floor(Date.UTC(date.getUTCFullYear(), 0, 1) / 1000);
  }

  if (timeframe === '1w') {
    const weekSeconds = 7 * 24 * 60 * 60;
    const mondayOffsetSeconds = 3 * 24 * 60 * 60;

    return Math.floor((timestampSeconds + mondayOffsetSeconds) / weekSeconds) * weekSeconds - mondayOffsetSeconds;
  }

  const intervalSeconds = timeframeSeconds[timeframe] ?? 15 * 60;

  return Math.floor(timestampSeconds / intervalSeconds) * intervalSeconds;
}

const timeframeSeconds: Partial<Record<Timeframe, number>> = {
  '1d': 24 * 60 * 60,
  '1h': 60 * 60,
  '1m': 60,
  '2h': 2 * 60 * 60,
  '30m': 30 * 60,
  '4h': 4 * 60 * 60,
  '5m': 5 * 60,
  '15m': 15 * 60,
};

function liveFallbackCandle(seedCandle: Candle | undefined, lastPrice: number): Candle {
  const close = roundPrice(lastPrice);
  const normalizedSeedCandle = normalizeCandle(seedCandle);

  if (!normalizedSeedCandle) {
    return { close, high: close, low: close, open: close, time: timeframeBucketStart(Math.floor(Date.now() / 1000), '15m'), volume: 0 };
  }

  return {
    ...normalizedSeedCandle,
    close,
    high: Math.max(normalizedSeedCandle.high, close),
    low: Math.min(normalizedSeedCandle.low, close),
  };
}

function buildMarkerSyncRows(markers: TradeMarker[], draft: PositionDraft) {
  const markerByType = new Map(markers.map((marker) => [marker.type, marker]));
  const entryMarker = markerByType.get('entry') ?? markerByType.get('buyLimit') ?? markerByType.get('sellLimit');
  const rows = [
    { label: 'Entry', marker: entryMarker, value: draft.entry },
    { label: 'SL', marker: markerByType.get('stopLoss'), value: draft.stopLoss },
    { label: 'TP', marker: markerByType.get('takeProfit') ?? markerByType.get('exit'), value: draft.takeProfit },
    { label: 'TP2', marker: markerByType.get('tp2'), value: markerByType.get('tp2')?.price },
  ];

  return rows.map((row) => ({
    label: row.label,
    placed: Boolean(row.marker),
    value: row.marker ? formatUsd(row.marker.price) : typeof row.value === 'number' ? formatUsd(row.value) : '--',
  }));
}

function analysisSummaryItems({ drawings, markers, notes, orders }: { drawings: ChartDrawing[]; markers: TradeMarker[]; notes: string; orders: Order[] }) {
  return [
    { label: 'Tools', value: String(drawings.length) },
    { label: 'Markers', value: String(markers.length) },
    { label: 'Orders', value: String(orders.length) },
    { label: 'Notes', value: notes.trim() ? 'Yes' : 'No' },
  ];
}

function setupSummary(setup: SavedChartSetup) {
  const drawings = setup.drawings?.length ?? 0;
  const markers = setup.markers.length;
  const orders = setup.plannedOrders.length;

  return `${setup.pair} · ${setup.timeframe} · ${drawings} tools · ${markers} markers · ${orders} orders`;
}

function formatSetupTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function chartWorkspaceKey(pair: string, timeframe: Timeframe) {
  return `${pair}:${timeframe}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recalculateDraftSize(draft: PositionDraft): PositionDraft {
  const accountSize = 10000;
  const riskAmount = accountSize * (draft.riskPercent / 100);
  const stopDistance = Math.max(Math.abs(draft.entry - draft.stopLoss), 1);

  return {
    ...draft,
    size: Number((riskAmount / stopDistance).toFixed(4)),
  };
}

function calculateRiskReward(draft: PositionDraft) {
  const risk = Math.abs(draft.entry - draft.stopLoss);
  const reward = Math.abs(draft.takeProfit - draft.entry);

  return risk > 0 ? reward / risk : 0;
}

function markersFromDraft(draft: PositionDraft, symbol: string): TradeMarker[] {
  return [createMarker('entry', draft.entry, symbol), createMarker('stopLoss', draft.stopLoss, symbol), createMarker('takeProfit', draft.takeProfit, symbol)];
}

function createPlannedOrder({
  draft,
  exchange,
  executionSource,
  id,
  kind,
  strategy,
  symbol,
}: {
  draft: PositionDraft;
  exchange: string;
  executionSource: TradeExecutionIntent;
  id: string;
  kind: 'entry' | 'stopLoss' | 'takeProfit';
  strategy?: Strategy;
  symbol: string;
}): Order {
  const closeSide = draft.direction === 'long' ? 'sell' : 'buy';
  const sourceMetadata = strategy
    ? {
        executionSource,
        strategyId: strategy.id,
        strategyName: strategy.name,
      }
    : { executionSource };

  if (kind === 'takeProfit') {
    return {
      createdAt: new Date().toISOString(),
      exchange,
      ...sourceMetadata,
      id,
      price: roundPrice(draft.takeProfit),
      reduceOnly: true,
      side: closeSide,
      size: draft.size,
      status: 'planned',
      symbol,
      type: 'take-profit',
    };
  }

  if (kind === 'stopLoss') {
    return {
      createdAt: new Date().toISOString(),
      exchange,
      ...sourceMetadata,
      id,
      price: roundPrice(draft.stopLoss),
      reduceOnly: true,
      side: closeSide,
      size: draft.size,
      status: 'planned',
      symbol,
      type: 'stop',
    };
  }

  return {
    createdAt: new Date().toISOString(),
    exchange,
    ...sourceMetadata,
    id,
    price: roundPrice(draft.entry),
    reduceOnly: false,
    side: draft.direction === 'long' ? 'buy' : 'sell',
    size: draft.size,
    status: 'planned',
    symbol,
    type: 'limit',
  };
}

function syncPlannedOrdersWithDraft(orders: Order[], draft: PositionDraft): Order[] {
  return orders.map((order) => {
    if (order.id.endsWith('plan-entry')) {
      return {
        ...order,
        price: roundPrice(draft.entry),
        side: draft.direction === 'long' ? 'buy' : 'sell',
        size: draft.size,
      };
    }

    if (order.id.endsWith('plan-tp')) {
      return {
        ...order,
        price: roundPrice(draft.takeProfit),
        side: draft.direction === 'long' ? 'sell' : 'buy',
        size: draft.size,
      };
    }

    if (order.id.endsWith('plan-sl')) {
      return {
        ...order,
        price: roundPrice(draft.stopLoss),
        side: draft.direction === 'long' ? 'sell' : 'buy',
        size: draft.size,
      };
    }

    return order;
  });
}

function removePlannedOrdersForMarkerType(orders: Order[], type: TradeMarkerType): Order[] {
  const linkedSuffixes: Partial<Record<TradeMarkerType, string[]>> = {
    buyLimit: ['plan-entry'],
    entry: ['plan-entry'],
    exit: ['plan-tp'],
    sellLimit: ['plan-entry'],
    stopLoss: ['plan-sl'],
    takeProfit: ['plan-tp'],
  };
  const suffixes = linkedSuffixes[type] ?? [];

  if (suffixes.length === 0) {
    return orders;
  }

  return orders.filter((order) => !suffixes.some((suffix) => order.id.endsWith(suffix)));
}

function sumClosedPnl(trades: JournalTrade[], days: number) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  return trades.filter((trade) => new Date(trade.closedAt).getTime() >= cutoff).reduce((sum, trade) => sum + trade.pnl, 0);
}

function countOrdersInDays(orders: Order[], days: number) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  return orders.filter((order) => new Date(order.createdAt).getTime() >= cutoff).length;
}

function buildIndicatorReadouts(candles: Candle[], config: ChartIndicatorConfig) {
  const normalizedConfig = normalizeChartIndicatorConfig(config);
  const readouts: Array<{ label: string; tone?: 'positive' | 'warning'; value: string }> = [];

  if (normalizedConfig.maFast.enabled) {
    readouts.push({ label: `MA ${normalizedConfig.maFast.period}`, value: formatUsd(latestValue(movingAverageSeries(candles, normalizedConfig.maFast.period))) });
  }

  if (normalizedConfig.maSlow.enabled) {
    readouts.push({ label: `MA ${normalizedConfig.maSlow.period}`, tone: 'warning', value: formatUsd(latestValue(movingAverageSeries(candles, normalizedConfig.maSlow.period))) });
  }

  if (normalizedConfig.ema.enabled) {
    readouts.push({ label: `EMA ${normalizedConfig.ema.period}`, value: formatUsd(latestValue(exponentialAverageSeries(candles, normalizedConfig.ema.period))) });
  }

  if (normalizedConfig.wma.enabled) {
    readouts.push({ label: `WMA ${normalizedConfig.wma.period}`, value: formatUsd(latestValue(weightedMovingAverageSeries(candles, normalizedConfig.wma.period))) });
  }

  if (normalizedConfig.hma.enabled) {
    readouts.push({ label: `HMA ${normalizedConfig.hma.period}`, value: formatUsd(latestValue(hullMovingAverageSeries(candles, normalizedConfig.hma.period))) });
  }

  if (normalizedConfig.vwma.enabled) {
    readouts.push({ label: `VWMA ${normalizedConfig.vwma.period}`, value: formatUsd(latestValue(volumeWeightedMovingAverageSeries(candles, normalizedConfig.vwma.period))) });
  }

  if (normalizedConfig.vwap.enabled) {
    readouts.push({ label: 'VWAP', tone: 'positive', value: formatUsd(latestValue(vwapSeries(candles))) });
  }

  if (normalizedConfig.bollinger.enabled) {
    const latest = bollingerBands(candles, normalizedConfig.bollinger.period, normalizedConfig.bollinger.stdDev).at(-1);
    readouts.push({ label: 'BB', value: latest ? `${formatUsd(latest.lower)} / ${formatUsd(latest.upper)}` : '--' });
  }

  if (normalizedConfig.donchian.enabled) {
    const latest = donchianChannel(candles, normalizedConfig.donchian.period).at(-1);
    readouts.push({ label: 'DON', tone: 'warning', value: latest ? `${formatUsd(latest.lower)} / ${formatUsd(latest.upper)}` : '--' });
  }

  if (normalizedConfig.keltner.enabled) {
    const latest = keltnerChannel(candles, normalizedConfig.keltner.period, normalizedConfig.keltner.multiplier).at(-1);
    readouts.push({ label: 'KELT', value: latest ? `${formatUsd(latest.lower)} / ${formatUsd(latest.upper)}` : '--' });
  }

  if (normalizedConfig.supertrend.enabled) {
    readouts.push({ label: 'ST', tone: 'positive', value: formatUsd(latestValue(supertrendSeries(candles, normalizedConfig.supertrend.period, normalizedConfig.supertrend.multiplier))) });
  }

  if (normalizedConfig.rsi.enabled) {
    readouts.push({ label: `RSI ${normalizedConfig.rsi.period}`, value: formatIndicatorValue(latestValue(rsiSeries(candles, normalizedConfig.rsi.period))) });
  }

  if (normalizedConfig.macd.enabled) {
    const macd = macdSeries(candles, normalizedConfig.macd.fastPeriod, normalizedConfig.macd.slowPeriod, normalizedConfig.macd.signalPeriod);
    readouts.push({ label: 'MACD', value: formatIndicatorValue(latestValue(macd.histogram)) });
  }

  if (normalizedConfig.stochastic.enabled) {
    readouts.push({ label: 'STOCH', value: formatIndicatorValue(latestValue(stochasticSeries(candles, normalizedConfig.stochastic.kPeriod, normalizedConfig.stochastic.dPeriod).k)) });
  }

  if (normalizedConfig.stochRsi.enabled) {
    readouts.push({ label: 'StochRSI', value: formatIndicatorValue(latestValue(stochRsiSeries(candles, normalizedConfig.stochRsi.rsiPeriod, normalizedConfig.stochRsi.stochPeriod, normalizedConfig.stochRsi.dPeriod).k)) });
  }

  if (normalizedConfig.cci.enabled) {
    readouts.push({ label: 'CCI', value: formatIndicatorValue(latestValue(cciSeries(candles, normalizedConfig.cci.period))) });
  }

  if (normalizedConfig.williamsR.enabled) {
    readouts.push({ label: 'W%R', value: formatIndicatorValue(latestValue(williamsRSeries(candles, normalizedConfig.williamsR.period))) });
  }

  if (normalizedConfig.roc.enabled) {
    readouts.push({ label: 'ROC', value: `${formatIndicatorValue(latestValue(rocSeries(candles, normalizedConfig.roc.period)))}%` });
  }

  if (normalizedConfig.momentum.enabled) {
    readouts.push({ label: 'MOM', value: formatIndicatorValue(latestValue(momentumSeries(candles, normalizedConfig.momentum.period))) });
  }

  if (normalizedConfig.trix.enabled) {
    readouts.push({ label: 'TRIX', value: `${formatIndicatorValue(latestValue(trixSeries(candles, normalizedConfig.trix.period)))}%` });
  }

  if (normalizedConfig.atr.enabled) {
    readouts.push({ label: 'ATR', tone: 'warning', value: formatIndicatorValue(latestValue(atrSeries(candles, normalizedConfig.atr.period))) });
  }

  if (normalizedConfig.obv.enabled) {
    readouts.push({ label: 'OBV', value: formatCompact(latestValue(obvSeries(candles))) });
  }

  if (normalizedConfig.mfi.enabled) {
    readouts.push({ label: 'MFI', value: formatIndicatorValue(latestValue(mfiSeries(candles, normalizedConfig.mfi.period))) });
  }

  if (normalizedConfig.cmf.enabled) {
    readouts.push({ label: 'CMF', value: formatIndicatorValue(latestValue(cmfSeries(candles, normalizedConfig.cmf.period))) });
  }

  if (normalizedConfig.adx.enabled) {
    readouts.push({ label: 'ADX', value: formatIndicatorValue(latestValue(adxSeries(candles, normalizedConfig.adx.period))) });
  }

  if (normalizedConfig.aroon.enabled) {
    const latest = aroonSeries(candles, normalizedConfig.aroon.period).at(-1);
    readouts.push({ label: 'AROON', value: latest ? `${formatIndicatorValue(latest.up)} / ${formatIndicatorValue(latest.down)}` : '--' });
  }

  return readouts;
}

function formatIndicatorValue(value: number) {
  return Math.abs(value) >= 1000 ? formatCompact(value) : value.toFixed(2);
}

function getMarketStripPairs(pairs: MarketPair[], selectedSymbol: string) {
  const featuredPairs = pairs.slice(0, 4);
  const selectedPair = pairs.find((pair) => pair.symbol === selectedSymbol);

  if (!selectedPair || featuredPairs.some((pair) => pair.symbol === selectedPair.symbol)) {
    return featuredPairs;
  }

  return [selectedPair, ...featuredPairs.filter((pair) => pair.symbol !== selectedPair.symbol).slice(0, 3)];
}

function buildPairThemeGroups(pairs: MarketPair[], selectedTheme: MarketCategory) {
  const groups = pairThemes
    .filter((theme) => theme.key !== 'all' && (selectedTheme === 'all' || selectedTheme === theme.key))
    .map((theme) => ({
      ...theme,
      pairs: sortThemePairs(pairs.filter((pair) => pair.category === theme.key)),
    }))
    .filter((theme) => theme.pairs.length > 0);

  if (groups.length > 0 || selectedTheme === 'all') {
    return groups;
  }

  return buildPairThemeGroups(pairs, 'all');
}

function bestStrategyForSymbol(strategies: Strategy[], symbol: string) {
  return strategies.find((strategy) => strategy.status === 'active' && strategy.market === symbol) ?? strategies.find((strategy) => strategy.market === symbol) ?? strategies.find((strategy) => strategy.status === 'active') ?? strategies[0];
}

function sortThemePairs(pairs: MarketPair[]) {
  return [...pairs].sort((first, second) => {
    if (second.volume24h !== first.volume24h) {
      return second.volume24h - first.volume24h;
    }

    return Math.abs(second.change24h) - Math.abs(first.change24h);
  });
}

function countPairsByTheme(pairs: MarketPair[], theme: MarketCategory) {
  return theme === 'all' ? pairs.length : pairs.filter((pair) => pair.category === theme).length;
}

function formatPairOption(pair: MarketPair) {
  return `${pair.symbol} · ${pair.name}`;
}

function formatOrderType(orderType: UserPreferences['orderType']) {
  switch (orderType) {
    case 'limit':
      return 'Limit';
    case 'market':
      return 'Market';
    case 'stop':
      return 'Stop';
  }
}

function formatOrderKind(orderType: Order['type']) {
  switch (orderType) {
    case 'limit':
      return 'Limit';
    case 'market':
      return 'Market';
    case 'stop':
      return 'Stop Loss';
    case 'take-profit':
      return 'Take Profit';
  }
}

function suggestedMarkerPrice(type: TradeMarkerType, draft: PositionDraft) {
  switch (type) {
    case 'entry':
    case 'buyLimit':
    case 'sellLimit':
      return draft.entry;
    case 'exit':
    case 'takeProfit':
      return draft.takeProfit;
    case 'tp2':
      return draft.takeProfit + Math.abs(draft.takeProfit - draft.entry) * 0.5;
    case 'stopLoss':
      return draft.stopLoss;
    case 'alert':
      return draft.entry + Math.abs(draft.takeProfit - draft.entry) * 0.25;
  }
}

function roundPrice(price: number) {
  return Number(price.toFixed(2));
}

function resolveInitialSymbol(marketPairs: MarketPair[], initialPair?: string) {
  const decodedPair = initialPair ? decodeURIComponent(initialPair) : undefined;

  if (decodedPair && marketPairs.some((pair) => pair.symbol === decodedPair)) {
    return decodedPair;
  }

  return marketPairs[0]?.symbol ?? 'BTC/USDT';
}

function timeframeLabel(timeframe: Timeframe) {
  return timeframe === '1y' ? '1Y' : timeframe;
}

function resolveChartMarketType(exchangeId: string | undefined, preferredMarketType: UserPreferences['preferredMarketType']): ChartMarketType {
  if (exchangeId && preferredMarketType !== 'spot') {
    return 'perpetual';
  }

  return 'spot';
}

function exchangeMarketStatusLabel(exchange: ExchangeConnection | undefined, isMarketDataLive: boolean, hasBinancePrices: boolean, candleStatus: 'loading' | 'live' | 'fallback') {
  if (!exchange) {
    return 'Marché · exchange indisponible';
  }

  if (exchange.id === 'binance') {
    return isMarketDataLive ? 'Marché · Binance live' : hasBinancePrices ? 'Marché · Binance REST' : 'Marché · bougies indisponibles';
  }

  if (candleStatus === 'live' && hasPublicRestMarketData(exchange.id)) {
    return `Marché · ${exchange.name} REST live`;
  }

  return `Marché · ${exchange.name} ${exchange.status === 'connected' ? 'connecté' : 'à connecter'}`;
}

function exchangeCapabilityLabel(exchange: ExchangeConnection | undefined, isBinanceLive: boolean, candleStatus: 'loading' | 'live' | 'fallback', marketType: ChartMarketType) {
  if (!exchange) {
    return 'API indisponible';
  }

  if (exchange.id === 'binance' && marketType === 'perpetual') {
    return isBinanceLive ? (candleStatus === 'live' ? 'Futures WS + REST' : 'Futures WebSocket') : candleStatus === 'live' ? 'Futures REST' : 'Futures REST indisponible';
  }

  if (marketType === 'perpetual' && hasPublicRestMarketData(exchange.id)) {
    return candleStatus === 'live' ? 'Perp REST' : 'Perp REST indisponible';
  }

  if (exchange.id === 'binance' && isBinanceLive) {
    return 'Spot REST + WebSocket';
  }

  if (hasPublicRestMarketData(exchange.id)) {
    if (exchange.permissions.includes('read')) {
      return candleStatus === 'live' ? 'REST public + read API' : 'API read only';
    }

    return candleStatus === 'live' ? 'REST public' : 'REST public indisponible';
  }

  if (exchange.permissions.includes('trade')) {
    return 'API read + trade';
  }

  if (exchange.permissions.includes('read')) {
    return candleStatus === 'live' ? 'REST public + read API' : 'API read only';
  }

  return 'API à connecter';
}

function hasPublicRestMarketData(exchangeId: string | undefined) {
  return Boolean(exchangeId && publicRestExchangeIds.has(exchangeId));
}

function clientSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';
}

type ToolProps = {
  icon: ReactNode;
  isActive?: boolean;
  label: string;
  onClick: () => void;
};

function Tool({ icon, isActive = false, label, onClick }: ToolProps) {
  return (
    <button aria-pressed={isActive} className={`chart-tool${isActive ? ' is-active' : ''}`} onClick={onClick} title={label} type="button">
      {icon}
      <span>{label}</span>
    </button>
  );
}

type LiveOrderModalProps = {
  account: string;
  draft: PositionDraft;
  estimatedFees: number;
  exchange?: ExchangeConnection;
  executionIntent: TradeExecutionIntent;
  isBlocked: boolean;
  leverage: number;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  orderType: UserPreferences['orderType'];
  pair: string;
  potentialLoss: number;
  potentialProfit: number;
  riskChecks: RiskEngineCheck[];
  strategyName?: string;
};

function LiveOrderModal({
  account,
  draft,
  estimatedFees,
  exchange,
  executionIntent,
  isBlocked,
  leverage,
  onCancel,
  onConfirm,
  open,
  orderType,
  pair,
  potentialLoss,
  potentialProfit,
  riskChecks,
  strategyName,
}: LiveOrderModalProps) {
  const blockedCheck = riskChecks.find((check) => check.status === 'blocked');
  const blockedError = blockedCheck?.errorCode ? getTradingErrorDefinition(blockedCheck.errorCode) : getTradingErrorDefinition('order-rejected');
  const secondaryActionLabel = blockedError.secondaryActionLabel === 'Cancel' ? undefined : blockedError.secondaryActionLabel;

  return (
    <Modal onClose={onCancel} open={open} title="Confirm Live Order">
      <div className="live-order-modal">
        {isBlocked ? (
          <ErrorState
            actionHref={blockedError.href}
            actionLabel={blockedError.primaryActionLabel}
            cancelLabel="Cancel"
            description={blockedError.reason}
            details={[
              { label: 'Check', tone: 'negative', value: blockedCheck?.label ?? 'Risk Engine' },
              { label: 'Current', tone: 'warning', value: blockedCheck?.detail ?? 'Blocked' },
              { label: 'Fix', value: blockedError.correctiveAction },
            ]}
            onCancel={onCancel}
            secondaryActionLabel={secondaryActionLabel}
            title={blockedError.title}
          />
        ) : null}

        <div className="live-order-grid">
          <LiveOrderItem label="Pair" value={pair} />
          <LiveOrderItem label="Source" value={executionIntent === 'strategy' ? strategyName ?? 'Strategy' : 'Manual'} />
          <LiveOrderItem label="Side" value={draft.direction === 'long' ? 'Long / Buy' : 'Short / Sell'} />
          <LiveOrderItem label="Order type" value={formatOrderType(orderType)} />
          <LiveOrderItem label="Entry" value={formatUsd(draft.entry)} />
          <LiveOrderItem label="Size" value={draft.size.toFixed(4)} />
          <LiveOrderItem label="Stop Loss" tone="negative" value={formatUsd(draft.stopLoss)} />
          <LiveOrderItem label="Take Profit" tone="positive" value={formatUsd(draft.takeProfit)} />
          <LiveOrderItem label="Risk %" value={`${draft.riskPercent}%`} />
          <LiveOrderItem label="Potential Loss" tone="negative" value={formatUsd(potentialLoss)} />
          <LiveOrderItem label="Potential Profit" tone="positive" value={formatUsd(potentialProfit)} />
          <LiveOrderItem label="Leverage" value={`${leverage}x`} />
          <LiveOrderItem label="Estimated Fees" value={formatUsd(estimatedFees)} />
          <LiveOrderItem label="Exchange" value={exchange?.name ?? 'Disconnected'} />
          <LiveOrderItem label="Account" value={account} />
        </div>

        <div className="risk-engine-checks">
          <div className="risk-engine-checks__head">
            <ShieldCheck size={16} />
            <strong>Risk Engine</strong>
          </div>
          {riskChecks.map((check) => (
            <div className={`risk-check-row is-${check.status}`} key={check.label}>
              {check.status === 'passed' ? <ShieldCheck size={15} /> : <AlertTriangle size={15} />}
              <span>{check.label}</span>
              <strong>{check.detail}</strong>
            </div>
          ))}
        </div>

        <div className="live-order-actions">
          <Button onClick={onCancel} size="sm" variant="ghost">
            Cancel
          </Button>
          <Button disabled={isBlocked} onClick={onConfirm} size="sm" variant="danger">
            Confirm Live Order
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function LiveOrderItem({ label, tone = 'neutral', value }: { label: string; tone?: 'neutral' | 'positive' | 'negative'; value: string }) {
  return (
    <div className="live-order-item">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

type MetricProps = {
  info?: string;
  label: string;
  tone?: 'neutral' | 'positive' | 'negative';
  value: string;
};

type BuilderFieldProps = {
  info?: string;
  label: string;
  onChange?: (value: number) => void;
  readOnly?: boolean;
  suffix?: string;
  tone?: 'neutral' | 'positive' | 'negative';
  value: number | string;
};

function BuilderField({ info, label, onChange, readOnly = false, suffix, tone = 'neutral', value }: BuilderFieldProps) {
  return (
    <label className={`builder-field is-${tone}`}>
      <span>
        {label}
        {info ? <InfoButton content={info} label={`${label} info`} /> : null}
      </span>
      <div className="builder-field__control">
        {readOnly ? (
          <strong>{value}</strong>
        ) : (
          <input
            aria-label={label}
            inputMode="decimal"
            min={suffix === 'x' ? 1 : undefined}
            onChange={(event) => {
              const nextValue = Number(event.target.value);

              if (Number.isFinite(nextValue)) {
                onChange?.(nextValue);
              }
            }}
            step={suffix === 'x' ? 1 : 0.01}
            type="number"
            value={typeof value === 'number' ? value : ''}
          />
        )}
        {suffix ? <small>{suffix}</small> : null}
      </div>
    </label>
  );
}

function Metric({ info, label, tone = 'neutral', value }: MetricProps) {
  return (
    <div className="metric-row">
      <span className="metric-row__label">
        {label}
        {info ? <InfoButton content={info} label={`${label} info`} /> : null}
      </span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}
