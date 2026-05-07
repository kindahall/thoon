import type { AuditEvent } from '../types/trading';
import type { ThoonDb } from './thoon-db';

type AuditInput = Omit<AuditEvent, 'id' | 'ipAddress' | 'time'> & {
  ipAddress?: string;
  time?: string;
};

export function appendAuditEvent(db: ThoonDb, input: AuditInput): AuditEvent {
  const event: AuditEvent = {
    ...input,
    id: `audit-${input.eventType}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ipAddress: input.ipAddress ?? '127.0.0.1',
    time: input.time ?? new Date().toISOString(),
  };

  db.auditLogRecords = [event, ...db.auditLogRecords].slice(0, 500);

  return event;
}
