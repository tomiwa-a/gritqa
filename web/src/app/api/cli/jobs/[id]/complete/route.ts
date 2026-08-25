import { NextResponse } from 'next/server';
import { cliScope, completeJob, touchInstance } from '@/lib/db/cli';
import { parseReport } from '@/lib/cli/report';

/**
 * The results come home. This is the end of the round trip that started with
 * `Ask to run`, and the point at which a run stops being a preview and becomes what
 * the dashboard verdicts against.
 *
 * One endpoint for both job types, because "the job is done" is the same news
 * whichever job it was. Steps are only meaningful for `execute_tests`, and
 * `completeJob` ignores them for anything else rather than making the CLI send a
 * different shape to say the same thing.
 *
 * Reporting twice is not an error and not a duplicate. `completeJob` moves the job
 * from `claimed` to `completed` in the same statement it authorises with, so a
 * retried POST matches nothing and gets the same 404 as a job that was never this
 * machine's -- which is the truth, once the job has been handed back.
 *
 * **This is the record, and `steps` beside it is the preview.** A run reports each
 * step as it finishes so the dashboard has something to show while it is running, and
 * `completeJob` clears every one of those rows before writing these. Which arrival
 * wins is therefore not a question the two endpoints have to agree on: the completion
 * is last by construction, and the CLI stops previewing before it sends one.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await cliScope(request);
  if (!scope) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    /* Falls through to `parseReport`, which rejects a non-object. */
  }

  const parsed = parseReport(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });
  }

  const { id } = await params;
  const done = await completeJob(scope, id, parsed.instanceId, parsed.report);
  if (!done) {
    return NextResponse.json({ error: 'not_your_job' }, { status: 404, headers: NO_STORE });
  }

  // Reporting is a sighting, same as the poll and the heartbeat. A machine that
  // finishes a long run and then goes idle should not read as disconnected in the
  // gap before its next poll.
  await touchInstance(scope.projectId, { instanceId: parsed.instanceId });

  return NextResponse.json(
    { ok: true, run: done.runPublicId, steps: done.steps },
    { headers: NO_STORE },
  );
}

const NO_STORE = { 'Cache-Control': 'no-store' };
