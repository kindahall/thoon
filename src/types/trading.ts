import type { MarketCategory, PositionDraft, Timeframe } from './market';

export type MetricTone = 'neutral' | 'positive' | 'negative' | 'warning';

export type WorkspaceMetric = {
  label: string;
  tone?: MetricTone;
  value: string;
};

export type WorkspaceRow = {
  href?: string;
  primary: string;
  secondary: string;
  status: string;
  tone?: MetricTone;
};

export type WorkspaceSummaryKey =
  | 'markets'
  | 'watchlist'
  | 'backtest'
  | 'strategies'
  | 'bots'
  | 'orders'
  | 'alerts'
  | 'history'
  | 'preferences';

export type WorkspaceSummary = {
  actionHref?: string;
  actionLabel: string;
  eyebrow: string;
  metrics: WorkspaceMetric[];
  rows: WorkspaceRow[];
  title: string;
};

export type PreferenceSectionKey =
  | 'agent'
  | 'profile'
  | 'appearance'
  | 'trading-defaults'
  | 'security'
  | 'notifications'
  | 'exchange-api'
  | 'billing'
  | 'data-privacy'
  | 'risk-rules'
  | 'trade-limits'
  | 'audit-logs'
  | 'layouts'
  | 'keyboard-shortcuts'
  | 'advanced';

export type Watchlist = {
  alertCount: number;
  id: string;
  name: string;
  pairSymbols: string[];
  type: 'favorites' | 'custom' | 'strategy';
  updatedAt: string;
};

export type Position = {
  entryPrice: number;
  exchange: string;
  id: string;
  leverage: number;
  liquidationPrice: number;
  markPrice: number;
  margin: number;
  openedAt: string;
  pnl: number;
  pnlPercent: number;
  side: 'long' | 'short';
  size: number;
  stopLoss: number;
  symbol: string;
  takeProfit: number;
};

export type Order = {
  createdAt: string;
  exchange: string;
  id: string;
  price: number;
  reduceOnly: boolean;
  side: 'buy' | 'sell';
  size: number;
  status: 'open' | 'filled' | 'cancelled' | 'rejected' | 'planned';
  symbol: string;
  type: 'market' | 'limit' | 'stop' | 'take-profit';
};

export type Fill = {
  fee: number;
  id: string;
  orderId: string;
  price: number;
  side: 'buy' | 'sell';
  size: number;
  symbol: string;
  time: string;
};

export type Alert = {
  channel: 'app' | 'email' | 'webhook';
  condition: string;
  id: string;
  lastTriggeredAt?: string;
  status: 'active' | 'paused' | 'triggered';
  symbol: string;
  trigger: 'once' | 'repeat';
  triggeredAt?: string;
  type: 'price' | 'zone' | 'indicator' | 'strategy' | 'bot' | 'webhook';
  value: string;
};

export type Strategy = {
  agentSource?: {
    directionBias: 'both' | 'long' | 'short';
    language: 'manual' | 'pine-v5';
    originalTimeframe: Timeframe;
    parameters: Array<{ label: string; value: string }>;
    protectedCore: boolean;
    sourceCode?: string;
    sourceId: string;
    summary: string;
  };
  entryConditions?: StrategyCondition[];
  exitConditions?: StrategyCondition[];
  id: string;
  market: string;
  name: string;
  performance30d: number;
  positionDraft?: PositionDraft;
  riskPerTrade: number;
  riskSettings?: StrategyRiskSettings;
  setupSnapshot?: StrategySetupSnapshot;
  sourceSetupId?: string;
  status: 'active' | 'draft' | 'archived';
  timeframe: Timeframe;
  type: 'trend' | 'breakout' | 'mean-reversion' | 'grid';
  updatedAt: string;
};

export type StrategyAgentMode = 'manual' | 'assisted' | 'limited_autonomous' | 'guarded_autonomous';

export type AgentPermission =
  | 'analyze_strategy'
  | 'archive_variant'
  | 'close_positions'
  | 'create_draft_bot'
  | 'create_report'
  | 'create_variant'
  | 'delete_strategy'
  | 'edit_original_strategy'
  | 'edit_variant'
  | 'execute_live_trade'
  | 'launch_live_bot'
  | 'modify_api_keys'
  | 'modify_risk_rules'
  | 'modify_trade_limits'
  | 'prepare_bot'
  | 'promote_version'
  | 'read_audit_logs'
  | 'read_journal'
  | 'revoke_api_key'
  | 'run_backtest'
  | 'run_paper_test'
  | 'suggest_risk_change'
  | 'write_journal_note';

