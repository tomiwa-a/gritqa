import { cache } from 'react';
import { currentScope } from '@/lib/db/scope';
import { listAudit } from '@/lib/db/audit';
import type { AuditEntry } from '@/lib/mock/types';

/** Append-only by design: the table grants INSERT and a trigger refuses the rest. */
export const getAuditLog = cache(async (): Promise<AuditEntry[]> => {
  const scope = await currentScope();
  if (!scope) return [];
  return listAudit(scope.userId);
});
