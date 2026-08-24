import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projectCompose, projectEnvironments } from '@/lib/db/schema';
import { normalize } from '@/lib/environment';
import type { ProjectComposeRow, ProjectEnvironmentRow } from '@/lib/db/schema';
import type { ComposeFacts, ComposeService, EnvironmentSpec } from '@/lib/environment';

/**
 * The environment, which is two rows with two different natures.
 *
 * `project_compose` is a fact: what the developer's compose file declares, replaced
 * whenever the CLI reads it again. Nobody approves a fact.
 *
 * `project_environments` is a judgement: what GritQA does with each of those
 * services. It is superseded rather than deleted, because a row records that
 * somebody decided something and a later decision does not make the earlier one not
 * have happened.
 *
 * The one invariant worth stating out loud is enforced in the schema rather than
 * here: two partial unique indexes hold "one approved row and one open proposal per
 * project", so a boot never picks between two answers and an approval never leaves a
 * second proposal on the screen.
 */

export type ComposeInput = {
  projectName?: string;
  fingerprint: string;
  files?: string[];
  services?: ComposeService[];
};

/** Replace what we know the compose file says. Idempotent — the CLI pushes on every boot. */
export async function recordCompose(projectId: number, input: ComposeInput): Promise<void> {
  const row = {
    projectId,
    projectName: input.projectName ?? '',
    fingerprint: input.fingerprint,
    files: input.files ?? [],
    services: input.services ?? [],
    readAt: new Date(),
  };
  await db.insert(projectCompose).values(row).onConflictDoUpdate({
    target: projectCompose.projectId,
    set: row,
  });
}

export async function currentCompose(projectId: number): Promise<ComposeFacts | null> {
  const [row] = await db
    .select()
    .from(projectCompose)
    .where(eq(projectCompose.projectId, projectId))
    .limit(1);
  return row ? toFacts(row) : null;
}

function toFacts(row: ProjectComposeRow): ComposeFacts {
  return {
    projectName: row.projectName,
    fingerprint: row.fingerprint,
    files: row.files ?? [],
    services: row.services ?? [],
  };
}

export type Environment = {
  publicId: string;
  status: 'proposed' | 'approved' | 'superseded';
  author: string;
  spec: EnvironmentSpec;
  fingerprint: string;
  approvedAt: Date | null;
  createdAt: Date;
};

function toEnvironment(row: ProjectEnvironmentRow): Environment {
  return {
    publicId: row.publicId,
    status: row.status,
    author: row.author,
    spec: row.spec,
    fingerprint: row.fingerprint,
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
  };
}

/** What a boot reads, or null when nobody has approved anything yet. */
export async function approvedEnvironment(projectId: number): Promise<Environment | null> {
  const [row] = await db
    .select()
    .from(projectEnvironments)
    .where(and(eq(projectEnvironments.projectId, projectId), eq(projectEnvironments.status, 'approved')))
    .limit(1);
  return row ? toEnvironment(row) : null;
}

/** The agent's open proposal, if there is one waiting to be looked at. */
export async function proposedEnvironment(projectId: number): Promise<Environment | null> {
  const [row] = await db
    .select()
    .from(projectEnvironments)
    .where(and(eq(projectEnvironments.projectId, projectId), eq(projectEnvironments.status, 'proposed')))
    .limit(1);
  return row ? toEnvironment(row) : null;
}

/** Every decision ever made about this project, newest first. */
export async function environmentHistory(projectId: number, limit = 20): Promise<Environment[]> {
  const rows = await db
    .select()
    .from(projectEnvironments)
    .where(eq(projectEnvironments.projectId, projectId))
    .orderBy(desc(projectEnvironments.createdAt))
    .limit(limit);
  return rows.map(toEnvironment);
}

/**
 * Record what the agent worked out.
 *
 * One open proposal per project, so this replaces any earlier one rather than adding
 * to it -- the superseded row keeps the record of what was proposed and passed over.
 * A proposal never touches the approved row: it is a draft of an input, and the
 * screen is where the two meet.
 */
export async function proposeEnvironment(
  projectId: number,
  spec: EnvironmentSpec,
  fingerprint: string,
): Promise<Environment> {
  return db.transaction(async (tx) => {
    await tx
      .update(projectEnvironments)
      .set({ status: 'superseded' })
      .where(and(eq(projectEnvironments.projectId, projectId), eq(projectEnvironments.status, 'proposed')));

    const [row] = await tx
      .insert(projectEnvironments)
      .values({
        projectId,
        status: 'proposed',
        author: 'agent',
        spec: normalize({ ...spec, author: 'agent', fingerprint }),
        fingerprint,
      })
      .returning();
    return toEnvironment(row);
  });
}

/**
 * A person picked. This is the only thing that produces a row a boot will read.
 *
 * The previous approval is superseded in the same transaction as the new one, and the
 * open proposal along with it: the unique indexes would refuse a second approved row
 * anyway, and doing it here means the refusal is never something a user sees.
 */
export async function approveEnvironment(
  projectId: number,
  userId: number,
  spec: EnvironmentSpec,
  fingerprint: string,
): Promise<Environment> {
  return db.transaction(async (tx) => {
    await tx
      .update(projectEnvironments)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(projectEnvironments.projectId, projectId),
          ne(projectEnvironments.status, 'superseded'),
        ),
      );

    const [row] = await tx
      .insert(projectEnvironments)
      .values({
        projectId,
        status: 'approved',
        author: 'approved',
        spec: normalize({ ...spec, author: 'approved', fingerprint }),
        fingerprint,
        approvedBy: userId,
        approvedAt: new Date(),
      })
      .returning();
    return toEnvironment(row);
  });
}
