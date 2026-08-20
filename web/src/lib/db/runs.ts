import { asc, desc, eq, inArray } from 'drizzle-orm';
import { db, sql as raw } from '@/lib/db';
import { testExecutions, testPlans, testResults } from '@/lib/db/schema';
import { agoLabel } from '@/lib/when';
import { asDate } from '@/lib/db/when';
import type { Method } from '@/components/ui/method-badge';
import type { RunHistoryEntry, StepResult, TestExecution } from '@/lib/model';

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
  started_at: Date | string;
  cells: string | null;
};

/**
 * The window, oldest last.
 *
 * Returned oldest-first because `src/lib/runs.ts` reverses it, and that module is
 * pure derivation shared by four screens -- changing its input order to save a
 * reverse here would move the surprise somewhere harder to see.
 */
export async function executionHistory(
  projectId: number,
  limit = HISTORY_LIMIT,
): Promise<RunHistoryEntry[]> {
  const rows = (await raw`
    SELECT e.public_id, p.public_id AS plan_public_id, p.name AS plan_name, e.status,
           e.started_at,
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
    ORDER BY e.started_at DESC
    LIMIT ${limit}
  `) as unknown as HistoryRow[];

  return rows
    .map((row) => {
      const startedAt = asDate(row.started_at);
      return {
        publicId: row.public_id,
        planPublicId: row.plan_public_id,
        planName: row.plan_name,
        status: row.status,
        cells: row.cells ?? '',
        whenLabel: agoLabel(startedAt),
        startedAt: startedAt.toISOString(),
      };
    })
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
      planPublicId: testPlans.publicId,
      planName: testPlans.name,
    })
    .from(testExecutions)
    .innerJoin(testPlans, eq(testPlans.id, testExecutions.testPlanId))
    .where(eq(testExecutions.projectId, projectId))
    .orderBy(desc(testExecutions.startedAt))
    .limit(limit);

  if (!rows.length) return [];

  const steps = await db
    .select({
      executionId: testResults.executionId,
      stepName: testResults.stepName,
      status: testResults.status,
      method: testResults.requestMethod,
      routePattern: testResults.routePattern,
      responseStatus: testResults.responseStatus,
      responseTimeMs: testResults.responseTimeMs,
    })
    .from(testResults)
    .where(
      inArray(
        testResults.executionId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(testResults.executionId), asc(testResults.id));

  const byExecution = new Map<string, StepResult[]>();
  for (const step of steps) {
    const key = String(step.executionId);
    const entry: StepResult = {
      stepName: step.stepName,
      status: step.status,
      // Both columns are nullable and neither is ever written null: the method and
      // the endpoint come off the plan, so the runner knows them before it makes the
      // call. The defaults are for rows written before the column existed.
      method: (step.method ?? 'GET') as Method,
      path: step.routePattern ?? '',
      responseStatus: step.responseStatus,
      responseTimeMs: step.responseTimeMs,
    };
    const list = byExecution.get(key);
    if (list) list.push(entry);
    else byExecution.set(key, [entry]);
  }

  return rows.map((row) => ({
    publicId: row.publicId,
    planPublicId: row.planPublicId,
    planName: row.planName,
    status: row.status,
    durationMs: row.durationMs,
    startedLabel: agoLabel(row.startedAt ?? new Date()),
    startedAt: (row.startedAt ?? new Date()).toISOString(),
    steps: byExecution.get(String(row.id)) ?? [],
  }));
}

export type RunStripStats = {
  total: number;
  runs: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: string;
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
    passRate: total ? ((passed / total) * 100).toFixed(1) : '0.0',
  };
}
