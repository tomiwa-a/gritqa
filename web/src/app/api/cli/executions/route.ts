import { NextResponse } from 'next/server';
import { parseReport } from '@/lib/cli/report';
import { cliScope, recordRun, touchInstance } from '@/lib/db/cli';

/**
 * A run nobody queued.
 *
 * `jobs/[id]/complete` settles a run the dashboard started and this records one it did
 * not: a developer typing `gritqa --run` on their own machine, whose result is a fact
 * about the same plan and belongs in the same history. Decision 36 -- history is
 * Postgres's, and the CLI's SQLite is the buffer in front of it -- is what makes that
 * not optional: a per-machine copy cannot show anybody else on the team what ran.
 *
 * **Reported after the fact, so it is inserted already settled.** There is no claim, no
 * heartbeat and nothing to time out, because by the time this arrives the run is over.
 * That is also what keeps it clear of `test_executions_one_live_idx`, which is partial
 * over `pending` and `running`: this row is never either, so a terminal run and a
 * queued run of the same plan cannot collide.
 *
 * The plan has to exist first, which is why `/api/cli/plans` is a prerequisite rather
 * than a companion: `test_executions.test_plan_id` is `NOT NULL`, so a run of a file
 * that never became a plan has nowhere to hang. An unknown plan is a 404 and the CLI
 * keeps the run in its own cache -- a run that happened is worth more than a clean
 * exit.
 *
 * The body is `parseReport`'s, the same one the completion takes. Literally the same
 * validation, so a run reported from a terminal and a run reported from the queue
 * cannot disagree about what a step may look like.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
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

  const input = (body ?? {}) as Record<string, unknown>;
  const planId = typeof input.planId === 'string' ? input.planId.trim() : '';
  if (!planId || planId.length > 64) {
    return NextResponse.json({ error: 'invalid_plan' }, { status: 400, headers: NO_STORE });
  }

  const startedAt = when(input.startedAt);
  if (startedAt === undefined) {
    return NextResponse.json({ error: 'invalid_started_at' }, { status: 400, headers: NO_STORE });
  }

  const run = await recordRun(scope, { planPublicId: planId, startedAt, report: parsed.report });

  // Reporting is a sighting, same as the poll and the heartbeat -- and here it is the
  // only one, since a machine running plans by hand never claims a job.
  await touchInstance(scope.projectId, { instanceId: parsed.instanceId });

  if (!run) {
    return NextResponse.json({ error: 'unknown_plan' }, { status: 404, headers: NO_STORE });
  }

  return NextResponse.json({ ok: true, run: run.runPublicId, steps: run.steps }, { headers: NO_STORE });
}

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * When the run started, as the runner saw it. `null` for absent, `undefined` for
 * something that is not a time -- the caller turns the second into a 400 rather than
 * silently recording a run that began at the epoch.
 */
function when(value: unknown): Date | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? undefined : at;
}
