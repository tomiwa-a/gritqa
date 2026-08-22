import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, sql as raw } from '@/lib/db';
import { executionState, testExecutions, testPlans, testResults } from '@/lib/db/schema';
import { agoLabel } from '@/lib/when';
import { asDate } from '@/lib/db/when';
import type { Method } from '@/components/ui/method-badge';
import type {
  AssertionResult,
  MovedUnit,
  RunHistoryEntry,
  StepResult,
  TestExecution,
} from '@/lib/model';

/**
 * Executions, at the two levels of detail the screens ask for.
 *
 * The mock kept these apart as `recentRuns` and `runHistory`, and the split looked
 * like a data model but was an authoring limit: six runs had been written out
 * step by step and the rest had not. Every row has its steps, so the split is now
 * only about how much to read -- the strip needs one character per step, the run
 * report needs the request behind each one, and fetching the second to draw the
 * first would be pulling several hundred rows to render thirty columns.
 */

/**
 * How much history the strip shows. The legend underneath it counts the same cells,
 * which is the reason this is one constant rather than two defaults: a legend that
 * totals a wider window than the strip draws is counting squares nobody can see.
 */
export const HISTORY_LIMIT = 30;

type HistoryRow = {
  public_id: string;
  plan_public_id: string;
  plan_name: string;
  status: RunHistoryEntry['status'];
  started_at: Date | string | null;
  /** `coalesce(started_at, created_at)` -- see `at` in the query below. */
  at: Date | string;
  error_message: string | null;
  cells: string | null;
};

/**
 * The window, oldest last.
 *
 * Returned oldest-first because `src/lib/runs.ts` reverses it, and that module is
 * pure derivation shared by four screens -- changing its input order to save a
 * reverse here would move the surprise somewhere harder to see.
 *
 * Ordered by `coalesce(started_at, created_at)` rather than by the start alone,
 * because a queued run has not started and would otherwise sort by a NULL --
 * which in Postgres is NULLS FIRST on a DESC, so the answer would have been right
 * by accident today and wrong the moment a second queued run appeared. The
 * coalesce says what was meant: order runs by when they happened, and a run that
 * has not started yet happened when it was asked for.
 */
export async function executionHistory(
  projectId: number,
  limit = HISTORY_LIMIT,
): Promise<RunHistoryEntry[]> {
  const rows = (await raw`
    SELECT e.public_id, p.public_id AS plan_public_id, p.name AS plan_name, e.status,
           e.started_at, coalesce(e.started_at, e.created_at) AS at, e.error_message,
           (
             SELECT string_agg(
               CASE r.status
                 WHEN 'passed' THEN 'p'
                 WHEN 'failed' THEN 'f'
                 WHEN 'error' THEN 'f'
                 ELSE 's'
               END, '' ORDER BY r.id
             )
             FROM test_results r WHERE r.execution_id = e.id
           ) AS cells
    FROM test_executions e
    JOIN test_plans p ON p.id = e.test_plan_id
    WHERE e.project_id = ${projectId}
    ORDER BY coalesce(e.started_at, e.created_at) DESC
    LIMIT ${limit}
  `) as unknown as HistoryRow[];

  return rows
    .map((row) => ({
      publicId: row.public_id,
      planPublicId: row.plan_public_id,
      planName: row.plan_name,
      status: row.status,
      // Empty for a queued run, which has no steps yet. The strip draws nothing
      // and the legend counts nothing, which is the truth about it.
      cells: row.cells ?? '',
      // The only thing a reaped run has to say for itself, so it travels with the
      // window rather than with the report a run that never started does not have.
      errorMessage: row.error_message,
      whenLabel: agoLabel(asDate(row.at)),
      startedAt: row.started_at ? asDate(row.started_at).toISOString() : null,
    }))
    .reverse();
}

/**
 * A step reports the endpoint it named, not the URL it called.
 *
 * `request_url` holds the substituted URL -- `/checkout/ckt_44e2f8/tax` -- and that
 * is the right thing to store, because it is what happened. It is the wrong thing to
 * show: the report links each step to the endpoint page for what it exercised, and
 * coverage decides whether a square is failing by finding a failed step against that
 * endpoint. Both are keyed by pattern, and a substituted URL matches neither.
 *
 * So `route_pattern` is read instead, and a step that never ran still has one --
 * the plan named an endpoint whether or not the run reached it.
 */

