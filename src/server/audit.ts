import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { AuditEvent } from '../types/trading';
import { getThoonServerEnv } from './env';
import { logServerEvent } from './observability';
import type { ThoonDb } from './thoon-db';

type AuditInput = Omit<AuditEvent, 'id' | 'ipAddress' | 'time'> & {
  ipAddress?: string;
  time?: string;
};

type AuditContext = {
  ipAddress?: string;
  requestId?: string;
};

const auditContext = new AsyncLocalStorage<AuditContext>();

export function runWithAuditContext<T>(context: AuditContext, callback: () => T): T {
  return auditContext.run(context, callback);
}

export function appendAuditEvent(db: ThoonDb, input: AuditInput): AuditEvent {
  const env = getThoonServerEnv();
  const context = auditContext.getStore();
  const event: AuditEvent = {
    ...input,
    id: `audit-${input.eventType}-${randomUUID()}`,
    ipAddress: input.ipAddress ?? context?.ipAddress ?? 'local',
    time: input.time ?? new Date().toISOString(),
  };
  const retentionCutoff = Date.now() - env.auditRetentionDays * 24 * 60 * 60 * 1000;

  db.auditLogRecords = [event, ...db.auditLogRecords]
    .filter((record) => new Date(record.time).getTime() >= retentionCutoff)
    .slice(0, env.auditMaxEvents);
  logServerEvent(event.status === 'blocked' || event.status === 'failed' ? 'warn' : 'info', 'audit.event', {
    action: event.action,
    actor: event.actor,
    eventType: event.eventType,
    requestId: context?.requestId,
    status: event.status,
    symbol: event.symbol,
  });

  return event;
}
