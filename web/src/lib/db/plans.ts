import { and, asc, desc, eq } from 'drizzle-orm';
import { db, sql as raw } from '@/lib/db';
import { planRevisions, testPlans } from '@/lib/db/schema';
import { agoLabel } from '@/lib/when';
import { asDate } from '@/lib/db/when';
import type { PlanRevisionRow, TestPlanRow } from '@/lib/db/schema';
import type {
  Endpoint,
  FailureVerdict,
  PlanChange,
  PlanDiffContext,
  PlanFailureSeed,
  PlanRevision,
  PlanStepSpec,
  TestPlan,
  TestPlanDetail,
} from '@/lib/mock/types';

/**
 * Plans, read back as the shape the screens were designed against.
 *
 * Three of the numbers the mock declared per plan are derived here instead:
 * `stepCount`, `assertionCount` and `covers` all come out of `plan_json`, so a plan
 * cannot claim six steps and render five. That was not a hypothetical -- the mock
 * declared counts for plans whose steps did not exist anywhere.
 *
 * The one figure that still needs a query is `lastRun`, and it needs the newest
 * execution per plan with a tally of its steps. `DISTINCT ON` and `count(... )
 * FILTER` have no builder equivalent in this version of Drizzle, and the
 * alternative -- reading every execution to find nine of them -- is the wrong query
 * on a project that has been running tests for a year. So those two are written out.
 */
type PlanJson = {
  variables?: Record<string, string>;
  covers?: Endpoint[];
  steps?: PlanStepSpec[];
};

const planJsonOf = (row: TestPlanRow): PlanJson => (row.planJson ?? {}) as PlanJson;
const stepsOf = (row: TestPlanRow): PlanStepSpec[] => planJsonOf(row).steps ?? [];

/**
 * A run against older text says so, and one against the current text does not.
 * That prefix is the whole reason `test_executions.plan_version` exists: without
 * it every result is silently attributed to the plan as it reads today.
 */
function lastRunLabel(startedAt: Date, runVersion: number, planVersion: number): string {
  const ago = agoLabel(startedAt);
  return runVersion < planVersion ? `v${runVersion}, ${ago.toLowerCase()}` : ago;
}

type LastRun = NonNullable<TestPlan['lastRun']>;

/** The tally plus the two facts the label needs, before the plan supplies its own. */
type LastRunSeed = Omit<LastRun, 'label'> & { planVersion: number; startedAt: Date };

type LastRunRow = {
  test_plan_id: string;
  status: LastRun['status'];
  plan_version: number;
  started_at: Date | string;
  total: string;
  passed: string;
};

/** The newest execution of every plan in the project, with its step tally. */
async function lastRuns(projectId: number): Promise<Map<string, LastRunSeed>> {
  const rows = (await raw`
    SELECT DISTINCT ON (e.test_plan_id)
      e.test_plan_id, e.status, e.plan_version, e.started_at,
      (SELECT count(*) FROM test_results r WHERE r.execution_id = e.id) AS total,
      (SELECT count(*) FROM test_results r
        WHERE r.execution_id = e.id AND r.status = 'passed') AS passed
    FROM test_executions e
    WHERE e.project_id = ${projectId}
    ORDER BY e.test_plan_id, e.started_at DESC
  `) as unknown as LastRunRow[];

  return new Map(
    rows.map((row) => [
      String(row.test_plan_id),
      {
        status: row.status,
        passed: Number(row.passed),
        total: Number(row.total),
        planVersion: row.plan_version,
        startedAt: asDate(row.started_at),
      },
    ]),
  );
}

type FailureRow = {
  test_plan_id: string;
  plan_version: number;
  started_at: Date | string;
  step_id: string;
  assertion_results: { target?: string; expected?: string; actual?: string }[] | null;
  verdict: FailureVerdict | null;
};

/**
 * The failure a reviewer is being asked to judge: the newest failed run of the plan
 * at a version older than the one on screen.
 *
 * Older is the point. A failure against the current text is just the plan's current
 * state and the run report shows it; a failure against text that has since been
 * revised is the question "did the redraft fix this?", which is what the detail page
 * puts in front of a person.
 */
