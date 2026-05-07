import { getThoonServerEnv } from './env';

type MetricCounters = {
  apiErrors: number;
  apiRequests: number;
  liveOrdersBlocked: number;
  liveOrdersSent: number;
  riskBlocks: number;
};

const counters: MetricCounters = {
  apiErrors: 0,
  apiRequests: 0,
  liveOrdersBlocked: 0,
  liveOrdersSent: 0,
  riskBlocks: 0,
};

export function incrementMetric(name: keyof MetricCounters) {
  counters[name] += 1;
}

export function getMetricsSnapshot() {
  return {
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
