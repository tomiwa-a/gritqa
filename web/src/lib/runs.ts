import type { ExecutionStatus, RunHistoryEntry, StepResult, TestExecution } from '@/lib/model';

export const CELL_FILL: Record<string, string> = { p: 'bg-pass', f: 'bg-fail', s: 'bg-skip' };
export const CELL_WORD: Record<string, string> = { p: 'passed', f: 'failed', s: 'skipped' };

export const STEP_TONE: Record<StepResult['status'], 'pass' | 'fail' | 'skip' | 'running'> = {
  passed: 'pass',
  failed: 'fail',
  error: 'fail',
  skipped: 'skip',
  pending: 'running',
};

export const STEP_WORD: Record<StepResult['status'], string> = {
  passed: 'Passed',
  failed: 'Failed',
  error: 'Could not run',
  skipped: 'Never reached',
  pending: 'Waiting',
};

/**
 * What a step was about, in one line.
 *
 * A request has a route pattern and the other two kinds do not, so `path` is null for
 * them and the line comes from `detail` -- the statement or the command as it actually
 * ran, variables filled in and secrets masked. Collapsed to one line here because
 * every caller is a single-line cell; the drawer that shows a statement whole calls
 * neither of these.
 */
export function stepLine(step: StepResult): string {
  if (step.kind === 'http') return step.path ?? '';
  return (step.detail ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The number a step came back with, which is a different number per kind.
 *
 * Null rather than a dash, so a caller can lay out the absence its own way. Zero is
 * never absent in either of the new kinds: `0 rows` is the whole point of a
 * verification query -- "returned 201, wrote nothing" -- and `exit 0` is success.
 */
export function stepOutcome(step: StepResult): string | null {
  if (step.kind === 'sql') {
    return step.rowCount === null ? null : `${step.rowCount} row${step.rowCount === 1 ? '' : 's'}`;
  }
  if (step.kind === 'shell') {
    return step.exitCode === null ? null : `exit ${step.exitCode}`;
  }
  return step.responseStatus === null ? null : String(step.responseStatus);
}

export type RunRow = RunHistoryEntry & {
  /** Only the newest runs carry a step-by-step report in this build. */
  detail: TestExecution | undefined;
  steps: number;
  passed: number;
};

/**
 * Every derivation here takes its data rather than reading it, so the module stays
 * pure and one read serves a whole page. Once these rows come from Postgres, a
 * function that fetched for itself would mean a query per call.
 */
function rowFor(recent: TestExecution[], entry: RunHistoryEntry): RunRow {
  const cells = [...entry.cells];
  return {
    ...entry,
    detail: recent.find((r) => r.publicId === entry.publicId),
    steps: cells.length,
    passed: cells.filter((c) => c === 'p').length,
  };
}

/** Newest first — the order every list in the product reads in. */
export function runRowsOf(history: RunHistoryEntry[], recent: TestExecution[]): RunRow[] {
  return [...history].reverse().map((entry) => rowFor(recent, entry));
}

export function runRowFor(rows: RunRow[], id: string): RunRow | undefined {
  return rows.find((r) => r.publicId === id);
}

export function runsForPlan(rows: RunRow[], planPublicId: string): RunRow[] {
  return rows.filter((r) => r.planPublicId === planPublicId);
}

export function brokeAt(run: RunRow): StepResult | undefined {
  return run.detail?.steps.find((s) => s.status === 'failed' || s.status === 'error');
}

/**
 * Where a run stopped, as a step index, or -1 if nothing stopped it.
 *
 * Read off `cells` rather than off the step report: both are the same `test_results`
 * rows in the same order, and every run in the window carries its cells while only
 * the newest carry a report. So this still answers for a run whose requests are no
 * longer on hand -- which is the case the fallback panel below the report describes.
 */
export function stoppedAt(run: RunRow): number {
  return run.cells.indexOf('f');
}

/**
 * Where a run got to, in one sentence.
 *
 * Two screens ask this -- the run report and the list's preview drawer -- and each
 * had its own ternary over the same states. They drifted, which is how the drawer
 * came to tell a queued run that all zero of its steps had passed.
 *
 * The last arm is the one that matters: it belongs to `passed` alone. A run can
 * settle without any single step failing and still not have succeeded -- a machine
 * that stops reporting is reaped into `error`, and that run passed nothing.
 */
export function runOutcome(run: RunRow): string {
  const stopped = stoppedAt(run);
  if (stopped >= 0) return `Stopped on step ${stopped + 1} of ${run.steps}`;
  if (run.status === 'pending') return 'Waiting for your machine';
  if (run.status === 'running') return 'Running now';
  if (run.status === 'passed') return `All ${run.steps} steps passed`;
  if (run.steps === 0) return 'Stopped before the first step';
  return `Stopped after ${run.steps} step${run.steps === 1 ? '' : 's'}`;
}

/** The most recent run that broke on a given endpoint, when we have the report. */
export function failedRunForEndpoint(
  rows: RunRow[],
  method: string,
  path: string,
): RunRow | undefined {
  return rows.find((row) =>
    row.detail?.steps.some(
      (s) =>
        s.method === method && s.path === path && (s.status === 'failed' || s.status === 'error'),
    ),
  );
}

export function runCountsOf(
  rows: RunRow[],
): Record<'all' | 'failed' | 'passed' | 'running', number> {
  return {
    all: rows.length,
    failed: rows.filter((r) => r.status === 'failed' || r.status === 'error').length,
    passed: rows.filter((r) => r.status === 'passed').length,
    running: rows.filter((r) => r.status === 'running' || r.status === 'pending').length,
  };
}

export function matchesStatus(row: RunRow, filter: string): boolean {
  if (filter === 'failed') return row.status === 'failed' || row.status === 'error';
  if (filter === 'passed') return row.status === 'passed';
  if (filter === 'running') return row.status === 'running' || row.status === 'pending';
  return true;
}

export function isSettled(status: ExecutionStatus) {
  return status !== 'running' && status !== 'pending';
}
