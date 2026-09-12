import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { endpointChecks } from '@/lib/db/schema';

export type ProofVerdict = 'real' | 'fake';
export type ProofSource = 'trial' | 'recheck';

export type EndpointProof = {
  verdict: ProofVerdict;
  statusCode: number | null;
  source: ProofSource;
  note: string | null;
  checkedAt: Date;
};

/**
 * Record what a probe saw. Null status writes nothing — no connection is not
 * evidence either way, and a row claiming an endpoint is fake because the
 * sandbox was down would be a lie the grid then renders as fact.
 *
 * The verdict mapping lives here, not in the caller, so every source agrees:
 * 404/501 mean nothing lives there; anything else — including 401s, 422s and
 * 500s — proves a handler ran. One row per endpoint, overwritten, never piled.
 */
export async function recordCheck(
  projectId: number,
  check: {
    method: string;
    path: string;
    statusCode: number | null;
    source: ProofSource;
    note?: string | null;
  },
): Promise<ProofVerdict | null> {
  if (check.statusCode === null) return null;
  const verdict: ProofVerdict = check.statusCode === 404 || check.statusCode === 501 ? 'fake' : 'real';

  await db
    .insert(endpointChecks)
    .values({
      projectId,
      method: check.method.slice(0, 16),
      path: check.path,
      verdict,
      statusCode: check.statusCode,
      source: check.source,
      note: check.note?.slice(0, 500) ?? null,
      checkedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [endpointChecks.projectId, endpointChecks.method, endpointChecks.path],
      set: {
        verdict,
        statusCode: check.statusCode,
        source: check.source,
        note: check.note?.slice(0, 500) ?? null,
        checkedAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    });
  return verdict;
}

/** Latest proof per endpoint, keyed `METHOD path`. */
export async function proofsOf(projectId: number): Promise<Map<string, EndpointProof>> {
  const rows = await db
    .select({
      method: endpointChecks.method,
      path: endpointChecks.path,
      verdict: endpointChecks.verdict,
      statusCode: endpointChecks.statusCode,
      source: endpointChecks.source,
      note: endpointChecks.note,
      checkedAt: endpointChecks.checkedAt,
    })
    .from(endpointChecks)
    .where(eq(endpointChecks.projectId, projectId));

  const out = new Map<string, EndpointProof>();
  for (const row of rows) {
    out.set(`${row.method} ${row.path}`, {
      verdict: row.verdict as ProofVerdict,
      statusCode: row.statusCode,
      source: row.source as ProofSource,
      note: row.note,
      checkedAt: row.checkedAt,
    });
  }
  return out;
}

/** Delete one endpoint's proof, for the delete-invalid flow. Nothing else. */
export async function deleteProof(projectId: number, method: string, path: string): Promise<void> {
  await db
    .delete(endpointChecks)
    .where(
      and(
        eq(endpointChecks.projectId, projectId),
        eq(endpointChecks.method, method),
        eq(endpointChecks.path, path),
      ),
    );
}
