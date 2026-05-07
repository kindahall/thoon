import { resolve } from 'node:path';

export type ThoonServerEnv = {
  agentAiApiKey?: string;
  agentAiBaseUrl: string;
  agentAiEndpoint: 'chat-completions' | 'responses';
  agentAiModel: string;
  agentAiProvider: 'codex' | 'local' | 'openai' | 'openai-compatible';
  agentAiTimeoutMs: number;
  appMode: 'live-disabled' | 'live-enabled' | 'paper';
  authMode: 'local-disabled' | 'local-required';
  authSessionDays: number;
  authSessionSecret: string;
  databaseUrl?: string;
  binanceMarketBaseUrl: string;
  binanceTradeBaseUrl: string;
  bitgetMarketBaseUrl: string;
  bybitMarketBaseUrl: string;
  coinbaseAdvancedMarketBaseUrl: string;
  dataFile: string;
  databaseProvider: 'json' | 'postgres';
  encryptionKey: string;
  krakenMarketBaseUrl: string;
  kucoinMarketBaseUrl: string;
  liveExchangeProvider: 'disabled' | 'binance';
  liveOrderEndpoint: 'test' | 'live';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  marketDataProvider: 'binance' | 'local';
  marketKlineLimit: number;
  marketRefreshSeconds: number;
  nodeEnv: string;
  okxMarketBaseUrl: string;
  productionBaseUrl?: string;
  release: string;
  thoonAdminEmail: string;
  thoonAdminPasswordHash?: string;
};

export const defaultThoonEncryptionKey = 'dev-local-change-me-before-real-exchange-keys';

export function getThoonServerEnv(): ThoonServerEnv {
  return {
    agentAiApiKey: process.env.THOON_AGENT_AI_API_KEY ?? process.env.OPENAI_API_KEY,
    agentAiBaseUrl: process.env.THOON_AGENT_AI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    agentAiEndpoint: process.env.THOON_AGENT_AI_ENDPOINT === 'chat-completions' ? 'chat-completions' : 'responses',
    agentAiModel: process.env.THOON_AGENT_AI_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5.5',
    agentAiProvider: normalizeAgentAiProvider(process.env.THOON_AGENT_AI_PROVIDER),
    agentAiTimeoutMs: positiveNumber(process.env.THOON_AGENT_AI_TIMEOUT_MS, 12000),
    appMode: normalizeAppMode(process.env.THOON_APP_MODE),
    authMode: process.env.THOON_AUTH_MODE === 'local-required' ? 'local-required' : 'local-disabled',
    authSessionDays: positiveNumber(process.env.THOON_AUTH_SESSION_DAYS, 7),
    authSessionSecret: process.env.THOON_AUTH_SESSION_SECRET ?? 'dev-local-session-secret-change-before-prod',
    binanceMarketBaseUrl: process.env.BINANCE_MARKET_BASE_URL ?? 'https://data-api.binance.vision',
    binanceTradeBaseUrl: process.env.BINANCE_TRADE_BASE_URL ?? 'https://api.binance.com',
    bitgetMarketBaseUrl: process.env.BITGET_MARKET_BASE_URL ?? 'https://api.bitget.com',
    bybitMarketBaseUrl: process.env.BYBIT_MARKET_BASE_URL ?? 'https://api.bybit.com',
    coinbaseAdvancedMarketBaseUrl: process.env.COINBASE_ADVANCED_MARKET_BASE_URL ?? 'https://api.exchange.coinbase.com',
    databaseProvider: process.env.THOON_DATABASE_PROVIDER === 'postgres' ? 'postgres' : 'json',
    databaseUrl: process.env.DATABASE_URL,
    dataFile: resolve(/* turbopackIgnore: true */ process.cwd(), process.env.THOON_DATA_FILE ?? '.thoon-data/thoon-db.json'),
    encryptionKey: process.env.THOON_ENCRYPTION_KEY ?? defaultThoonEncryptionKey,
    krakenMarketBaseUrl: process.env.KRAKEN_MARKET_BASE_URL ?? 'https://api.kraken.com',
    kucoinMarketBaseUrl: process.env.KUCOIN_MARKET_BASE_URL ?? 'https://api.kucoin.com',
    liveExchangeProvider: process.env.THOON_LIVE_EXCHANGE_PROVIDER === 'binance' ? 'binance' : 'disabled',
    liveOrderEndpoint: process.env.THOON_LIVE_ORDER_ENDPOINT === 'live' ? 'live' : 'test',
    logLevel: normalizeLogLevel(process.env.THOON_LOG_LEVEL),
    marketDataProvider: process.env.THOON_MARKET_DATA_PROVIDER === 'local' ? 'local' : 'binance',
    marketKlineLimit: positiveNumber(process.env.THOON_MARKET_KLINE_LIMIT, 120),
    marketRefreshSeconds: positiveNumber(process.env.THOON_MARKET_REFRESH_SECONDS, 30),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    okxMarketBaseUrl: process.env.OKX_MARKET_BASE_URL ?? 'https://www.okx.com',
    productionBaseUrl: process.env.THOON_PRODUCTION_BASE_URL,
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.THOON_RELEASE ?? 'local',
    thoonAdminEmail: process.env.THOON_ADMIN_EMAIL ?? 'owner@thoon.local',
    thoonAdminPasswordHash: process.env.THOON_ADMIN_PASSWORD_HASH,
  };
}

export function hasProductionEncryptionKey(secret: string) {
  const trimmed = secret.trim();

  return trimmed.length >= 32 && trimmed !== defaultThoonEncryptionKey && trimmed !== 'replace-with-a-long-random-secret';
}

function normalizeAppMode(value: string | undefined): ThoonServerEnv['appMode'] {
  if (value === 'live-enabled' || value === 'live-disabled') {
    return value;
  }

  return 'paper';
}

function normalizeLogLevel(value: string | undefined): ThoonServerEnv['logLevel'] {
  if (value === 'debug' || value === 'warn' || value === 'error') {
    return value;
  }

  return 'info';
}

function normalizeAgentAiProvider(value: string | undefined): ThoonServerEnv['agentAiProvider'] {
  if (value === 'codex' || value === 'local' || value === 'openai' || value === 'openai-compatible') {
    return value;
  }

  return 'codex';
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
