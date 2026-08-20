import { and, eq, sql } from 'drizzle-orm';
import { db, sql as raw } from '@/lib/db';
import { cliInstances, projects, testExecutions, users } from '@/lib/db/schema';
import { verifyCliToken } from '@/lib/session';

/**
 * The machine's side of the seam.
 *
 * Everything here is reached with a bearer token rather than a cookie, which changes
 * two things about how it is written. The scope cannot be React-`cache`d -- that cache
 * is per render, and these are route handlers -- and nothing may be trusted from the
 * body except after it has been matched against the project the token names. A token
 * holder is a developer's own machine, but "their own machine, misconfigured" is a
 * real case: pointed at the wrong project, running an old build, reporting a job id it
 * read from a log.
 */

/** How long a claimed job may go without a heartbeat before it is fair game again. */
const ABANDON_AFTER = '90 seconds';

/**
 * How long after its last poll a machine still counts as connected.
 *
 * Comfortably more than the two-second poll `CAP.md` specifies, because the question
 * being answered is "is there a machine there", and one dropped request on a train
 * wifi is not an answer to it. Short enough that a closed laptop stops claiming to be
 * connected within a screen refresh or two.
 */
export const CONNECTED_WITHIN = '30 seconds';

export type CliScope = {
  userId: number;
  projectId: number;
  projectPublicId: string;
};

/**
 * Who is calling, resolved from the `Authorization` header to the two numeric ids.
 *
 * The project comes from the token, not from the request body, and it is re-checked
 * against the user on every call rather than trusted from when the token was minted:
 * a project can have been deleted or transferred since, and a long-lived credential
 * outlives more than a session does.
 *
 * Null means "no", without saying which no. A caller gets 401 either way.
 */
export async function cliScope(request: Request): Promise<CliScope | null> {
  const session = await verifyCliToken(request.headers.get('authorization'));
  if (!session?.pid) return null;

  const [row] = await db
    .select({ userId: users.id, projectId: projects.id, projectPublicId: projects.publicId })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.userId))
    .where(and(eq(users.publicId, session.uid), eq(projects.publicId, session.pid)))
    .limit(1);

  return row ?? null;
}

export type InstanceIdentity = {
  instanceId: string;
  hostname?: string | null;
  version?: string | null;
};

/**
 * Record that this machine was here.
 *
 * Called on the poll rather than from a dedicated endpoint, because the poll is
 * already a liveness signal arriving every two seconds and inventing a second timer
 * to send the same news would only add a way for the two to disagree.
 *
 * The upsert is on `(project_id, instance_id)`, so a machine has one row that moves
 * rather than a trail of sightings. `hostname` and `version` are refreshed on the way
 * past: a CLI that updated itself should not be described by what it used to be.
 */
export async function touchInstance(projectId: number, identity: InstanceIdentity): Promise<void> {
  await db
    .insert(cliInstances)
    .values({
      projectId,
      instanceId: identity.instanceId,
      hostname: identity.hostname ?? null,
      version: identity.version ?? null,
    })
    .onConflictDoUpdate({
      target: [cliInstances.projectId, cliInstances.instanceId],
      set: {
        lastSeenAt: sql`now()`,
        hostname: identity.hostname ?? null,
        version: identity.version ?? null,
      },
    });
}

export type ClaimedJob = {
  publicId: string;
  type: 'index_codebase' | 'execute_tests';
  payload: unknown;
  attempt: number;
  maxAttempts: number;
};

type JobRowRaw = {
  id: number;
  public_id: string;
  type: 'index_codebase' | 'execute_tests';
  payload: unknown;
  attempts: number;
  max_attempts: number;
};

/**
 * Hand back work abandoned by a machine that stopped reporting.
 *
 * This exists because of `0004`. A partial unique index over the unsettled statuses
 * makes a stuck `running` run block its plan forever, so without a timeout a CLI that
 * crashed mid-run would leave a plan permanently unrunnable -- a crash turned into a
 * dead plan, which is the worst possible reading of "at most one live run".
 *
 * Staleness is measured on `claimed_at`, which the heartbeat moves, so "no heartbeat
 * for ninety seconds" and "claimed ninety seconds ago and never spoke again" are the
 * same condition and need only one column.
 *
 * Retry pushes `next_retry_at` out by ten seconds per attempt, so a job that fails
 * because the machine is thrashing is not re-handed to it instantly. Past
 * `max_attempts` it goes `dead` and the run it belonged to goes `error` -- which is
 * also what releases the index, because `error` is settled.
 */
