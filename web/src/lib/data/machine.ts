import { cache } from 'react';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { cliInstances } from '@/lib/db/schema';
import { CONNECTED_WITHIN } from '@/lib/db/cli';
import { currentScope } from '@/lib/db/scope';
import { agoLabel } from '@/lib/when';
import type { Machine, MachineStatus } from '@/lib/model';

/**
 * Whether a machine is there, which four screens have been guessing at.
 *
 * They read `projects.last_indexed_at` and rendered "your machine is connected",
 * which is not what that column knows -- it knows a machine was here once, and a
 * developer who indexed a project in March would be told their laptop was standing
 * by. The poll writes `cli_instances.last_seen_at` every two seconds; this reads it.
 *
 * `connected` is computed in Postgres rather than from a JavaScript clock, so the
 * comparison happens against the same `now()` the poll wrote against. Node's clock
 * and the database's are usually close and there is no reason to depend on it.
 *
 * Every machine, not just the connected one. "Connected from studio-mbp, 3s ago" is
 * a better sentence than "connected", and a developer whose desktop is polling while
 * they sit at their laptop is owed the name.
 */
export const getMachineStatus = cache(async (): Promise<MachineStatus> => {
  const scope = await currentScope();
  if (!scope) return { connected: false, machines: [] };

  const rows = await db
    .select({
      instanceId: cliInstances.instanceId,
      hostname: cliInstances.hostname,
      version: cliInstances.version,
      lastSeenAt: cliInstances.lastSeenAt,
      connected: sql<boolean>`${cliInstances.lastSeenAt} > now() - ${CONNECTED_WITHIN}::interval`,
    })
    .from(cliInstances)
    .where(eq(cliInstances.projectId, scope.projectId))
    .orderBy(desc(cliInstances.lastSeenAt))
    .limit(10);

  const machines: Machine[] = rows.map((row) => ({
    instanceId: row.instanceId,
    hostname: row.hostname,
    version: row.version,
    connected: row.connected,
    lastSeenLabel: agoLabel(row.lastSeenAt),
    lastSeenAt: row.lastSeenAt.toISOString(),
  }));

  return { connected: machines.some((m) => m.connected), machines };
});

/** The one question most callers have. */
export async function isCliConnected(): Promise<boolean> {
  return (await getMachineStatus()).connected;
}
