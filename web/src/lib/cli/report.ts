import type { StepReport } from '@/lib/db/cli';
import type { TestResultRow } from '@/lib/db/schema';
import type { MovedUnit } from '@/lib/model';

/**
 * Reading a step off the wire, shared by the two endpoints that take one.
 *
 * A completion sends every step at once and settles the run; the preview sends them
 * as they finish and settles nothing. The step itself is the same shape either way,
 * and it is worth it being literally the same code: the two differing on what a
 * `status` may be, or on how a body is bounded, would show up as a run whose steps
 * changed when it finished.
 *
 * The enums are checked here rather than left to Postgres because a rejected enum
 * value is a 500 by the time it is a constraint violation, and there is a machine on
 * the other end of the wire that needs telling what it got wrong.
 */

/**
 * More steps than this is a runner bug or a machine that has lost its mind, not a
 * test plan. Plans are drafted in handfuls; the largest thing here by far is the
 * bodies, and five hundred of those is already a request worth refusing.
 */
export const MAX_STEPS = 500;

/**
 * Ledger rows for one request, steps and run together. A unit only appears when it
 * moved, so a run over the hotel project's 45 tables reports a handful; this is the
 * ceiling that says a machine sending thousands has a bug rather than a finding.
 */
export const MAX_MOVED = 2_000;

/**
 * Per-body ceiling. Over it, the body is replaced by a marker rather than the request
 * being refused: a step's status, timing and assertions are what the report is for,
 * and losing all of that because one response was a 4MB file dump would be the wrong
 * trade. Nothing renders bodies yet, which is why replacing one costs nothing today.
 */
const MAX_BODY_BYTES = 64 * 1024;

const STEP_STATUSES = new Set(['pending', 'passed', 'failed', 'skipped', 'error']);

/* Absent is `http`, not a rejection: a CLI older than the two other kinds omits the
   field, and every step it ever ran was a request. */
const STEP_KINDS = new Set(['http', 'sql', 'shell']);

/**
 * What a shell step printed, bounded the way `errorMessage` is. A build log is not a
 * step result, and the runner has already cut this to its last few KB — the end being
 * the half worth keeping, since a command that fails says why at the bottom.
 */
const MAX_OUTPUT = 16_000;

/** How many ledger rows a report is asking to write, which is what MAX_MOVED bounds. */
export function ledgerRows(steps: StepReport[], runMoved: MovedUnit[]): number {
  return runMoved.length + steps.reduce((n, s) => n + (s.moved?.length ?? 0), 0);
}

/** Null for anything that is not a step, which the caller turns into a 400. */
export function parseStep(entry: unknown): StepReport | null {
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

  const kind = step.kind === undefined || step.kind === null ? 'http' : step.kind;
  if (typeof kind !== 'string' || !STEP_KINDS.has(kind)) return null;

  const moved = parseMoved(step.moved);
  if (!moved) return null;

  return {
    stepId,
    stepName,
    status: step.status as TestResultRow['status'],
    kind: kind as TestResultRow['stepKind'],
    method,
    /* Held to null for the other two kinds rather than trusted. `route_pattern` is
       what the coverage grid counts, and a statement landing in it would draw a
       square for an endpoint named SELECT. The runner already leaves it empty for a
       sql or shell step; this is the half that does not depend on it being right. */
    routePattern: kind === 'http' ? str(step.routePattern, 2048) : null,
    /* The URL for a request, the statement or the command for the other two, with
       the variables filled in and the secrets masked. One column because it answers
       one question -- what this step actually did. */
    requestUrl: str(step.requestUrl, 4096),
    requestBody: bounded(step.requestBody),
    responseStatus: int(step.responseStatus),
    responseBody: bounded(step.responseBody),
    responseTimeMs: int(step.responseTimeMs),
    /* `signed`, not `int`: a fixture that deletes moves a count down, and flooring
       that at zero erases the finding. Absent stays absent rather than becoming 0,
       because 0 rows is the answer a verification step exists to catch -- "returned
       201, wrote nothing" -- and it must be tellable from a step with no rows at
       all. Same for an exit code, where 0 is success. */
    rowCount: step.rowCount === undefined ? null : signed(step.rowCount),
    exitCode: step.exitCode === undefined ? null : signed(step.exitCode),
    output: str(step.output, MAX_OUTPUT),
    assertions: bounded(step.assertions),
    errorMessage: str(step.errorMessage, 4000),
    moved,
  };
}

/**
 * What moved, as the runner measured it. Null for anything that is not a ledger.
 *
 * A unit names a table or a watched path, so an over-long one is refused rather than
 * trimmed for the same reason a step id is: a truncated name is a different unit.
 */
export function parseMoved(value: unknown): MovedUnit[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;

  const out: MovedUnit[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const unit = entry as Record<string, unknown>;

    const name = typeof unit.unit === 'string' ? unit.unit.trim() : '';
    if (!name || name.length > 1024) return null;

    const rows = signed(unit.rows);
    if (rows === null) return null;

    out.push({
      unit: name,
      rows,
      from: str(unit.from, 1024),
      to: str(unit.to, 1024),
    });
  }
  return out;
}

/** Optional, self-reported, and length-bounded because the columns are. */
export function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}

/** Whole, non-negative, and inside the INTEGER the column is. */
export function int(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const whole = Math.trunc(value);
  if (whole < 0) return null;
  return Math.min(whole, 2_147_483_647);
}

/**
 * Whole and signed, unlike `int`: a delete moving a count down is as much a finding as
 * an insert, and flooring it at zero would erase the half of the ledger that is
 * hardest to get any other way. `rows_moved` is a bigint, so the bound is what a JS
 * number can carry exactly.
 */
export function signed(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const whole = Math.trunc(value);
  return Number.isSafeInteger(whole) ? whole : null;
}

/**
 * A JSONB value, or a note saying how big the one we were sent was.
 *
 * `undefined` becomes null rather than being passed through: `jsonb` has no
 * representation for it, and a column holding the JSON literal `null` and a column
 * holding SQL NULL are two different answers to "was there a body".
 */
export function bounded(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  // Safe to stringify unconditionally: this came out of `JSON.parse`, so there is
  // nothing in it that cannot go back the other way.
  const bytes = Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8');
  return bytes > MAX_BODY_BYTES ? { truncated: true, bytes } : value;
}
