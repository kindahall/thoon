import { resolve } from 'node:path';

export type ThoonServerEnv = {
  agentAiApiKey?: string;
  agentAiBaseUrl: string;
  agentAiCodexAuthFile?: string;
  agentAiEndpoint: 'chat-completions' | 'responses';
  agentAiChatModel: string;
  agentAiIncludeSource: boolean;
  agentAiModel: string;
  agentAiProvider: 'codex' | 'local' | 'openai' | 'openai-compatible';
  agentAiTimeoutMs: number;
  appMode: 'live-disabled' | 'live-enabled' | 'paper';
  auditMaxEvents: number;
  auditRetentionDays: number;
  authMode: 'local-disabled' | 'local-required';
  authCookieSecure: boolean;
  authSessionDays: number;
  authSessionSecret: string;
  databaseUrl?: string;
  betaInviteDays: number;
  binanceMarketBaseUrl: string;
  binanceFuturesMarketBaseUrl: string;
  binanceTradeBaseUrl: string;
  bitgetMarketBaseUrl: string;
  budBackendTimeoutMs: number;
  budBackendUrl: string;
  bybitMarketBaseUrl: string;
  coinbaseAdvancedMarketBaseUrl: string;
  cronSecret?: string;
  dataFile: string;
  databaseProvider: 'json' | 'postgres';
  encryptionKey: string;
  krakenMarketBaseUrl: string;
  kucoinMarketBaseUrl: string;
  liveExchangeProvider: 'disabled' | 'binance' | 'bitget' | 'bud' | 'bybit';
  liveOrderEndpoint: 'test' | 'live';
  liveOperatorMode: 'saas' | 'single-user';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  loginRateLimitMax: number;
  loginRateLimitWindowSeconds: number;
  marketDataProvider: 'binance' | 'bud' | 'local';
  marketKlineLimit: number;
  marketRefreshSeconds: number;
  mutationRateLimitMax: number;
  mutationRateLimitWindowSeconds: number;
  nodeEnv: string;
  okxMarketBaseUrl: string;
  productionBaseUrl?: string;
  rateLimitEnabled: boolean;
  edgeRateLimitPolicy: 'configured' | 'missing';
  trustProxyHeaders: boolean;
  release: string;
  saasMode: boolean;
  stripePriceEliteMonthly?: string;
  stripePriceEliteYearly?: string;
  stripePriceProMonthly?: string;
  stripePriceProYearly?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  thoonAdminEmail: string;
  thoonAdminPasswordHash?: string;
  tradingViewMcpArgs: string[];
  tradingViewMcpCommand: string;
  tradingViewMcpName: string;
};

export const defaultThoonEncryptionKey = 'dev-local-change-me-before-real-exchange-keys';

