import { auditLog } from '@/lib/mock/data';
import type { AuditEntry } from '@/lib/mock/types';

/** Append-only by design: the table grants INSERT and blocks UPDATE and DELETE. */
export async function getAuditLog(): Promise<AuditEntry[]> {
  return auditLog;
}
