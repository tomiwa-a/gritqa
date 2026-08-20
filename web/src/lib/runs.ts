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
