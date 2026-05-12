import { getThoonServerEnv } from './env';

type MetricCounters = {
  apiErrors: number;
  apiRequests: number;
  authFailures: number;
  liveOrdersBlocked: number;
  liveOrdersSent: number;
  rateLimitedRequests: number;
  riskBlocks: number;
};

const counters: MetricCounters = {
  apiErrors: 0,
  apiRequests: 0,
  authFailures: 0,
  liveOrdersBlocked: 0,
  liveOrdersSent: 0,
  rateLimitedRequests: 0,
  riskBlocks: 0,
};

const apiStatusCounts: Record<string, number> = {};
const apiLatencyBuckets: Record<'lt100ms' | 'lt500ms' | 'lt1000ms' | 'gte1000ms', number> = {
  gte1000ms: 0,
  lt1000ms: 0,
  lt100ms: 0,
  lt500ms: 0,
};

export function incrementMetric(name: keyof MetricCounters) {
  counters[name] += 1;
}

export function observeApiResponse(input: { durationMs: number; method: string; path: string; requestId: string; status: number }) {
  counters.apiRequests += 1;
  apiStatusCounts[String(input.status)] = (apiStatusCounts[String(input.status)] ?? 0) + 1;

  if (input.durationMs < 100) {
    apiLatencyBuckets.lt100ms += 1;
  } else if (input.durationMs < 500) {
    apiLatencyBuckets.lt500ms += 1;
  } else if (input.durationMs < 1000) {
    apiLatencyBuckets.lt1000ms += 1;
  } else {
    apiLatencyBuckets.gte1000ms += 1;
  }

  if (input.status >= 500) {
    logServerEvent('error', 'api.response', input);
  } else if (input.status === 401 || input.status === 403 || input.status === 429) {
    logServerEvent('warn', 'api.response', input);
  }
}

export function getMetricsSnapshot() {
  return {
    apiLatencyBuckets: { ...apiLatencyBuckets },
    apiStatusCounts: { ...apiStatusCounts },
    counters: { ...counters },
    release: getThoonServerEnv().release,
    timestamp: new Date().toISOString(),
  };
}

export function logServerEvent(level: 'debug' | 'info' | 'warn' | 'error', event: string, details: Record<string, unknown> = {}) {
  const env = getThoonServerEnv();
  const levels = ['debug', 'info', 'warn', 'error'];

  if (levels.indexOf(level) < levels.indexOf(env.logLevel)) {
    return;
  }

  const payload = {
    details,
    event,
    level,
    release: env.release,
    time: new Date().toISOString(),
  };

  const line = JSON.stringify(payload);

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}