/** The newest runs, with the request behind every step. */
export async function recentExecutions(projectId: number, limit = 6): Promise<TestExecution[]> {
  const rows = await db
    .select({
      id: testExecutions.id,
      publicId: testExecutions.publicId,
      status: testExecutions.status,
      durationMs: testExecutions.durationMs,
      startedAt: testExecutions.startedAt,
      // Both columns rather than a `coalesce` in the select: these two are real
      // columns, so the builder types them as Dates, and a raw expression here
      // would come back as an unknown needing `asDate`.
      createdAt: testExecutions.createdAt,
      stateNote: testExecutions.stateNote,
      planPublicId: testPlans.publicId,
      planName: testPlans.name,
    })
    .from(testExecutions)
    .innerJoin(testPlans, eq(testPlans.id, testExecutions.testPlanId))
    .where(eq(testExecutions.projectId, projectId))
    .orderBy(desc(sql`coalesce(${testExecutions.startedAt}, ${testExecutions.createdAt})`))
    .limit(limit);

  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);

  const steps = await db
    .select({
      id: testResults.id,
      executionId: testResults.executionId,
      stepName: testResults.stepName,
      status: testResults.status,
      kind: testResults.stepKind,
      method: testResults.requestMethod,
      routePattern: testResults.routePattern,
      requestUrl: testResults.requestUrl,
      responseStatus: testResults.responseStatus,
      rowCount: testResults.rowCount,
      exitCode: testResults.exitCode,
      output: testResults.output,
      responseTimeMs: testResults.responseTimeMs,
      errorMessage: testResults.errorMessage,
      // The three the ingest has always written and the report never read back.
      // Bounded on the way in -- 64KB per body, 16KB of output -- so selecting them
      // for the handful of runs this returns is a known cost, not an open one.
      requestBody: testResults.requestBody,
      responseBody: testResults.responseBody,
      assertions: testResults.assertionResults,
    })
    .from(testResults)
    .where(inArray(testResults.executionId, ids))
    .orderBy(asc(testResults.executionId), asc(testResults.id));

  const ledger = await db
    .select({
      executionId: executionState.executionId,
      testResultId: executionState.testResultId,
      unit: executionState.unit,
      rows: executionState.rowsMoved,
      from: executionState.fromValue,
      to: executionState.toValue,
    })
    .from(executionState)
    .where(inArray(executionState.executionId, ids))
    .orderBy(asc(executionState.executionId), asc(executionState.seq));

  /* One query, split two ways on arrival: a row with a step is that step's margin, a
     row without one is the run's own reading. They are read in different places and
     the second is not the sum of the first. */
  const stepMoved = new Map<number, MovedUnit[]>();
  const runMoved = new Map<string, MovedUnit[]>();
  for (const row of ledger) {
    const moved: MovedUnit = { unit: row.unit, rows: row.rows, from: row.from, to: row.to };
    if (row.testResultId === null) group(runMoved, String(row.executionId), moved);
    else group(stepMoved, row.testResultId, moved);
  }

  const byExecution = new Map<string, StepResult[]>();
  for (const step of steps) {
    const key = String(step.executionId);
    const entry: StepResult = {
      stepName: step.stepName,
      status: step.status,
      kind: step.kind,
      // Passed through as null rather than defaulted. Only an `http` step has a method
      // and an endpoint; a statement or a command has neither, and the old defaults
      // would have labelled every one of them `GET` with an empty path -- which the
      // report would then have linked to a dead endpoint panel. A request whose
      // pattern really is missing reads as missing too, which is the truth.
      method: step.kind === 'http' ? ((step.method ?? 'GET') as Method) : null,
      path: step.kind === 'http' ? (step.routePattern ?? '') : null,
      detail: step.requestUrl,
      responseStatus: step.responseStatus,
      rowCount: step.rowCount,
      exitCode: step.exitCode,
      output: step.output,
      responseTimeMs: step.responseTimeMs,
      errorMessage: step.errorMessage,
      responseBody: step.responseBody,
      requestBody: step.requestBody,
      assertions: checks(step.assertions),
      moved: stepMoved.get(step.id) ?? [],
    };
    group(byExecution, key, entry);
  }

  return rows.map((row) => ({
    publicId: row.publicId,
    planPublicId: row.planPublicId,
    planName: row.planName,
    status: row.status,
    durationMs: row.durationMs,
    startedLabel: agoLabel(row.startedAt ?? row.createdAt),
    startedAt: row.startedAt?.toISOString() ?? null,
    steps: byExecution.get(String(row.id)) ?? [],
    moved: runMoved.get(String(row.id)) ?? [],
    stateNote: row.stateNote,
  }));
}

/**
 * `assertion_results` is jsonb, so what comes back is whatever was written -- and one
 * CLI older than the column wrote nothing at all. Reading it defensively costs a loop
 * and means a malformed row renders as a step with no checks rather than throwing on
 * the whole run report.
 */
function checks(value: unknown): AssertionResult[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const check = entry as Record<string, unknown>;
    if (typeof check.type !== 'string') return [];
    return [
      {
        type: check.type,
        operator: typeof check.operator === 'string' ? check.operator : '',
        target: typeof check.target === 'string' ? check.target : null,
        expected: typeof check.expected === 'string' ? check.expected : null,
        actual: typeof check.actual === 'string' ? check.actual : null,
        passed: check.passed === true,
        found: check.found === true,
      },
    ];
  });
}

function group<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export type RunStripStats = {
  total: number;
  runs: number;
  passed: number;
  failed: number;
  skipped: number;
  /**
   * Null when nothing has run, which is not the fact that nothing passed. `'0.0'`
   * here rendered "0.0% of steps passed" in a pass-coloured badge on a project whose
   * first plan had not been approved yet -- a project with nothing wrong with it,
   * reported as total failure.
   */
  passRate: string | null;
};

/**
 * Derived from the strip's own cells rather than queried separately, so the two
 * cannot disagree. It is the same construction the mock used, for the same reason.
 */
export function stripStatsOf(history: RunHistoryEntry[]): RunStripStats {
  const cells = history.map((run) => run.cells).join('');
  const total = cells.length;
  const failed = [...cells].filter((c) => c === 'f').length;
  const skipped = [...cells].filter((c) => c === 's').length;
  const passed = total - failed - skipped;
  return {
    total,
    runs: history.length,
    passed,
    failed,
    skipped,
    passRate: total ? ((passed / total) * 100).toFixed(1) : null,
  };
}
