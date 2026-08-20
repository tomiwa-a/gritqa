import { NextResponse } from 'next/server';
import { claimNextJob, cliScope, reapAbandoned, touchInstance } from '@/lib/db/cli';

/**
 * The poll. Every two seconds, per `CAP.md`, and it does three things:
 *
 *   1. records that this machine is alive, which is what makes "connected" answerable
 *   2. returns work abandoned by a machine that died to the queue
 *   3. hands back one job, or nothing
 *
 * All three on one request because they are all "a machine checked in", and splitting
 * them would mean three round trips every two seconds to learn the same fact.
 *
 * 200 with `{ job: null }` rather than 204 for an empty queue. A no-content response
 * cannot carry the reap count or the poll interval, and "nothing waiting" is a normal
 * answer to a successful question -- not an absence of one.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const scope = await cliScope(request);
  if (!scope) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  let body: { instanceId?: unknown; hostname?: unknown; version?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* An empty or unparseable body is the same as no identity, handled below. */
  }

  // The one required field, because without it there is no row to move and the
  // dashboard's "which machine" has no answer. Rejected rather than defaulted: a
  // machine calling itself `unknown` would merge with every other one that did.
  const instanceId = typeof body.instanceId === 'string' ? body.instanceId.trim() : '';
  if (!instanceId || instanceId.length > 255) {
    return NextResponse.json({ error: 'invalid_instance' }, { status: 400, headers: NO_STORE });
  }

  await touchInstance(scope.projectId, {
    instanceId,
    hostname: str(body.hostname, 255),
    version: str(body.version, 64),
  });

  // Before handing out new work, take back work nobody is doing. A machine that
  // crashed mid-run holds its plan's only live slot until this runs.
  const reaped = await reapAbandoned(scope.projectId);

  const job = await claimNextJob(scope, instanceId);

  return NextResponse.json({ job, reaped, pollAfterMs: 2000 }, { headers: NO_STORE });
}

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Optional, self-reported, and length-bounded because the columns are. */
function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}