export type AgentAction =
  | 'analyze_strategy'
  | 'archive_variant'
  | 'compare_versions'
  | 'create_draft_bot'
  | 'create_report'
  | 'create_variant'
  | 'execute_live_trade'
  | 'launch_live_bot'
  | 'prepare_backtest'
  | 'prepare_bot'
  | 'promote_version'
  | 'read_backtest'
  | 'research_tradingview'
  | 'run_backtest'
  | 'run_paper_test'
  | 'send_to_paper'
  | 'write_journal_note';

export type AgentActionPolicy = 'ask_first' | 'auto_allowed' | 'always_confirm' | 'forbidden';

export type StrategyValidationStage =
  | 'archived'
  | 'backtested'
  | 'bot_draft'
  | 'candidate'
  | 'draft'
  | 'live_active'
  | 'live_ready'
  | 'out_of_sample_tested'
  | 'paper_tested'
  | 'rejected';

export type StrategyVersionStatus = 'archived' | 'candidate' | 'draft' | 'live-ready' | 'paper' | 'protected' | 'rejected' | 'testing';

export type StrategyChangeType = 'major' | 'minor';

export type MarketRegime = 'breakout' | 'high_volatility' | 'low_volatility' | 'range' | 'trend_down' | 'trend_up' | 'uncertain';

export type RobustnessLabel = 'acceptable' | 'candidate' | 'strong' | 'unstable' | 'weak';

export type StrategyVersion = {
  backtestSummary?: Pick<BacktestReport, 'drawdown' | 'netProfit' | 'period' | 'profitFactor' | 'totalTrades' | 'winRate'>;
  changeSummary: string;
  changeType: StrategyChangeType;
  createdAt: string;
  createdBy: 'agent' | 'user';
  id: string;
  marketRegimeTags: MarketRegime[];
  marketsTested: string[];
  overfittingWarnings: string[];
  paperSummary?: {
    drawdown: number;
    durationDays: number;
    pnl: number;
    respectsRules: boolean;
    trades: number;
    winRate: number;
  };
  parentVersionId?: string;
  protectedOriginal: boolean;
  riskProfile: {
    maxDrawdownAllowed: number;
    maxLeverage: number;
    riskPerTrade: number;
    stopLossRequired: boolean;
  };
  robustnessLabel: RobustnessLabel;
  robustnessScore: number;
  stage: StrategyValidationStage;
  status: StrategyVersionStatus;
  strategyId: string;
  timeframesTested: Timeframe[];
  version: string;
};

export type AgentSuggestion = {
  action: string;
  actionType: AgentAction;
  changeType?: StrategyChangeType;
  confidence: number;
  confirmationRequired: boolean;
  createdAt: string;
  details: string[];
  id: string;
  impact: string;
  reason: string;
  risk: 'high' | 'low' | 'medium';
  strategyId: string;
  title: string;
  type:
    | 'adjust_stop_loss'
    | 'adjust_take_profit'
    | 'archive_weak_variant'
    | 'create_variant'
    | 'do_nothing'
    | 'reduce_risk'
    | 'send_to_paper'
    | 'test_market'
    | 'test_timeframe'
    | 'volatility_filter';
  versionId?: string;
};

export type AgentDecision = {
  action: AgentAction;
  allowed: boolean;
  blockers: string[];
  permission?: AgentPermission;
  policy: AgentActionPolicy;
  requiredConfirmation: boolean;
  riskEngineResult: {
    allowed: boolean;
    checked: string[];
  };
  suggestedSafeAction?: string;
  warnings: string[];
};

export type AgentRun = {
  action: AgentAction;
  createdAt: string;
  decision: AgentDecision;
  id: string;
  mode: StrategyAgentMode;
  notes: string;
  permission?: AgentPermission;
  result: 'blocked' | 'completed' | 'failed' | 'queued' | 'waiting_for_confirmation';
  strategyId?: string;
  userConfirmed: boolean;
  versionId?: string;
};

