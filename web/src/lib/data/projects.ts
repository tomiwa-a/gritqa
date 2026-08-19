import { cache } from 'react';
import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { codebaseIndex, projects as projectsTable } from '@/lib/db/schema';
import { agoLabelOrNull } from '@/lib/when';
import { readSession } from '@/lib/session';
import { getSessionUser } from './user';
import { findUserByPublicId } from '@/lib/db/auth';
import type { Project } from '@/lib/mock/types';

/**
 * A project row plus the two figures the overview quotes about it.
 *
 * Both are counted from `codebase_index` rather than stored on the project. A
 * stored count is a second copy of a fact, and the copy is what goes stale -- a
 * developer deleting half their routes would leave a project claiming 91 endpoints
 * until something remembered to decrement it. Counted, the number cannot disagree
 * with the rows it describes, and a project the CLI has never indexed reports zero,
 * which is true.
 */
const withCounts = {
  publicId: projectsTable.publicId,
  name: projectsTable.name,
  repoUrl: projectsTable.repoUrl,
  localPath: projectsTable.localPath,
  defaultBranch: projectsTable.defaultBranch,
  status: projectsTable.status,
  lastIndexedAt: projectsTable.lastIndexedAt,
  fileCount: sql<number>`count(${codebaseIndex.id})::int`,
  endpointCount: sql<number>`coalesce(sum(jsonb_array_length(${codebaseIndex.endpoints})), 0)::int`,
};

type ProjectWithCounts = {
  publicId: string;
  name: string;
  repoUrl: string | null;
  localPath: string;
  defaultBranch: string;
  status: 'active' | 'archived';
  lastIndexedAt: Date | null;
  fileCount: number;
  endpointCount: number;
};

function toProject(row: ProjectWithCounts): Project {
  return {
    publicId: row.publicId,
    name: row.name,
    repoUrl: row.repoUrl,
    localPath: row.localPath,
    defaultBranch: row.defaultBranch,
    status: row.status,
    lastIndexedLabel: agoLabelOrNull(row.lastIndexedAt),
    lastIndexedAt: row.lastIndexedAt?.toISOString() ?? null,
    fileCount: row.fileCount,
    endpointCount: row.endpointCount,
  };
}

/** Every project the signed-in developer owns. Empty for someone who just signed up. */
export const getProjects = cache(async (): Promise<Project[]> => {
  const user = await getSessionUser();
  if (!user) return [];

  const owner = await findUserByPublicId(user.publicId);
  if (!owner) return [];

  const rows = await db
    .select(withCounts)
    .from(projectsTable)
    .leftJoin(codebaseIndex, eq(codebaseIndex.projectId, projectsTable.id))
    .where(eq(projectsTable.userId, owner.id))
    .groupBy(projectsTable.id)
    .orderBy(projectsTable.createdAt, projectsTable.id);

  return rows.map(toProject);
});

/**
 * The project every other read is scoped to.
 *
 * The choice lives on the session, and it is re-checked here rather than trusted:
 * a `pid` naming a project the signed-in developer does not own falls back to
 * their first one, so a stale or tampered cookie cannot widen what it can see.
 */
export const getCurrentProjectOrNull = cache(async (): Promise<Project | null> => {
  const [session, owned] = await Promise.all([readSession(), getProjects()]);
  if (!owned.length) return null;
  return owned.find((p) => p.publicId === session?.pid) ?? owned[0];
});

/**
 * Callers behind the session gate all assume a project exists, and for a developer
 * who has never run the CLI it does not. Onboarding is the screen for that state,
 * so this sends them there rather than rendering a dashboard about nothing.
 */
export async function getCurrentProject(): Promise<Project> {
  const project = await getCurrentProjectOrNull();
  if (!project) redirect('/onboarding');
  return project;
}
