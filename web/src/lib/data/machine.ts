import { cache } from 'react';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { cliInstances } from '@/lib/db/schema';
import { CONNECTED_WITHIN } from '@/lib/db/cli';
import { currentScope } from '@/lib/db/scope';
import { agoLabel } from '@/lib/when';
import type { IndexProgress, Machine, MachineStatus } from '@/lib/model';

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
      progress: cliInstances.progress,
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
    progress: toIndexProgress(row.progress),
  }));

  return { connected: machines.some((m) => m.connected), machines };
});

/** The one question most callers have. */
export async function isCliConnected(): Promise<boolean> {
  return (await getMachineStatus()).connected;
}

/**
 * The stored label, read defensively. The CLI shapes it and nothing validates
 * it, so anything unexpected — a string, a half-written object — reads as no
 * label rather than taking the page down.
 */
function toIndexProgress(value: unknown): IndexProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.stage !== 'string') return null;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  const stages =
    v.stages && typeof v.stages === 'object' && !Array.isArray(v.stages)
      ? Object.fromEntries(
          Object.entries(v.stages as Record<string, unknown>)
            .filter(([, s]) => !!s && typeof s === 'object')
            .map(([stage, s]) => {
              const r = s as Record<string, unknown>;
              return [stage, { done: num(r.done), total: num(r.total) }];
            }),
        )
      : undefined;
  const failures = Array.isArray(v.failures)
    ? v.failures
        .filter(
          (f): f is { stage: string; file: string; reason: string } =>
            !!f &&
            typeof f === 'object' &&
            typeof (f as Record<string, unknown>).file === 'string' &&
            typeof (f as Record<string, unknown>).reason === 'string',
        )
        .slice(0, 20)
    : undefined;
  return {
    stage: v.stage,
    done: num(v.done),
    total: num(v.total),
    ...(stages ? { stages } : {}),
    file: typeof v.file === 'string' ? v.file : null,
    cached: num(v.cached),
    fresh: num(v.fresh),
    failed: num(v.failed),
    ...(failures ? { failures } : {}),
    complete: v.complete === true,
  };
}
