import { NextResponse } from 'next/server';
import { cliScope, releaseJob, touchInstance } from '@/lib/db/cli';

/**
 * "I cannot do this one -- somebody else take it."
 *
 * Docker is not running, the base URL is unreachable, the machine is shutting down.
 * Without this, a CLI in any of those states has exactly one way to say so: stop
 * answering and wait to be presumed dead. That works, and it takes ninety seconds, and
 * for all ninety of them the dashboard says the run is in progress -- about a machine
 * that is right there and already knows it is not.
 *
 * So the outcome is the reap's, arrived at immediately and on purpose: back to
 * `pending` behind the same backoff while attempts remain, `dead` when they do not,
 * and the run moved to match either way. The reply says which, because "we will try
 * again" and "this run has been given up on" are different things to print.
 *
 * Releasing is not completing. A job that reports a failed test *completed* -- the
 * errand was run and returned a verdict. This is the errand itself not happening, and
 * it is the only thing that puts a job back in the queue on purpose.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await cliScope(request);
  if (!scope) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  let body: { instanceId?: unknown; reason?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* Falls through to the invalid_instance check. */
  }

  const instanceId = typeof body.instanceId === 'string' ? body.instanceId.trim() : '';
  if (!instanceId || instanceId.length > 255) {
    return NextResponse.json({ error: 'invalid_instance' }, { status: 400, headers: NO_STORE });
  }

  /* Optional, and it shows up in front of a developer twice over -- on the job in the
     queue, and as the whole explanation of a run that never made a request. A machine
     that has something to say here should say it. */
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';

  const { id } = await params;
  const outcome = await releaseJob(scope, id, instanceId, reason || null);
  if (!outcome) {
    return NextResponse.json({ error: 'not_your_job' }, { status: 404, headers: NO_STORE });
  }

  // A release is still a sighting: the machine is up, it just cannot do this.
  await touchInstance(scope.projectId, { instanceId });

  return NextResponse.json({ ok: true, outcome }, { headers: NO_STORE });
}

const NO_STORE = { 'Cache-Control': 'no-store' };