export type AgentReport = {
  backtestSummary?: StrategyVersion['backtestSummary'];
  createdAt: string;
  details: string[];
  id: string;
  marketsTested: string[];
  nextAction: string;
  paperSummary?: StrategyVersion['paperSummary'];
  periodTested: string;
  recommendations: string[];
  risks: string[];
  status: 'archive' | 'bot_candidate' | 'monitor' | 'needs_test' | 'no_action' | 'paper_candidate' | 'reject';
  strategyId: string;
  summary: string[];
  timeframesTested: Timeframe[];
  versionId?: string;
  weaknesses: string[];
  strengths: string[];
};

export type StrategyResearchRecord = {
  author?: string;
  concepts: string[];
  fetchedAt: string;
  id: string;
  jimmyAdaptationNotes: string[];
  provider: 'tradingview';
  publicDescription: string;
  publishedAt?: string;
  query: string;
  scriptType: 'indicator' | 'strategy' | 'unknown';
  sourcePolicy: 'concept_only' | 'open_source_reference' | 'public_metadata';
  sourceVisibility: 'open_source' | 'protected_source' | 'public_description' | 'unknown';
  strategyId: string;
  tags: string[];
  title: string;
  url: string;
};

export type AgentQueueTask = {
  action: AgentAction;
  createdAt: string;
  id: string;
  nextAction: string;
  priority: 'high' | 'low' | 'normal';
  result?: string;
  status: 'blocked' | 'completed' | 'failed' | 'queued' | 'running' | 'waiting_for_confirmation';
  strategyId?: string;
  versionId?: string;
};

export type AgentSettings = {
  askBefore: Partial<Record<AgentAction, boolean>>;
  enabled: boolean;
  instructions: {
    allowedMarkets: string;
    allowedParameters: string;
    archiveRules: string;
    forbiddenParameters: string;
    general: string;
    mainStrategy: string;
    paperTestingRules: string;
    promotionRules: string;
    reportStyle: string;
    validationRules: string;
  };
  limits: {
    allowedMarkets: string[];
    allowedTimeframes: Timeframe[];
    maxBacktestsPerDay: number;
    maxDrawdownCandidate: number;
    maxVariantsPerDay: number;
    minPaperDays: number;
    minProfitFactor: number;
    minTrades: number;
    paperRequiredBeforeLive: boolean;
  };
  mode: StrategyAgentMode;
  neverWithoutConfirmation: Partial<Record<AgentAction, boolean>>;
  permissions: Record<AgentPermission, boolean>;
  policies: Partial<Record<AgentAction, AgentActionPolicy>>;
  queuePaused: boolean;
};

export type StrategyCondition = {
  connector: 'AND' | 'IF' | 'OR';
  field: string;
  id: string;
  operator: 'crosses-above' | 'crosses-below' | 'greater-than' | 'less-than';
  value: string;
};

export type StrategyRiskSettings = {
  accountBalance: number;
  maxOpenTrades: number;
  positionSizing: string;
  rrTarget: number;
  stopLoss: string;
  stopRequired: boolean;
  takeProfit: string;
  trailingStop: boolean;
};

export type StrategySetupSnapshot = {
  drawings?: unknown[];
  markers?: unknown[];
  notes?: string;
  savedSetupId?: string;
};

export type BacktestTrade = {
  entry: number;
  entryTime: string;
  exit: number;
  exitReason: 'ma-cross' | 'opposite-signal' | 'session-end' | 'stop-loss' | 'take-profit' | 'trailing-stop';
  exitTime: string;
  fee: number;
  id: string;
  pnl: number;
  rMultiple: number;
  side: 'long' | 'short';
  size: number;
  status: 'loss' | 'win';
};

export type BacktestReport = {
  buyHoldCurve?: number[];
  buyHoldReturn?: number;
  candleCount?: number;
  dataWindow?: {
    candleChecksum: string;
    firstCandleAt: string;
    lastCandleAt: string;
  };
  drawdown: number;
  drawdownCurve?: number[];
  engine?: 'jimmy-pine-v5-candle-engine';
  equityCurve?: number[];
  executionModel?: string;
  exchangeId?: string;
  exchangeName?: string;
  feesPct?: number;
  generatedAt?: string;
  id: string;
  initialCapital?: number;
  losingTrades?: number;
  market?: string;
  marketDataSource?: string;
  monthlyReturns?: Array<{ label: string; value: number }>;
  netProfit: number;
  openPosition?: {
    entry: number;
    entryTime: string;
    markPrice: number;
    side: 'long' | 'short';
    size: number;
    stop: number;
    trail: number;
    unrealizedPnl: number;
  };
  period: string;
  profitFactor: number;
  slippagePct?: number;
  source?: 'agent' | 'calculated' | 'seed';
  strategyId: string;
  timeframe?: Timeframe;
  totalTrades: number;
  trades?: BacktestTrade[];
  warnings?: string[];
  winRate: number;
  winningTrades?: number;
};

