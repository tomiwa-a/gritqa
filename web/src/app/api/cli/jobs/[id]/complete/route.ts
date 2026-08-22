import { NextResponse } from 'next/server';
import { cliScope, completeJob, touchInstance } from '@/lib/db/cli';
import type { RunReport, StepReport } from '@/lib/db/cli';
import {
  MAX_MOVED,
  MAX_STEPS,
  ledgerRows,
  parseMoved,
  parseStep,
  int,
  str,
} from '@/lib/cli/report';

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
    /* Falls through to the parse below, which rejects a non-object. */
  }

  const parsed = parse(body);
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

const OUTCOMES = new Set(['passed', 'failed', 'error']);

type Parsed = { ok: true; instanceId: string; report: RunReport } | { ok: false; error: string };

/** Everything the body has to survive before it reaches the database. */
function parse(body: unknown): Parsed {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_body' };
  }
  const input = body as Record<string, unknown>;

  const instanceId = typeof input.instanceId === 'string' ? input.instanceId.trim() : '';
  if (!instanceId || instanceId.length > 255) return { ok: false, error: 'invalid_instance' };

  const outcome = input.outcome;
  if (typeof outcome !== 'string' || !OUTCOMES.has(outcome)) {
    return { ok: false, error: 'invalid_outcome' };
  }

  const rawSteps = input.steps ?? [];
  if (!Array.isArray(rawSteps)) return { ok: false, error: 'invalid_steps' };
  if (rawSteps.length > MAX_STEPS) return { ok: false, error: 'too_many_steps' };

  const steps: StepReport[] = [];
  for (const entry of rawSteps) {
    const step = parseStep(entry);
    if (!step) return { ok: false, error: 'invalid_step' };
    steps.push(step);
  }

  /* The verdict and the steps have to be able to agree, in both directions.
     A `passed` run with a step that did not pass is the obvious half. The other half
     is a `failed` run in which nothing failed, and it is the one that bites: the runs
     table renders that status as "A step failed", the run report reads its headline
     off the cells and finds nothing stopped there, and the two disagree on screen
     about the same row.
     Refused rather than corrected, because either half could be the true one and
     guessing wrong is how that disagreement gets written down as fact. `skipped` is
     allowed through a passing run -- a step nobody reached is not a step that failed --
     and a run that failed before its first step is an `error`, which is what the run
     report already has copy for. */
  const broke = steps.some((s) => s.status === 'failed' || s.status === 'error');
  if ((outcome === 'passed' && broke) || (outcome === 'failed' && !broke)) {
    return { ok: false, error: 'contradictory_outcome' };
  }

  const moved = parseMoved(input.moved);
  if (!moved) return { ok: false, error: 'invalid_moved' };
  if (ledgerRows(steps, moved) > MAX_MOVED) return { ok: false, error: 'too_much_state' };

  return {
    ok: true,
    instanceId,
    report: {
      outcome: outcome as RunReport['outcome'],
      durationMs: int(input.durationMs),
      containerId: str(input.containerId, 64),
      errorMessage: str(input.errorMessage, 4000),
      steps,
      moved,
      stateNote: str(input.stateNote, 4000),
    },
  };
}
