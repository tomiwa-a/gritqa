import { sql as raw } from '@/lib/db';
import { asDate } from '@/lib/db/when';
import type { ObservedCall, ObservedRoute } from '@/lib/model';
import type { Method } from '@/components/ui/method-badge';

/**
 * What this project's endpoints actually send and answer, read off the runs.
 *
 * The honest answer to "does GritQA know an endpoint's request and response shape" is
 * *only where a run has made that call*. The index records where a route is
 * registered and nothing about its payload; an OpenAPI document is read for endpoints
 * and then discarded. But every step a run executes is stored with the body it sent,
 * the status it got and the body that came back -- so the contract exists as evidence
 * rather than as a declaration, and these two functions are the read nobody had
 * written.
 *
 * Both are `DISTINCT ON` over the newest call, which has no builder form in this
 * version of Drizzle and would otherwise mean reading every result to keep one.
 */

/** A body long enough to read the shape off, short enough not to ship a page of JSON. */
const BODY_CAP = 6_000;

/** More than any project's endpoint list is worth scrolling; the list is searchable. */
const ROUTE_CAP = 400;

type RouteRow = {
  method: string;
  path: string;
  url: string;
  status: number | null;
  calls: string | number;
  last_run_at: Date | string | null;
};

/**
 * Every route this project has really called, newest call first.
 *
 * Deliberately bodiless. The list is what a picker renders, one row per endpoint, and
 * carrying two JSON documents per row would send a megabyte to draw forty lines. The
 * bodies come from `observedCall` when somebody points at one.
 *
 * A row is here only if the call reached the API and came back with a status. A step
 * that errored before it sent anything is a fact about the machine, not about the
 * endpoint, and `route_pattern IS NOT NULL` is also what keeps this HTTP-only: both
 * columns are null for a sql or shell step.
 */
export async function observedRoutes(projectId: number): Promise<ObservedRoute[]> {
  const rows = (await raw`
    SELECT DISTINCT ON (r.request_method, r.route_pattern)
      r.request_method AS method,
      r.route_pattern AS path,
      r.request_url AS url,
      r.response_status AS status,
      count(*) OVER (PARTITION BY r.request_method, r.route_pattern) AS calls,
      e.started_at AS last_run_at
    FROM test_results r
    JOIN test_executions e ON e.id = r.execution_id
    WHERE e.project_id = ${projectId}
      AND r.route_pattern IS NOT NULL
      AND r.request_method IS NOT NULL
      AND r.response_status IS NOT NULL
    ORDER BY r.request_method, r.route_pattern, e.started_at DESC, r.id DESC
    LIMIT ${ROUTE_CAP}
  `) as unknown as RouteRow[];

  return rows.map((row) => ({
    method: row.method as Method,
    path: row.path,
    url: row.url,
    status: row.status,
    calls: Number(row.calls),
    lastRunAt: row.last_run_at ? asDate(row.last_run_at) : null,
  }));
}

type CallRow = RouteRow & {
  request: string | null;
  response: string | null;
  request_len: string | number | null;
  response_len: string | number | null;
};

/**
 * The newest call to one route, with both bodies.
 *
 * Cast to text and clipped in the query rather than after it, so a step that came
 * back with a 200 KB list does not cross the wire to be thrown away here. The
 * pretty-printing happens on whatever survives the cap, and fails soft: a body cut
 * mid-object is still the fastest way to see what fields an endpoint returns, which
 * is what somebody writing a check is looking for.
 */
export async function observedCall(
  projectId: number,
  method: string,
  path: string,
): Promise<ObservedCall | null> {
  const rows = (await raw`
    SELECT
      r.request_method AS method,
      r.route_pattern AS path,
      r.request_url AS url,
      r.response_status AS status,
      1 AS calls,
      e.started_at AS last_run_at,
      left(r.request_body::text, ${BODY_CAP}) AS request,
      left(r.response_body::text, ${BODY_CAP}) AS response,
      length(r.request_body::text) AS request_len,
      length(r.response_body::text) AS response_len
    FROM test_results r
    JOIN test_executions e ON e.id = r.execution_id
    WHERE e.project_id = ${projectId}
      AND r.request_method = ${method}
      AND r.route_pattern = ${path}
      AND r.response_status IS NOT NULL
    ORDER BY e.started_at DESC, r.id DESC
    LIMIT 1
  `) as unknown as CallRow[];

  const row = rows[0];
  if (!row) return null;

  const clipped =
    Number(row.request_len ?? 0) > BODY_CAP || Number(row.response_len ?? 0) > BODY_CAP;

  return {
    method: row.method as Method,
    path: row.path,
    url: row.url,
    status: row.status,
    calls: 1,
    lastRunAt: row.last_run_at ? asDate(row.last_run_at) : null,
    request: pretty(row.request),
    response: pretty(row.response),
    clipped,
  };
}

/** Readable when it parses, as stored when it does not -- a clipped body never will. */
function pretty(text: string | null): string | null {
  if (!text) return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
