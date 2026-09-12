import { asc, eq } from 'drizzle-orm';
import { db, sql as raw } from '@/lib/db';
import { codebaseIndex } from '@/lib/db/schema';
import { proofsOf } from '@/lib/db/endpoint-checks';
import type { CoverageFile, CoverageState, EndpointCoverage } from '@/lib/model';
import type { Method } from '@/components/ui/method-badge';

/**
 * Coverage: the endpoints a project has, and what testing says about each one.
 *
 * `state` is not stored anywhere, and should not be -- it is a reading of four
 * other tables, and a stored copy would be a fifth thing to keep in step. The
 * endpoints come from `codebase_index`, which the CLI writes when it indexes;
 * the verdicts come from the plans that claim each endpoint, the runs that
 * exercised it, and the proofs that probed whether it exists at all.
 *
 * Precedence is invalid, then failing, then approved, then tested, then draft.
 * Invalid outranks failing because a failure is a statement about code that
 * exists and a contradiction is a statement that it does not -- fixing the plan
 * comes before fixing the code. Tested sits below approved on purpose: it means
 * proven real but covered by no approved plan, which is the gap to close, not a
 * rank above intent that already closed it. An endpoint only archived plans
 * touch counts as uncovered: archived plans never run, so they are not evidence
 * of anything.
 */
type EndpointJson = { method: string; path: string };

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

/**
 * Newest settled verdict per endpoint, pass or fail alike. "Most recent" and
 * "settled" are both doing work here. Reading every result would mean an
 * endpoint that broke once in June stays red through six weeks of passing
 * runs, which is a memory of a bug rather than a report on the code. And a
 * `skipped` step is not evidence either way -- it says an earlier step aborted
 * the run, not anything about this endpoint -- so the newest pass or failure
 * wins, looking past however many skips sit on top of it.
 *
 * Failing reads the failures off this; invalid reads the passes, so a
 * contradiction cannot outlive the run that disproved it.
 *
 * Which is also what keeps the grid HTTP-only. Both columns are null for a sql
 * or shell step, so those rows are not here, and that is a limit worth naming:
 * a plan whose real verification is a query leaves this endpoint's square green
 * off the 201 it got, even on a run the query failed. The run report says so;
 * the grid does not. Linking a query to the endpoint it proves is a feature, and
 * it is not this one -- inventing a square for a SELECT would be worse.
 */
async function settledVerdicts(
  projectId: number,
): Promise<Map<string, { status: string; at: Date }>> {
  const rows = (await raw`
    SELECT DISTINCT ON (r.request_method, r.route_pattern)
      r.request_method AS method,
      r.route_pattern AS path,
      r.status AS status,
      e.started_at AS at
    FROM test_results r
    JOIN test_executions e ON e.id = r.execution_id
    WHERE e.project_id = ${projectId}
      AND r.route_pattern IS NOT NULL
      AND r.request_method IS NOT NULL
      AND r.status IN ('passed', 'failed', 'error')
    ORDER BY r.request_method, r.route_pattern, e.started_at DESC, r.id DESC
  `) as unknown as { method: string; path: string; status: string; at: Date }[];

  const out = new Map<string, { status: string; at: Date }>();
  for (const row of rows) out.set(`${row.method} ${row.path}`, { status: row.status, at: row.at });
  return out;
}

export async function listCoverage(projectId: number): Promise<CoverageFile[]> {
  const [files, settled, claimed, proofs] = await Promise.all([
    db
      .select({ filePath: codebaseIndex.filePath, endpoints: codebaseIndex.endpoints })
      .from(codebaseIndex)
      .where(eq(codebaseIndex.projectId, projectId))
      .orderBy(asc(codebaseIndex.filePath)),
    settledVerdicts(projectId),
    claimedEndpoints(projectId),
    proofsOf(projectId),
  ]);

  const approved = claimed.get('approved') ?? new Set<string>();
  const draft = claimed.get('draft') ?? new Set<string>();

  const failing = new Set<string>();
  const passedSince = new Map<string, Date>();
  for (const [sig, v] of settled) {
    if (v.status === 'passed') passedSince.set(sig, v.at);
    else failing.add(sig);
  }

  const stateOf = (signature: string): CoverageState => {
    const proof = proofs.get(signature);
    // A contradiction stands until a run disproves it with a pass newer than
    // the probe. The probe alone never gets the last word over traffic.
    if (proof?.verdict === 'fake') {
      const passedAt = passedSince.get(signature);
      if (!passedAt || passedAt <= proof.checkedAt) return 'invalid';
    }
    if (failing.has(signature)) return 'failing';
    if (approved.has(signature)) return 'approved';
    if (proof?.verdict === 'real') return 'tested';
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
