import { NextResponse } from 'next/server';
import { cliScope, completeJob, touchInstance } from '@/lib/db/cli';
import type { RunReport, StepReport } from '@/lib/db/cli';
import type { TestResultRow } from '@/lib/db/schema';

/**
 * The results come home. This is the end of the round trip that started with
 * `Ask to run`, and the first point at which the runs UI is reading something a
 * machine actually did.
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
 * **Not incremental.** A run reports once, at the end. `CAP.md` promises results as
 * they come in, and that is still owed: it needs a second endpoint and a rule for
 * which arrival wins, and a run that reports twice is exactly what the transition
 * above is built to refuse. Until then the dashboard shows `running` with no steps
 * for the length of a run, and the step panel says so in as many words.
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

/**
 * More steps than this is a runner bug or a machine that has lost its mind, not a
 * test plan. Plans are drafted in handfuls; the largest thing here by far is the
 * bodies, and five hundred of those is already a request worth refusing.
 */
const MAX_STEPS = 500;

/**
 * Per-body ceiling. Over it, the body is replaced by a marker rather than the request
 * being refused: a step's status, timing and assertions are what the report is for,
 * and losing all of that because one response was a 4MB file dump would be the wrong
 * trade. Nothing renders bodies yet, which is why replacing one costs nothing today.
 */
const MAX_BODY_BYTES = 64 * 1024;

const OUTCOMES = new Set(['passed', 'failed', 'error']);
const STEP_STATUSES = new Set(['pending', 'passed', 'failed', 'skipped', 'error']);

type Parsed = { ok: true; instanceId: string; report: RunReport } | { ok: false; error: string };

/**
 * Everything the body has to survive before it reaches the database.
 *
 * The enums are checked here rather than left to Postgres because a rejected enum
 * value is a 500 by the time it is a constraint violation, and this is a machine on
 * the other end of a wire that needs to be told what it got wrong.
 */
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

  return {
    ok: true,
    instanceId,
    report: {
      outcome: outcome as RunReport['outcome'],
      durationMs: int(input.durationMs),
      containerId: str(input.containerId, 64),
      errorMessage: str(input.errorMessage, 4000),
      steps,
    },
  };
}

/** Null for anything that is not a step, which the caller turns into a 400. */
function parseStep(entry: unknown): StepReport | null {
  if (!entry || typeof entry !== 'object') return null;
  const step = entry as Record<string, unknown>;

  // Both columns are NOT NULL and both are varchar(255), so an over-long value has to
  // be refused rather than trimmed: a truncated step id names a different step.
  const stepId = typeof step.stepId === 'string' ? step.stepId.trim() : '';
  const stepName = typeof step.stepName === 'string' ? step.stepName.trim() : '';
  if (!stepId || stepId.length > 255) return null;
  if (!stepName || stepName.length > 255) return null;

  if (typeof step.status !== 'string' || !STEP_STATUSES.has(step.status)) return null;

  // Same reasoning as the ids: `request_method` is varchar(10), and a truncated method
  // is a different method.
  const method = typeof step.method === 'string' ? step.method.trim().toUpperCase() : null;
  if (method !== null && (method.length === 0 || method.length > 10)) return null;

  return {
    stepId,
    stepName,
    status: step.status as TestResultRow['status'],
    method,
    routePattern: str(step.routePattern, 2048),
    requestUrl: str(step.requestUrl, 4096),
    requestBody: bounded(step.requestBody),
    responseStatus: int(step.responseStatus),
    responseBody: bounded(step.responseBody),
    responseTimeMs: int(step.responseTimeMs),
    assertions: bounded(step.assertions),
    errorMessage: str(step.errorMessage, 4000),
  };
}

/** Optional, self-reported, and length-bounded because the columns are. */
function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}

/** Whole, non-negative, and inside the INTEGER the column is. */
function int(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const whole = Math.trunc(value);
  if (whole < 0) return null;
  return Math.min(whole, 2_147_483_647);
}

/**
 * A JSONB value, or a note saying how big the one we were sent was.
 *
 * `undefined` becomes null rather than being passed through: `jsonb` has no
 * representation for it, and a column holding the JSON literal `null` and a column
 * holding SQL NULL are two different answers to "was there a body".
 */
function bounded(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  // Safe to stringify unconditionally: this came out of `JSON.parse`, so there is
  // nothing in it that cannot go back the other way.
  const bytes = Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8');
  return bytes > MAX_BODY_BYTES ? { truncated: true, bytes } : value;
}