export type Bot = {
  allocatedCapital: number;
  exchange: string;
  id: string;
  maxDrawdown: number;
  mode: 'paper' | 'live';
  name: string;
  pnl: number;
  riskPerTrade: number;
  status: 'running' | 'paused' | 'stopped' | 'draft';
  strategyId: string;
  symbol: string;
  winRate: number;
};

export type BotLog = {
  botId: string;
  id: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  time: string;
};

export type JournalTrade = {
  closedAt: string;
  id: string;
  lessons: string;
  notes: string;
  pnl: number;
  rMultiple: number;
  side: 'long' | 'short';
  source: 'manual' | 'bot' | 'paper';
  symbol: string;
  tag: string;
};

export type ExchangeConnection = {
  id: string;
  name: string;
  permissions: Array<'read' | 'trade'>;
  status: 'connected' | 'disconnected' | 'available';
  withdrawalsEnabled: false;
};

export type ApiKeyRecord = {
  createdAt: string;
  exchangeId: string;
  id: string;
  ipWhitelist: string[];
  label: string;
  maskedKey: string;
  permissions: Array<'read' | 'trade'>;
  status: 'active' | 'disabled' | 'testing';
};

export type RiskRules = {
  blockOrdersWithoutStop: boolean;
  botLossStreakPause: number;
  cancelOnDisconnect: boolean;
  confirmLiveOrders: boolean;
  dailyLossLimit: number;
  emergencyKillSwitch: boolean;
  maxLeverage: number;
  maxRiskPerTrade: number;
  minimumBalance: number;
  stopBotsAtDrawdown: number;
  weeklyLossLimit: number;
};

export type TradeLimits = {
  cooldownAfterBotErrorMinutes: number;
  cooldownAfterLossMinutes: number;
  maxApiErrorsBeforePause: number;
  maxBotSlotsActive: number;
  maxOpenPositions: number;
  maxOrdersPerDay: number;
  maxOrdersPerHour: number;
  maxPositionSizePerPair: number;
  maxStrategyExecutionsPerDay: number;
  maxTotalExposure: number;
};

export type AuditEvent = {
  action: string;
  actor: 'user' | 'system' | 'bot';
  botId?: string;
  details: string;
  eventType: 'api' | 'order' | 'bot' | 'strategy' | 'risk' | 'system';
  exchange?: string;
  id: string;
  ipAddress: string;
  status: 'success' | 'blocked' | 'failed' | 'warning';
  symbol?: string;
  time: string;
};

export type UserProfile = {
  country: string;
  email: string;
  id: string;
  language: 'fr' | 'en';
  mainCurrency: 'USD' | 'EUR' | 'USDT';
  name: string;
  timezone: string;
  tradingExperience: 'beginner' | 'intermediate' | 'advanced';
  username: string;
};

export type UserPreferences = {
  accent: 'blue' | 'green' | 'violet';
  breakEvenAutomation: boolean;
  breakEvenRule: 'off' | 'move-to-be-at-1r' | 'move-to-be-at-tp1';
  categoryFilters: MarketCategory[];
  defaultAccount: string;
  defaultExchange: string;
  defaultLeverage: number;
  defaultRiskPerTrade: number;
  defaultSlippage: number;
  density: 'compact' | 'comfortable';
  multiTpBehavior: 'single-target' | 'partial-take-profits' | 'equal-ladder';
  orderType: 'market' | 'limit' | 'stop';
  positionSizingMethod: 'risk-percent' | 'fixed-usdt' | 'fixed-size';
  preferredMarketType: 'spot' | 'perpetual' | 'futures';
  quickPreset: 'scalping' | 'day-trading' | 'swing-trading' | 'position-trading' | 'custom';
  stopLossMode: 'sl-market' | 'sl-limit';
  takeProfitMode: 'tp-limit' | 'tp-market' | 'scale-out';
  theme: 'dark' | 'light' | 'system';
  trailingStopActivationAtr: number;
  trailingStopEnabled: boolean;
  trailingStopTrailAtr: number;
};
