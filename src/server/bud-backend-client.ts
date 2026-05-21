import { getThoonServerEnv } from './env';

type BudRequestOptions = {
  body?: unknown;
  method?: 'GET' | 'POST';
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type BudHealthStatus = {
  binance_rest: string;
  status: string;
};

export type BudPrice = {
  price: number;
  symbol: string;
};

export type BudTicker24h = {
  last_price: number;
  price_change_percent: number;
  quote_volume: number;
  symbol: string;
  volume: number;
};

export type BudCandle = {
  close: number;
  high: number;
  low: number;
  open: number;
  timestamp: number;
  volume: number;
};

export type BudStrategyOrchestrationResult = {
  confidence: number;
  reasoning_chain: string[];
  regime: string;
  risk_profile: {
    current_price: number;
    current_position_market_value: number;
    current_position_quantity: number;
    estimated_drawdown: number;
    lookback_drawdown_percent: number;
    projected_exposure: number;
    realized_volatility_percent: number;
    requested_notional: number;
    side: string;
    symbol: string;
    violations: string[];
    within_limits: boolean;
  };
  strategy: {
    confidence: number;
    entry_price: number;
    name: string;
    position_size_fraction: number;
    rationale: string;
    rejection_reasons: string[];
    side: string;
    signals: string[];
    status: string;
    stop_loss_price: number;
    symbol: string;
    take_profit_price: number;
    time_horizon: string;
  };
};

export type BudPaperOrder = {
  client_order_id?: string;
  quantity: number;
  side: 'buy' | 'sell';
  symbol: string;
};

export type BudPaperState = {
  last_trade: Record<string, unknown> | null;
  position: {
    average_entry_price: number;
    market_price: number;
    market_value: number;
    quantity: number;
    realized_pnl: number;
    symbol: string;
    total_pnl: number;
    unrealized_pnl: number;
    updated_at: string;
  };
  risk_limits: Record<string, unknown>;
  source: string;
  symbol: string;
  timestamp: string;
  trades_count: number;
};

export class BudBackendError extends Error {
  details?: string;
  status: number;

  constructor(message: string, status: number, details?: string) {
    super(message);
    this.name = 'BudBackendError';
    this.status = status;
    this.details = details;
  }
}

export async function budBackendJson<T>(path: string, options: BudRequestOptions = {}): Promise<T> {
  const env = getThoonServerEnv();
  const url = new URL(path, normalizedBaseUrl(env.budBackendUrl));
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? env.budBackendTimeoutMs;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    const response = await fetch(url, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
      headers: options.body === undefined ? undefined : { Accept: 'application/json', 'Content-Type': 'application/json' },
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? parseJson(text) : null;

    if (!response.ok) {
      throw new BudBackendError(errorMessage(payload, response.status), response.status, errorDetails(payload));
    }

    return payload as T;
  } catch (error) {
    if (error instanceof BudBackendError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new BudBackendError(`Bud backend timeout after ${timeoutMs}ms`, 504);
    }

    throw new BudBackendError(error instanceof Error ? error.message : 'Bud backend unavailable', 503);
  } finally {
    clearTimeout(timeout);
  }
}

export function getBudHealth(signal?: AbortSignal) {
  return budBackendJson<BudHealthStatus>('/health', { signal });
}

export function getBudPrice(symbol: string, signal?: AbortSignal) {
  return budBackendJson<BudPrice>(`/price/${normalizeBudSymbol(symbol)}`, { signal });
}

export function getBudTicker(symbol: string, signal?: AbortSignal) {
  return budBackendJson<BudTicker24h>(`/ticker/${normalizeBudSymbol(symbol)}`, { signal });
}

export function getBudCandles(symbol: string, interval = '1h', limit = 120, signal?: AbortSignal) {
  const path = `/candles/${normalizeBudSymbol(symbol)}?interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(String(limit))}`;
  return budBackendJson<BudCandle[]>(path, { signal });
}

export function getBudExecutionCapabilities(signal?: AbortSignal) {
  return budBackendJson<Record<string, unknown>>('/execution/capabilities', { signal });
}

export function getBudPositions(searchParams = '', signal?: AbortSignal) {
  const suffix = searchParams ? `?${searchParams}` : '';
  return budBackendJson<Record<string, unknown>[]>(`/positions${suffix}`, { signal });
}

export function runBudStrategyOrchestration(body: Record<string, unknown>, signal?: AbortSignal) {
  return budBackendJson<BudStrategyOrchestrationResult>('/orchestrate/strategy', { body, method: 'POST', signal, timeoutMs: 420_000 });
}

export function runBudBacktest(body: Record<string, unknown>, signal?: AbortSignal) {
  return budBackendJson<Record<string, unknown>>('/backtest/run', { body, method: 'POST', signal, timeoutMs: 120_000 });
}

export function runBudResearch(body: Record<string, unknown>, signal?: AbortSignal) {
  return budBackendJson<Record<string, unknown>>('/research-platform/run', { body, method: 'POST', signal, timeoutMs: 180_000 });
}

export function getBudResearchRuns(limit = 25, signal?: AbortSignal) {
  return budBackendJson<Record<string, unknown>[]>(`/research-platform/runs?limit=${encodeURIComponent(String(limit))}`, { signal });
}

export function getBudResearchStrategies(limit = 50, signal?: AbortSignal) {
  return budBackendJson<Record<string, unknown>[]>(`/research-platform/strategies?limit=${encodeURIComponent(String(limit))}`, { signal });
}

export function getBudResearchEvaluations(limit = 50, signal?: AbortSignal) {
  return budBackendJson<Record<string, unknown>[]>(`/research-platform/evaluations?limit=${encodeURIComponent(String(limit))}`, { signal });
}

export function registerBudResearchStrategy(body: Record<string, unknown>, signal?: AbortSignal) {
  return budBackendJson<Record<string, unknown>>('/research-platform/strategies', { body, method: 'POST', signal, timeoutMs: 120_000 });
}

export function getBudPaperRiskLimits(signal?: AbortSignal) {
  return budBackendJson<Record<string, unknown>>('/paper/risk-limits', { signal });
}

export function getBudPaperState(symbol: string, signal?: AbortSignal) {
  return budBackendJson<BudPaperState>(`/paper/${normalizeBudSymbol(symbol)}/state`, { signal });
}

export function getBudPaperTrades(symbol: string, limit = 100, signal?: AbortSignal) {
  return budBackendJson<Record<string, unknown>[]>(`/paper/${normalizeBudSymbol(symbol)}/trades?limit=${encodeURIComponent(String(limit))}`, { signal });
}

export function placeBudPaperOrder(order: BudPaperOrder, signal?: AbortSignal) {
  return budBackendJson<Record<string, unknown>>('/paper/orders', {
    body: {
      ...order,
      symbol: normalizeBudSymbol(order.symbol),
    },
    method: 'POST',
    signal,
  });
}

export function placeBudTrade(body: Record<string, unknown>, signal?: AbortSignal) {
  return budBackendJson<Record<string, unknown>>('/trade', {
    body,
    method: 'POST',
    signal,
    timeoutMs: 120_000,
  });
}

export function checkBudLiveReadiness(body: Record<string, unknown>, signal?: AbortSignal) {
  return budBackendJson<Record<string, unknown>>('/live-readiness/check', { body, method: 'POST', signal, timeoutMs: 120_000 });
}

export function commandBudKillSwitch(body: Record<string, unknown>, signal?: AbortSignal) {
  return budBackendJson<Record<string, unknown>>('/kill-switch', { body, method: 'POST', signal });
}

export function scanBudArbitrage(body: Record<string, unknown>, signal?: AbortSignal) {
  return budBackendJson<Record<string, unknown>>('/arbitrage/scan', { body, method: 'POST', signal, timeoutMs: 90_000 });
}

export function constructBudPortfolio(body: Record<string, unknown>, signal?: AbortSignal) {
  return budBackendJson<Record<string, unknown>>('/portfolio/advanced/construct', { body, method: 'POST', signal, timeoutMs: 120_000 });
}

export function analyzeBudMacro(body: Record<string, unknown>, signal?: AbortSignal) {
  return budBackendJson<Record<string, unknown>>('/macro-quant/analyze', { body, method: 'POST', signal, timeoutMs: 120_000 });
}

export function normalizeBudSymbol(symbol: string) {
  return symbol.replace('/', '').replace('-', '').toUpperCase();
}

function normalizedBaseUrl(value: string) {
  return value.endsWith('/') ? value : `${value}/`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(payload: unknown, status: number) {
  if (typeof payload === 'object' && payload !== null && 'detail' in payload) {
    return stringifyErrorValue((payload as { detail: unknown }).detail);
  }

  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    return stringifyErrorValue((payload as { error: unknown }).error);
  }

  return `Bud backend request failed: ${status}`;
}

function errorDetails(payload: unknown) {
  if (typeof payload === 'object' && payload !== null && 'details' in payload) {
    return stringifyErrorValue((payload as { details: unknown }).details);
  }

  return undefined;
}

function stringifyErrorValue(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
