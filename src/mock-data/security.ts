import type { ApiKeyRecord, AuditEvent, ExchangeConnection, RiskRules, TradeLimits, UserPreferences, UserProfile } from '../types/trading';

export const exchanges: ExchangeConnection[] = [
  { id: 'binance', name: 'Binance', permissions: [], status: 'available', withdrawalsEnabled: false },
  { id: 'bybit', name: 'Bybit', permissions: [], status: 'available', withdrawalsEnabled: false },
  { id: 'okx', name: 'OKX', permissions: [], status: 'available', withdrawalsEnabled: false },
  { id: 'bitget', name: 'Bitget', permissions: [], status: 'available', withdrawalsEnabled: false },
  { id: 'kraken', name: 'Kraken', permissions: [], status: 'available', withdrawalsEnabled: false },
  { id: 'kucoin', name: 'KuCoin', permissions: [], status: 'available', withdrawalsEnabled: false },
  { id: 'coinbase-advanced', name: 'Coinbase Advanced', permissions: [], status: 'available', withdrawalsEnabled: false },
];

export const apiKeys: ApiKeyRecord[] = [];

export const riskRules: RiskRules = {
  blockOrdersWithoutStop: true,
  botLossStreakPause: 3,
  cancelOnDisconnect: true,
  confirmLiveOrders: true,
  dailyLossLimit: 3,
  emergencyKillSwitch: false,
  maxLeverage: 5,
  maxRiskPerTrade: 1,
  minimumBalance: 1000,
  stopBotsAtDrawdown: 8,
  weeklyLossLimit: 7,
};

export const tradeLimits: TradeLimits = {
  cooldownAfterBotErrorMinutes: 20,
  cooldownAfterLossMinutes: 15,
  maxApiErrorsBeforePause: 3,
  maxBotSlotsActive: 4,
  maxOpenPositions: 3,
  maxOrdersPerDay: 18,
  maxOrdersPerHour: 6,
  maxPositionSizePerPair: 12500,
  maxStrategyExecutionsPerDay: 40,
  maxTotalExposure: 25000,
};

export const auditLogs: AuditEvent[] = [];

export const userProfile: UserProfile = {
  country: 'FR',
  email: 'artisaul@example.invalid',
  id: 'user-artisaul',
  language: 'fr',
  mainCurrency: 'USDT',
  name: 'Artisaul',
  timezone: 'Europe/Paris',
  tradingExperience: 'intermediate',
  username: 'artisaul',
};

export const userPreferences: UserPreferences = {
  accent: 'blue',
  breakEvenAutomation: true,
  breakEvenRule: 'move-to-be-at-1r',
  categoryFilters: ['all', 'trending', 'defi', 'layer-1'],
  defaultAccount: 'Main Account',
  defaultExchange: 'Paper',
  defaultLeverage: 3,
  defaultRiskPerTrade: 1,
  defaultSlippage: 0.5,
  density: 'compact',
  multiTpBehavior: 'partial-take-profits',
  orderType: 'limit',
  positionSizingMethod: 'risk-percent',
  preferredMarketType: 'perpetual',
  quickPreset: 'day-trading',
  stopLossMode: 'sl-market',
  takeProfitMode: 'tp-limit',
  theme: 'dark',
  trailingStopActivationAtr: 1,
  trailingStopEnabled: true,
  trailingStopTrailAtr: 1.5,
};