export function getThoonServerEnv(): ThoonServerEnv {
  return {
    agentAiApiKey: process.env.THOON_AGENT_AI_API_KEY ?? process.env.OPENAI_API_KEY,
    agentAiBaseUrl: process.env.THOON_AGENT_AI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    agentAiCodexAuthFile: process.env.THOON_AGENT_CODEX_AUTH_FILE?.trim() || undefined,
    agentAiEndpoint: process.env.THOON_AGENT_AI_ENDPOINT === 'chat-completions' ? 'chat-completions' : 'responses',
    agentAiChatModel: process.env.THOON_AGENT_CHAT_MODEL ?? process.env.THOON_AGENT_AI_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5.5',
    agentAiIncludeSource: process.env.THOON_AGENT_AI_INCLUDE_SOURCE === 'true',
    agentAiModel: process.env.THOON_AGENT_AI_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5.5',
    agentAiProvider: normalizeAgentAiProvider(process.env.THOON_AGENT_AI_PROVIDER),
    agentAiTimeoutMs: positiveNumber(process.env.THOON_AGENT_AI_TIMEOUT_MS, 240000),
    appMode: normalizeAppMode(process.env.THOON_APP_MODE),
    auditMaxEvents: positiveInteger(process.env.THOON_AUDIT_MAX_EVENTS, 1000),
    auditRetentionDays: positiveInteger(process.env.THOON_AUDIT_RETENTION_DAYS, 180),
    authMode: normalizeAuthMode(process.env.THOON_AUTH_MODE),
    authCookieSecure: normalizeAuthCookieSecure(process.env.THOON_COOKIE_SECURE),
    authSessionDays: positiveNumber(process.env.THOON_AUTH_SESSION_DAYS, 7),
    authSessionSecret: process.env.THOON_AUTH_SESSION_SECRET ?? 'dev-local-session-secret-change-before-prod',
    betaInviteDays: positiveInteger(process.env.THOON_BETA_INVITE_DAYS, 14),
    binanceFuturesMarketBaseUrl: process.env.BINANCE_FUTURES_MARKET_BASE_URL ?? 'https://fapi.binance.com',
    binanceMarketBaseUrl: process.env.BINANCE_MARKET_BASE_URL ?? 'https://data-api.binance.vision',
    binanceTradeBaseUrl: process.env.BINANCE_TRADE_BASE_URL ?? 'https://api.binance.com',
    bitgetMarketBaseUrl: process.env.BITGET_MARKET_BASE_URL ?? 'https://api.bitget.com',
    budBackendTimeoutMs: positiveNumber(process.env.THOON_BUD_BACKEND_TIMEOUT_MS, 20_000),
    budBackendUrl: process.env.THOON_BUD_BACKEND_URL ?? 'http://127.0.0.1:8000',
    bybitMarketBaseUrl: process.env.BYBIT_MARKET_BASE_URL ?? 'https://api.bybit.com',
    coinbaseAdvancedMarketBaseUrl: process.env.COINBASE_ADVANCED_MARKET_BASE_URL ?? 'https://api.exchange.coinbase.com',
    cronSecret: process.env.THOON_CRON_SECRET,
    databaseProvider: process.env.THOON_DATABASE_PROVIDER === 'postgres' ? 'postgres' : 'json',
    databaseUrl: process.env.DATABASE_URL,
    dataFile: resolve(/* turbopackIgnore: true */ process.cwd(), process.env.THOON_DATA_FILE ?? '.thoon-data/thoon-db.json'),
    encryptionKey: process.env.THOON_ENCRYPTION_KEY ?? defaultThoonEncryptionKey,
    krakenMarketBaseUrl: process.env.KRAKEN_MARKET_BASE_URL ?? 'https://api.kraken.com',
    kucoinMarketBaseUrl: process.env.KUCOIN_MARKET_BASE_URL ?? 'https://api.kucoin.com',
    liveExchangeProvider: normalizeLiveExchangeProvider(process.env.THOON_LIVE_EXCHANGE_PROVIDER),
    liveOrderEndpoint: process.env.THOON_LIVE_ORDER_ENDPOINT === 'live' ? 'live' : 'test',
    liveOperatorMode: process.env.THOON_LIVE_OPERATOR_MODE === 'saas' ? 'saas' : 'single-user',
    logLevel: normalizeLogLevel(process.env.THOON_LOG_LEVEL),
    loginRateLimitMax: positiveInteger(process.env.THOON_LOGIN_RATE_LIMIT_MAX, 5),
    loginRateLimitWindowSeconds: positiveInteger(process.env.THOON_LOGIN_RATE_LIMIT_WINDOW_SECONDS, 300),
    marketDataProvider: normalizeMarketDataProvider(process.env.THOON_MARKET_DATA_PROVIDER),
    marketKlineLimit: positiveNumber(process.env.THOON_MARKET_KLINE_LIMIT, 120),
    marketRefreshSeconds: positiveNumber(process.env.THOON_MARKET_REFRESH_SECONDS, 30),
    mutationRateLimitMax: positiveInteger(process.env.THOON_MUTATION_RATE_LIMIT_MAX, 240),
    mutationRateLimitWindowSeconds: positiveInteger(process.env.THOON_MUTATION_RATE_LIMIT_WINDOW_SECONDS, 60),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    okxMarketBaseUrl: process.env.OKX_MARKET_BASE_URL ?? 'https://www.okx.com',
    productionBaseUrl: process.env.THOON_PRODUCTION_BASE_URL,
    rateLimitEnabled: process.env.THOON_RATE_LIMIT_ENABLED !== 'false',
    edgeRateLimitPolicy: process.env.THOON_EDGE_RATE_LIMIT_POLICY === 'configured' ? 'configured' : 'missing',
    trustProxyHeaders: process.env.THOON_TRUST_PROXY_HEADERS === 'true' || process.env.VERCEL === '1' || process.env.VERCEL === 'true',
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.THOON_RELEASE ?? 'local',
    saasMode: process.env.THOON_SAAS_MODE === 'enabled',
    stripePriceEliteMonthly: process.env.STRIPE_PRICE_ELITE_MONTHLY?.trim() || undefined,
    stripePriceEliteYearly: process.env.STRIPE_PRICE_ELITE_YEARLY?.trim() || undefined,
    stripePriceProMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY?.trim() || undefined,
    stripePriceProYearly: process.env.STRIPE_PRICE_PRO_YEARLY?.trim() || undefined,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY?.trim() || undefined,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    thoonAdminEmail: process.env.THOON_ADMIN_EMAIL ?? 'owner@thoon.local',
    thoonAdminPasswordHash: process.env.THOON_ADMIN_PASSWORD_HASH,
    tradingViewMcpArgs: splitShellLikeArgs(process.env.THOON_TRADINGVIEW_MCP_ARGS ?? '-y tradingview-mcp-server@0.6.1'),
    tradingViewMcpCommand: process.env.THOON_TRADINGVIEW_MCP_COMMAND ?? 'npx',
    tradingViewMcpName: process.env.THOON_TRADINGVIEW_MCP_NAME ?? 'tradingview',
  };
}

function normalizeAuthMode(value: string | undefined): ThoonServerEnv['authMode'] {
  if (value === 'local-required') {
    return value;
  }

  if (value === 'local-disabled') {
    return process.env.NODE_ENV === 'production' ? 'local-required' : 'local-disabled';
  }

  return process.env.NODE_ENV === 'production' ? 'local-required' : 'local-disabled';
}

function normalizeAuthCookieSecure(value: string | undefined) {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return process.env.NODE_ENV === 'production';
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

function normalizeMarketDataProvider(value: string | undefined): ThoonServerEnv['marketDataProvider'] {
  if (value === 'bud' || value === 'local') {
    return value;
  }

  return 'binance';
}

function normalizeLiveExchangeProvider(value: string | undefined): ThoonServerEnv['liveExchangeProvider'] {
  if (value === 'binance' || value === 'bybit' || value === 'bitget' || value === 'bud') {
    return value;
  }

  return 'disabled';
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Math.floor(Number(value));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function splitShellLikeArgs(value: string) {
  return value
    .match(/"([^"]*)"|'([^']*)'|[^\s]+/g)
    ?.map((item) => item.replace(/^["']|["']$/g, ''))
    .filter(Boolean) ?? [];
}