async function previousFailures(projectId: number): Promise<Map<string, FailureRow>> {
  const rows = (await raw`
    SELECT DISTINCT ON (e.test_plan_id)
      e.test_plan_id, e.plan_version, e.started_at, r.step_id, r.assertion_results, r.verdict
    FROM test_executions e
    JOIN test_plans p ON p.id = e.test_plan_id
    JOIN test_results r ON r.execution_id = e.id AND r.status IN ('failed', 'error')
    WHERE e.project_id = ${projectId}
      AND e.status = 'failed'
      AND e.plan_version < p.version
    ORDER BY e.test_plan_id, e.started_at DESC, r.id ASC
  `) as unknown as FailureRow[];

  return new Map(rows.map((row) => [String(row.test_plan_id), row]));
}

function toFailureSeed(row: FailureRow): PlanFailureSeed | null {
  const assertion = row.assertion_results?.[0];
  if (!assertion) return null;
  const observed = asDate(row.started_at);
  return {
    version: row.plan_version,
    stepId: row.step_id,
    whenLabel: agoLabel(observed),
    observedAt: observed.toISOString(),
    expected: assertion.expected ?? '',
    actual: assertion.actual ?? '',
    verdict: row.verdict ?? 'undecided',
  };
}

/**
 * `createdLabel` reads `updated_at`, not `created_at`, and the difference is
 * deliberate: a plan drafted a week ago and redrafted this morning belongs at the
 * top of a review queue. For a plan that was never revised the two are the same
 * timestamp, which is why the distinction went unnoticed while everything was mock.
 */
function toTestPlan(row: TestPlanRow, lastRun: LastRunSeed | undefined): TestPlan {
  const steps = stepsOf(row);
  return {
    publicId: row.publicId,
    name: row.name,
    description: row.description ?? '',
    status: row.status,
    version: row.version,
    triggerSource: row.triggerSource,
    createdLabel: agoLabel(row.updatedAt),
    createdAt: row.updatedAt.toISOString(),
    stepCount: steps.length,
    assertionCount: steps.reduce((n, step) => n + step.assertions.length, 0),
    covers: planJsonOf(row).covers ?? [],
    lastRun: lastRun
      ? {
          status: lastRun.status,
          passed: lastRun.passed,
          total: lastRun.total,
          label: lastRunLabel(lastRun.startedAt, lastRun.planVersion, row.version),
        }
      : null,
  };
}

/** `agent` and `human` in the column; `ai` and `you` on screen. */
function toRevision(row: PlanRevisionRow): PlanRevision {
  return {
    version: row.version,
    whenLabel: agoLabel(row.createdAt),
    createdAt: row.createdAt.toISOString(),
    author: row.author === 'human' ? 'you' : 'ai',
    ...(row.instruction ? { instruction: row.instruction } : {}),
    summary: row.summary,
    changes: (row.changes ?? []) as PlanChange[],
  };
}

function toDetail(
  row: TestPlanRow,
  lastRun: Parameters<typeof toTestPlan>[1],
  revisions: PlanRevisionRow[],
  failure: FailureRow | undefined,
): TestPlanDetail {
  const json = planJsonOf(row);
  return {
    ...toTestPlan(row, lastRun),
    baseUrl: row.baseUrl,
    variables: json.variables ?? {},
    steps: json.steps ?? [],
    diffContext: (row.diffContext as PlanDiffContext | null) ?? null,
    previousFailure: failure ? toFailureSeed(failure) : null,
    // Oldest first. The detail page reads a version's predecessor as the entry
    // before it, and the conversation replays them in the order they happened.
    revisions: revisions.map(toRevision),
  };
}

export async function listPlans(projectId: number): Promise<TestPlan[]> {
  const [rows, runs] = await Promise.all([
    db
      .select()
      .from(testPlans)
      .where(eq(testPlans.projectId, projectId))
      .orderBy(desc(testPlans.updatedAt)),
    lastRuns(projectId),
  ]);
  return rows.map((row) => toTestPlan(row, runs.get(String(row.id))));
}

export async function listPlanDetails(projectId: number): Promise<TestPlanDetail[]> {
  const [rows, runs, failures] = await Promise.all([
    db
      .select()
      .from(testPlans)
      .where(eq(testPlans.projectId, projectId))
      .orderBy(desc(testPlans.updatedAt)),
    lastRuns(projectId),
    previousFailures(projectId),
  ]);

  // One query for every revision in the project rather than one per plan: the
  // detail list is read whole by the pages that use it at all.
  const revisions = await db
    .select()
    .from(planRevisions)
    .orderBy(asc(planRevisions.testPlanId), asc(planRevisions.version));
  const byPlan = new Map<string, PlanRevisionRow[]>();
  for (const revision of revisions) {
    const key = String(revision.testPlanId);
    const list = byPlan.get(key);
    if (list) list.push(revision);
    else byPlan.set(key, [revision]);
  }

  return rows.map((row) =>
    toDetail(
      row,
      runs.get(String(row.id)),
      byPlan.get(String(row.id)) ?? [],
      failures.get(String(row.id)),
    ),
  );
}

