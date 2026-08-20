import { asc, eq } from 'drizzle-orm';
import { db, sql as raw } from '@/lib/db';
import { codebaseIndex } from '@/lib/db/schema';
import type { CoverageFile, CoverageState, EndpointCoverage } from '@/lib/mock/types';
import type { Method } from '@/components/ui/method-badge';

/**
 * Coverage: the endpoints a project has, and what testing says about each one.
 *
 * `state` is not stored anywhere, and should not be -- it is a reading of three
 * other tables, and a stored copy would be a fourth thing to keep in step. The
 * endpoints come from `codebase_index`, which the CLI writes when it indexes; the
 * verdicts come from the plans that claim each endpoint and the runs that exercised
 * it. So a square goes red because a run failed, not because anyone marked it.
 *
 * Precedence is failing, then approved, then draft. A failure outranks an approval
 * because the approval is a statement about the plan and the failure is a statement
 * about the code. An endpoint only archived plans touch counts as uncovered:
 * archived plans never run, so they are not evidence of anything.
 */
type EndpointJson = { method: string; path: string };

/**
 * Which endpoints are failing, judged by their most recent settled result.
 *
 * "Most recent" and "settled" are both doing work here. Reading every result would
 * mean an endpoint that broke once in June stays red through six weeks of passing
 * runs, which is a memory of a bug rather than a report on the code. And a `skipped`
 * step is not evidence either way -- it says an earlier step aborted the run, not
 * anything about this endpoint -- so the newest pass or failure wins, looking past
 * however many skips sit on top of it.
 */
async function failingEndpoints(projectId: number): Promise<Set<string>> {
  const rows = (await raw`
    SELECT DISTINCT ON (r.request_method, r.route_pattern)
      r.request_method AS method,
      r.route_pattern AS path,
      r.status
    FROM test_results r
    JOIN test_executions e ON e.id = r.execution_id
    WHERE e.project_id = ${projectId}
      AND r.route_pattern IS NOT NULL
      AND r.request_method IS NOT NULL
      AND r.status IN ('passed', 'failed', 'error')
    ORDER BY r.request_method, r.route_pattern, e.started_at DESC, r.id DESC
  `) as unknown as { method: string; path: string; status: string }[];

  return new Set(
    rows.filter((row) => row.status !== 'passed').map((row) => `${row.method} ${row.path}`),
  );
}

/** The endpoints each plan status claims, so a square can say who claimed it. */
async function claimedEndpoints(projectId: number): Promise<Map<string, Set<string>>> {
  const rows = (await raw`
    SELECT p.status, c->>'method' AS method, c->>'path' AS path
    FROM test_plans p, jsonb_array_elements(p.plan_json->'covers') c
    WHERE p.project_id = ${projectId} AND p.status IN ('approved', 'draft')
  `) as unknown as { status: string; method: string; path: string }[];

  const byStatus = new Map<string, Set<string>>([
    ['approved', new Set()],
    ['draft', new Set()],
  ]);
  for (const row of rows) byStatus.get(row.status)?.add(`${row.method} ${row.path}`);
  return byStatus;
}

export async function listCoverage(projectId: number): Promise<CoverageFile[]> {
  const [files, failing, claimed] = await Promise.all([
    db
      .select({ filePath: codebaseIndex.filePath, endpoints: codebaseIndex.endpoints })
      .from(codebaseIndex)
      .where(eq(codebaseIndex.projectId, projectId))
      .orderBy(asc(codebaseIndex.filePath)),
    failingEndpoints(projectId),
    claimedEndpoints(projectId),
  ]);

  const approved = claimed.get('approved') ?? new Set<string>();
  const draft = claimed.get('draft') ?? new Set<string>();

  const stateOf = (signature: string): CoverageState => {
    if (failing.has(signature)) return 'failing';
    if (approved.has(signature)) return 'approved';
    if (draft.has(signature)) return 'draft';
    return 'none';
  };

  // A file with no routes is still indexed -- reach passes through it -- but it has
  // nothing to draw, and an empty row in the grid reads as a file with no coverage
  // rather than a file with no endpoints.
  return files
    .map((file) => ({
      file: file.filePath,
      endpoints: ((file.endpoints ?? []) as EndpointJson[]).map((endpoint): EndpointCoverage => ({
        method: endpoint.method as Method,
        path: endpoint.path,
        state: stateOf(`${endpoint.method} ${endpoint.path}`),
      })),
    }))
    .filter((file) => file.endpoints.length > 0);
}