export async function reapAbandoned(projectId: number): Promise<number> {
  const revived = await raw<JobRowRaw[]>`
    UPDATE jobs SET
      status        = 'pending',
      claimed_by    = NULL,
      claimed_at    = NULL,
      next_retry_at = now() + (interval '10 seconds' * attempts),
      error_message = 'the machine stopped reporting before it finished'
    WHERE project_id = ${projectId}
      AND status = 'claimed'
      AND claimed_at < now() - ${ABANDON_AFTER}::interval
      AND attempts < max_attempts
    RETURNING id, public_id, type, payload, attempts, max_attempts
  `;

  const dead = await raw<JobRowRaw[]>`
    UPDATE jobs SET
      status        = 'dead',
      error_message = 'the machine stopped reporting, and there are no attempts left'
    WHERE project_id = ${projectId}
      AND status = 'claimed'
      AND claimed_at < now() - ${ABANDON_AFTER}::interval
      AND attempts >= max_attempts
    RETURNING id, public_id, type, payload, attempts, max_attempts
  `;

  /* A revived run goes back to `pending` with its start cleared, because the run has
     not started -- the attempt that had, died. The count of attempts lives on the job,
     which is the errand; the run is the run either way and keeps its `public_id`, so a
     link somebody is holding still resolves. */
  for (const job of revived) {
    await settleRunOf(job, projectId, 'pending');
  }
  for (const job of dead) {
    await settleRunOf(job, projectId, 'error');
  }

  return revived.length + dead.length;
}

/** The execution a job's payload names, moved to match what happened to the job. */
async function settleRunOf(
  job: JobRowRaw,
  projectId: number,
  to: 'pending' | 'error',
): Promise<void> {
  if (job.type !== 'execute_tests') return;
  const executionPublicId = executionIdOf(job.payload);
  if (!executionPublicId) return;

  await db
    .update(testExecutions)
    .set(
      to === 'pending'
        ? { status: 'pending', startedAt: null, dockerContainerId: null }
        : {
            status: 'error',
            completedAt: new Date(),
            errorMessage: 'The machine stopped reporting before this run finished.',
          },
    )
    .where(
      and(
        eq(testExecutions.publicId, executionPublicId),
        eq(testExecutions.projectId, projectId),
        eq(testExecutions.status, 'running'),
      ),
    );
}

/** The one field of a payload this module reads. Shapes are the writer's business. */
function executionIdOf(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const id = (payload as { executionPublicId?: unknown }).executionPublicId;
  return typeof id === 'string' ? id : null;
}

/**
 * Take the oldest job this project has waiting, or nothing.
 *
 * `FOR UPDATE SKIP LOCKED` inside the subquery is what makes two machines polling the
 * same project safe: each locks a different row and neither waits, rather than both
 * reading the same id and one losing. It is raw SQL because the builder has no
 * `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`.
 *
 * `attempts` increments here, on the way out, so the number counts times handed to a
 * machine rather than times something succeeded. That is the number a reap has to
 * compare against `max_attempts`, and counting it on completion would mean a job that
 * never completes never counts.
 *
 * Claiming an `execute_tests` job starts its run in the same call. The alternative is
 * a run that sits `pending` while its container is already building, and the dashboard
 * saying "waiting for your machine" about work the machine is doing.
 */
export async function claimNextJob(
  scope: CliScope,
  instanceId: string,
): Promise<ClaimedJob | null> {
  const [job] = await raw<JobRowRaw[]>`
    UPDATE jobs SET
      status     = 'claimed',
      claimed_by = ${instanceId},
      claimed_at = now(),
      attempts   = attempts + 1
    WHERE id = (
      SELECT id FROM jobs
      WHERE project_id = ${scope.projectId}
        AND status = 'pending'
        AND (next_retry_at IS NULL OR next_retry_at <= now())
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, public_id, type, payload, attempts, max_attempts
  `;
  if (!job) return null;

  if (job.type === 'execute_tests') {
    const executionPublicId = executionIdOf(job.payload);
    if (executionPublicId) {
      await db
        .update(testExecutions)
        .set({ status: 'running', startedAt: new Date() })
        .where(
          and(
            eq(testExecutions.publicId, executionPublicId),
            eq(testExecutions.projectId, scope.projectId),
            eq(testExecutions.status, 'pending'),
          ),
        );
    }
  }

  return {
    publicId: job.public_id,
    type: job.type,
    payload: job.payload,
    attempt: job.attempts,
    maxAttempts: job.max_attempts,
  };
}

/**
 * "Still working on it." Moves `claimed_at`, which is what the reap measures.
 *
 * Scoped to the claiming machine as well as the project, so one instance cannot hold
 * another's job alive -- a stale process that kept heartbeating a job it had already
 * lost would otherwise stop the reap from ever freeing it.
 */
export async function heartbeatJob(
  scope: CliScope,
  jobPublicId: string,
  instanceId: string,
): Promise<boolean> {
  const rows = await raw<{ id: number }[]>`
    UPDATE jobs SET claimed_at = now()
    WHERE public_id = ${jobPublicId}
      AND project_id = ${scope.projectId}
      AND status = 'claimed'
      AND claimed_by = ${instanceId}
    RETURNING id
  `;
  return rows.length > 0;
}