/** Undefined only for an id that is not a plan of this project. */
export async function planDetail(
  projectId: number,
  publicId: string,
): Promise<TestPlanDetail | undefined> {
  const [row] = await db
    .select()
    .from(testPlans)
    .where(and(eq(testPlans.projectId, projectId), eq(testPlans.publicId, publicId)))
    .limit(1);
  if (!row) return undefined;

  const [revisions, runs, failures] = await Promise.all([
    db
      .select()
      .from(planRevisions)
      .where(eq(planRevisions.testPlanId, row.id))
      .orderBy(asc(planRevisions.version)),
    lastRuns(projectId),
    previousFailures(projectId),
  ]);

  return toDetail(row, runs.get(String(row.id)), revisions, failures.get(String(row.id)));
}

export type PlanPassRate = {
  planPublicId: string;
  name: string;
  series: number;
  rate: number;
  runs: number;
  direction: 'up' | 'down' | 'flat';
  delta: string;
};

type RateRow = {
  public_id: string;
  name: string;
  runs: string;
  cells: string;
  passed: string;
  recent_cells: string;
  recent_passed: string;
};

/**
 * Pass rate per plan, over settled runs.
 *
 * A rate counts steps, not runs, because that is what the sparkline beside it
 * draws: a five-step plan that aborts on step four has three good steps in it, and
 * scoring the whole run zero would hide the difference between that and a plan that
 * fails at step one. Unsettled runs are excluded -- a run still going has not
 * passed or failed yet, and folding its pending steps into a percentage would make
 * a plan look worse for being mid-flight.
 *
 * `direction` compares the newest third against everything older. It is a trend,
 * not a promise, and a plan whose recent runs are indistinguishable from its old
 * ones reads `flat` rather than being nudged one way.
 *
 * A plan needs `minRuns` behind it to be ranked at all. One clean run is 100% and
 * would sit above a plan with forty-four, which is not a reading anyone wants from a
 * reliability list -- it is the absence of evidence sorted to the top.
 */
export async function planPassRates(
  projectId: number,
  limit = 5,
  minRuns = 5,
): Promise<PlanPassRate[]> {
  const rows = (await raw`
    WITH settled AS (
      SELECT e.id, e.test_plan_id, e.started_at,
             row_number() OVER (PARTITION BY e.test_plan_id ORDER BY e.started_at DESC) AS recency,
             count(*) OVER (PARTITION BY e.test_plan_id) AS run_count
      FROM test_executions e
      WHERE e.project_id = ${projectId} AND e.status IN ('passed', 'failed')
    )
    SELECT p.public_id, p.name,
           max(s.run_count)::text AS runs,
           count(r.id)::text AS cells,
           count(r.id) FILTER (WHERE r.status = 'passed')::text AS passed,
           count(r.id) FILTER (WHERE s.recency * 3 <= s.run_count)::text AS recent_cells,
           count(r.id) FILTER (
             WHERE s.recency * 3 <= s.run_count AND r.status = 'passed'
           )::text AS recent_passed
    FROM settled s
    JOIN test_plans p ON p.id = s.test_plan_id
    JOIN test_results r ON r.execution_id = s.id
    GROUP BY p.public_id, p.name
    HAVING max(s.run_count) >= ${minRuns}
    ORDER BY count(r.id) FILTER (WHERE r.status = 'passed')::numeric / count(r.id) DESC
    LIMIT ${limit}
  `) as unknown as RateRow[];

  return rows.map((row, index) => {
    const cells = Number(row.cells);
    const rate = Math.round((Number(row.passed) * 100) / cells);

    const recentCells = Number(row.recent_cells);
    const olderCells = cells - recentCells;
    const recent = recentCells ? (Number(row.recent_passed) * 100) / recentCells : rate;
    const older = olderCells
      ? ((Number(row.passed) - Number(row.recent_passed)) * 100) / olderCells
      : rate;
    const shift = Math.round(recent - older);

    return {
      planPublicId: row.public_id,
      name: row.name,
      series: index + 1,
      rate,
      runs: Number(row.runs),
      direction: shift > 0 ? 'up' : shift < 0 ? 'down' : 'flat',
      delta: shift > 0 ? `+${shift}` : String(shift),
    };
  });
}
