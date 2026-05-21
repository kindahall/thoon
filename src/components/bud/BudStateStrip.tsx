'use client';

import { AlertTriangle, CircleStop, DatabaseZap, RefreshCcw, ShieldCheck, Wifi } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { apiJson } from '../../services/api-client';
import { Badge, Button } from '../ui';

type JsonRecord = Record<string, unknown>;

type BudState = {
  error?: string;
  kill?: JsonRecord | null;
  status?: JsonRecord | null;
  updatedAt?: number;
};

const budStateRefreshMs = 5 * 60 * 1000;
const budStateCacheMs = 60 * 1000;
const budStateStorageKey = 'thoon:bud-state-strip';

export function BudStateStrip() {
  const [state, setState] = useState<BudState>(() => readCachedBudState());
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  useEffect(() => {
    void refresh({ force: !isBudStateFresh(readCachedBudState(), budStateCacheMs) });
    const interval = window.setInterval(() => {
      if (!document.hidden) {
        void refresh({ force: true });
      }
    }, budStateRefreshMs);
    const onVisibilityChange = () => {
      if (!document.hidden && !isBudStateFresh(readCachedBudState(), budStateRefreshMs)) {
        void refresh({ force: true });
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  async function refresh({ force = false }: { force?: boolean } = {}) {
    if (refreshingRef.current) {
      return;
    }

    if (!force && isBudStateFresh(readCachedBudState(), budStateCacheMs)) {
      return;
    }

    refreshingRef.current = true;
    setRefreshing(true);

    try {
      const [status, kill] = await Promise.all([apiJson<JsonRecord>('/api/bud/status'), apiJson<JsonRecord>('/api/bud/kill-switch')]);
      const nextState = { kill: unwrapBudPayload(kill), status, updatedAt: Date.now() };
      writeCachedBudState(nextState);
      setState(nextState);
    } catch (error) {
      setState((current) => ({ ...current, error: error instanceof Error ? error.message : 'Bud state unavailable' }));
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }

  const status = state.status;
  const kill = state.kill;
  const backendOnline = readPath(status, ['status']) === 'online' || readPath(status, ['health', 'status']) === 'ok';
  const binanceOk = readPath(status, ['health', 'binance_rest']) === 'ok';
  const liveEnabled = readPath(status, ['capabilities', 'live_trading_enabled']) === true;
  const killActive = readPath(kill, ['active']) === true;
  const paperPositions = Array.isArray(readPath(status, ['paperPositions'])) ? (readPath(status, ['paperPositions']) as unknown[]).length : 0;
  const warnings = Array.isArray(readPath(status, ['warnings'])) ? (readPath(status, ['warnings']) as unknown[]).length : 0;
  const receivedAt = typeof readPath(status, ['receivedAt']) === 'string' ? new Date(String(readPath(status, ['receivedAt']))).toLocaleTimeString('fr-FR') : 'NON DEFINI';

  return (
    <section className="bud-state-strip" aria-label="Bud system state">
      <div className="bud-state-strip__left">
        <span className="bud-state-chip">
          <Wifi size={14} />
          <b>{backendOnline ? 'Bud online' : 'Bud offline'}</b>
        </span>
        <span className="bud-state-chip">
          <DatabaseZap size={14} />
          <b>{binanceOk ? 'Binance ok' : 'Binance check'}</b>
        </span>
        <span className="bud-state-chip">
          <ShieldCheck size={14} />
          <b>{liveEnabled ? 'Live enabled' : 'Live blocked'}</b>
        </span>
        <span className="bud-state-chip">
          <CircleStop size={14} />
          <b>{killActive ? 'Kill active' : 'Kill clear'}</b>
        </span>
      </div>
      <div className="bud-state-strip__right">
        {state.error ? (
          <Badge tone="negative">
            <AlertTriangle size={13} />
            {state.error}
          </Badge>
        ) : null}
        <Badge tone={warnings ? 'warning' : 'positive'}>{warnings} warnings</Badge>
        <Badge tone="primary">{paperPositions} paper positions</Badge>
        <Badge tone="neutral">{receivedAt}</Badge>
        <Button icon={<RefreshCcw size={14} />} isLoading={refreshing} onClick={() => void refresh({ force: true })} size="sm" variant="ghost">
          Bud
        </Button>
      </div>
    </section>
  );
}

function readCachedBudState(): BudState {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(budStateStorageKey) ?? '{}') as BudState;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeCachedBudState(state: BudState) {
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(budStateStorageKey, JSON.stringify(state));
  }
}

function isBudStateFresh(state: BudState, maxAgeMs: number) {
  return typeof state.updatedAt === 'number' && Date.now() - state.updatedAt < maxAgeMs;
}

function unwrapBudPayload(value: JsonRecord): JsonRecord {
  return isRecord(value.payload) ? value.payload : value;
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

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
