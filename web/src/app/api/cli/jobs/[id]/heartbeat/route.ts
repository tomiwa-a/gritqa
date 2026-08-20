import { NextResponse } from 'next/server';
import { cliScope, heartbeatJob, touchInstance } from '@/lib/db/cli';

/**
 * "Still working on this one."
 *
 * The poll already carries liveness, but a machine running a long plan is not
 * polling -- it is busy -- so without this the reap would take a job away from a CLI
 * that was doing it perfectly well. This is the only thing that moves `claimed_at`
 * once a job has been claimed.
 *
 * 404 when the job is not this project's, not claimed, or claimed by a different
 * machine. All three mean the same thing to the caller: stop working on it, it is not
 * yours. Not 403 -- distinguishing "exists but is someone else's" from "does not
 * exist" would tell a misconfigured CLI about rows it has no business knowing.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await cliScope(request);
  if (!scope) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  let body: { instanceId?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* Falls through to the invalid_instance check. */
  }

  const instanceId = typeof body.instanceId === 'string' ? body.instanceId.trim() : '';
  if (!instanceId) {
    return NextResponse.json({ error: 'invalid_instance' }, { status: 400, headers: NO_STORE });
  }

  const { id } = await params;
  const held = await heartbeatJob(scope, id, instanceId);
  if (!held) {
    return NextResponse.json({ error: 'not_your_job' }, { status: 404, headers: NO_STORE });
  }

  // A heartbeat is also a sighting. A machine deep in a thirty-second run would
  // otherwise look disconnected on the dashboard for the whole time it was working.
  await touchInstance(scope.projectId, { instanceId });

  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

const NO_STORE = { 'Cache-Control': 'no-store' };
