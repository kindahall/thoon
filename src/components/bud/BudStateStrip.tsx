'use client';

import { AlertTriangle, CircleStop, DatabaseZap, RefreshCcw, ShieldCheck, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';

import { apiJson } from '../../services/api-client';
import { Badge, Button } from '../ui';

type JsonRecord = Record<string, unknown>;

type BudState = {
  error?: string;
  kill?: JsonRecord | null;
  status?: JsonRecord | null;
};

export function BudStateStrip() {
  const [state, setState] = useState<BudState>({});
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);

    return () => window.clearInterval(interval);
  }, []);

  async function refresh() {
    setRefreshing(true);

    try {
      const [status, kill] = await Promise.all([apiJson<JsonRecord>('/api/bud/status'), apiJson<JsonRecord>('/api/bud/kill-switch')]);
      setState({ kill: unwrapBudPayload(kill), status });
    } catch (error) {
      setState((current) => ({ ...current, error: error instanceof Error ? error.message : 'Bud state unavailable' }));
    } finally {
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
        <Button icon={<RefreshCcw size={14} />} isLoading={refreshing} onClick={() => void refresh()} size="sm" variant="ghost">
          Bud
        </Button>
      </div>
    </section>
  );
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
