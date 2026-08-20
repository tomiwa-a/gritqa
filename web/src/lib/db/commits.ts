import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { commits, testPlans } from '@/lib/db/schema';
import { agoLabel } from '@/lib/when';
import type { Commit } from '@/lib/model';

/**
 * A project's history, newest first.
 *
 * The short hash is computed here rather than stored, which the table says outright:
 * a prefix of a sha is not a second fact about a commit. Seven characters is what git
 * shows and what the wizard puts in the URL, and `matchesCommit` accepts a prefix of
 * either form, so a longer one typed into the search still resolves.
 *
 * Ordered by `authored_at` and then by id, because two commits pushed in one batch can
 * share a second and a history that reorders itself between requests is worse than one
 * that picks arbitrarily but picks the same way twice.
 */
export async function listCommits(projectId: number): Promise<Commit[]> {
  const rows = await db
    .select()
    .from(commits)
    .where(eq(commits.projectId, projectId))
    .orderBy(desc(commits.authoredAt), desc(commits.id));

  return rows.map((row) => ({
    hash: row.sha,
    shortHash: row.sha.slice(0, 7),
    subject: row.subject,
    author: row.author,
    whenLabel: agoLabel(row.authoredAt),
    committedAt: row.authoredAt.toISOString(),
    branch: row.branch,
    files: row.files,
  }));
}

/**
 * Every commit this project has already been drafted from, as the short hashes the
 * plans actually hold.
 *
 * `diff_context.commit` is a prefix -- it is what the wizard put in the URL and what
 * the agent was handed -- so these are not shas and cannot be compared to the column
 * as equals. Resolving them against the history is the caller's job, because the
 * caller has the history already and the ordering lives there.
 *
 * A hash from before the history was indexed simply matches nothing, which is the
 * right outcome: the range cannot start after a commit the project has no record of.
 */
export async function draftedShas(projectId: number): Promise<string[]> {
  const rows = await db
    .selectDistinct({ commit: sql<string>`${testPlans.diffContext}->>'commit'` })
    .from(testPlans)
    .where(eq(testPlans.projectId, projectId));

  return rows.map((row) => row.commit).filter((commit): commit is string => Boolean(commit));
}
