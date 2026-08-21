import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, sql as raw } from '@/lib/db';
import {
  cliInstances,
  executionState,
  jobs,
  projects,
  testExecutions,
  testResults,
  users,
} from '@/lib/db/schema';
import { verifyCliToken } from '@/lib/session';
import type { TestResultRow } from '@/lib/db/schema';
import type { MovedUnit } from '@/lib/model';

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

/**
 * `db`, or a transaction on it.
 *
 * The reap runs outside a transaction and a completion runs inside one, and both
 * settle the run behind a job. Passing the executor rather than closing over `db` is
 * what stops the call inside a transaction from writing over a second connection,
 * where a rollback would not reach it.
 */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

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
  mcpUrl?: string | null;
  mcpToken?: string | null;
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
      mcpUrl: identity.mcpUrl ?? null,
      mcpToken: identity.mcpToken ?? null,
    })
    .onConflictDoUpdate({
      target: [cliInstances.projectId, cliInstances.instanceId],
      set: {
        lastSeenAt: sql`now()`,
        hostname: identity.hostname ?? null,
        version: identity.version ?? null,
        mcpUrl: identity.mcpUrl ?? null,
        mcpToken: identity.mcpToken ?? null,
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
    await settleRunOf(db, job, projectId, 'pending');
  }
  for (const job of dead) {
    await settleRunOf(db, job, projectId, {
      error: 'The machine stopped reporting before this run finished.',
    });
  }

  return revived.length + dead.length;
}

/**
 * The execution a job's payload names, moved to match what happened to the job.
 *
 * `error` carries its sentence rather than owning one, because the two callers know
 * different things: a reap knows only that a machine went quiet, and a release knows
 * what the machine said before it handed the work back. The run report shows this
 * text verbatim for a run with no steps, so it is written as a sentence.
 */
async function settleRunOf(
  exec: Executor,
  job: { type: string; payload: unknown },
  projectId: number,
  to: 'pending' | { error: string },
): Promise<void> {
  if (job.type !== 'execute_tests') return;
  const executionPublicId = executionIdOf(job.payload);
  if (!executionPublicId) return;

  await exec
    .update(testExecutions)
    .set(
      to === 'pending'
        ? { status: 'pending', startedAt: null, dockerContainerId: null }
        : { status: 'error', completedAt: new Date(), errorMessage: to.error },
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

/**
 * A step as the runner reports it, mirroring `test_results` in camelCase.
 *
 * `routePattern` is the field a caller is most likely to omit and least able to
 * afford omitting. Coverage, the endpoint pages and a plan's `covers` list are all
 * keyed by pattern, so a step that reports only the URL it called -- variables
 * substituted, `/checkout/ckt_44e2f8/tax` -- joins to nothing it exercised. Only the
 * runner holds the template and the values at the same moment, which is why this is
 * reported rather than worked out here.
 */
export type StepReport = {
  stepId: string;
  stepName: string;
  status: TestResultRow['status'];
  method: string | null;
  routePattern: string | null;
  requestUrl: string | null;
  requestBody: unknown;
  responseStatus: number | null;
  responseBody: unknown;
  responseTimeMs: number | null;
  assertions: unknown;
  errorMessage: string | null;
  /**
   * What this step moved, when a sandbox was watching. Reported rather than derived
   * for the same reason `routePattern` is: only the runner held both readings.
   */
  moved?: MovedUnit[];
};

/**
 * What a machine says when it is done.
 *
 * `outcome` is the settled third of `execution_status` -- there is no reporting a
 * finished run as still running. `durationMs` is the runner's own measurement and is
 * kept in preference to `completed_at - started_at`, which would also count the
 * container build and the gap between queueing and the poll that picked the job up.
 */
export type RunReport = {
  outcome: 'passed' | 'failed' | 'error';
  durationMs: number | null;
  containerId: string | null;
  errorMessage: string | null;
  steps: StepReport[];
  /**
   * The run's own reading, after the last step against before the first. Kept apart
   * from the steps' margins because it is not their sum: margins are only taken after
   * steps that could write, so this is the reading that catches a GET that does.
   */
  moved?: MovedUnit[];
  /**
   * Why the ledger is incomplete, when it is. It never touches `outcome` -- the HTTP
   * result stands on its own and the delta is annotation.
   */
  stateNote?: string | null;
};

export type Completion = {
  /** The run this described, so the CLI can print a link to it. Null for an index job. */
  runPublicId: string | null;
  steps: number;
};

/**
 * The results arrive.
 *
 * **A failed test is a completed job.** The two rows mean different things -- the
 * execution is the run, the job is the errand -- and an errand that delivered a
 * verdict succeeded whatever the verdict was. `status = 'failed'` on a job is
 * reserved for the delivery going wrong, which is what `release` below is for.
 *
 * **The `claimed` -> `completed` transition is the idempotence.** A machine that
 * reports twice -- retried POST, duplicated process, a log replayed by hand -- finds
 * nothing matching the second time and is told the job is not its. So the steps
 * cannot be written twice, and no version counter or request id is needed to say so.
 *
 * All of it in one transaction, because the failure that matters is the half-done
 * one: a job marked `completed` whose results never landed leaves its run `running`
 * with nothing left to move it, and `test_executions_one_live_idx` turns that into a
 * plan that can never be run again. A rollback is a machine that can retry; a
 * committed half is a dead plan.
 */
export async function completeJob(
  scope: CliScope,
  jobPublicId: string,
  instanceId: string,
  report: RunReport,
): Promise<Completion | null> {
  const passed = report.steps.filter((step) => step.status === 'passed').length;

  return db.transaction(async (tx) => {
    const [job] = await tx
      .update(jobs)
      .set({
        status: 'completed',
        /* A summary, not a second copy. The step bodies are the largest thing in the
           request and they are being written to `test_results` in this same
           transaction; keeping them here as well would double the storage of a run
           to hold a row nothing reads. */
        result: {
          outcome: report.outcome,
          steps: report.steps.length,
          passed,
          durationMs: report.durationMs,
          containerId: report.containerId,
        },
        /* Cleared rather than left. A job that was reaped and re-handed out carries
           the reap's note about an attempt that is now over, and reading "the machine
           stopped reporting" off a job that finished is worse than reading nothing. */
        errorMessage: null,
      })
      .where(
        and(
          eq(jobs.publicId, jobPublicId),
          eq(jobs.projectId, scope.projectId),
          eq(jobs.status, 'claimed'),
          eq(jobs.claimedBy, instanceId),
        ),
      )
      .returning({ type: jobs.type, payload: jobs.payload });
    if (!job) return null;

    // Only a run has steps. `index_codebase` has no execution behind it and nothing
    // in `payload` naming one, so its completion is the job row and nothing else.
    if (job.type !== 'execute_tests') return { runPublicId: null, steps: 0 };

    const executionPublicId = executionIdOf(job.payload);
    if (!executionPublicId) return { runPublicId: null, steps: 0 };

    const [execution] = await tx
      .select({ id: testExecutions.id })
      .from(testExecutions)
      .where(
        and(
          eq(testExecutions.publicId, executionPublicId),
          eq(testExecutions.projectId, scope.projectId),
        ),
      )
      .limit(1);
    if (!execution) return { runPublicId: null, steps: 0 };

    /* The previous attempt's rows are not this attempt's answer. A job that was
       reaped and re-handed out reports afresh, and two attempts' steps left side by
       side would read as one run of twice the length -- the report is ordered by id
       and has no column saying which attempt a row belongs to. Nothing writes steps
       before a completion today, so in practice this deletes nothing; it is here
       because the day something reports incrementally is the day that appears. */
    /* The run's own ledger rows go too, and they need saying separately: they hang off
       the execution rather than off a step, so deleting the steps does not cascade to
       them. Before the steps, so the cascade has nothing left to do. */
    await tx.delete(executionState).where(eq(executionState.executionId, execution.id));
    await tx.delete(testResults).where(eq(testResults.executionId, execution.id));

    const resultIds = new Map<string, number>();
    if (report.steps.length) {
      const written = await tx
        .insert(testResults)
        .values(
          report.steps.map((step) => ({
            executionId: execution.id,
            stepId: step.stepId,
            stepName: step.stepName,
            status: step.status,
            requestMethod: step.method,
            routePattern: step.routePattern,
            requestUrl: step.requestUrl,
            requestBody: step.requestBody ?? null,
            responseStatus: step.responseStatus,
            responseBody: step.responseBody ?? null,
            responseTimeMs: step.responseTimeMs,
            assertionResults: step.assertions ?? null,
            errorMessage: step.errorMessage,
          })),
        )
        .returning({ id: testResults.id, stepId: testResults.stepId });
      for (const row of written) resultIds.set(row.stepId, row.id);
    }

    /* What moved: each step's margin, then the run's own reading with no step against
       it. `seq` is the order the readings were taken, which is the order a ledger is
       worth reading in.

       Matched to their steps by step id rather than by position in the RETURNING,
       because the ledger is the only record of a fact nothing else can recover, and
       "the rows come back in the order they went in" is not a promise worth resting
       that on. */
    const ledger = [
      ...report.steps.flatMap((step) =>
        (step.moved ?? []).map((unit) => ({ unit, resultId: resultIds.get(step.stepId) ?? null })),
      ),
      ...(report.moved ?? []).map((unit) => ({ unit, resultId: null })),
    ];

    if (ledger.length) {
      await tx.insert(executionState).values(
        ledger.map(({ unit, resultId }, seq) => ({
          executionId: execution.id,
          testResultId: resultId,
          seq,
          unit: unit.unit,
          rowsMoved: unit.rows,
          fromValue: unit.from ?? null,
          toValue: unit.to ?? null,
        })),
      );
    }

    /* Still guarded on the unsettled statuses, though the job gate above is the one
       that actually holds: a reap and a completion both have to move the same
       `claimed` job, so only one of them gets this far. This is here so that if a run
       ever does settle by some other route, a late completion cannot overwrite it. */
    await tx
      .update(testExecutions)
      .set({
        status: report.outcome,
        completedAt: new Date(),
        durationMs: report.durationMs,
        dockerContainerId: report.containerId,
        errorMessage: report.errorMessage,
        stateNote: report.stateNote ?? null,
      })
      .where(
        and(
          eq(testExecutions.id, execution.id),
          inArray(testExecutions.status, ['pending', 'running']),
        ),
      );

    return { runPublicId: executionPublicId, steps: report.steps.length };
  });
}

/** Whether giving the job back left it retryable, or used up its last attempt. */
export type Release = 'requeued' | 'dead';

/**
 * "I cannot do this one." The voluntary version of the reap.
 *
 * Without it, a machine that cannot start Docker has only one way to say so: go
 * quiet and wait ninety seconds to be presumed dead. That is ninety seconds of a
 * dashboard claiming the run is in progress, and it is the wrong ninety seconds --
 * the machine is right there and knows the answer now.
 *
 * The same backoff as the reap, deliberately. An immediate requeue would be handed
 * straight back to the machine that just said no, which is a spin rather than a
 * retry, and the reason a CLI releases a job is usually still true a second later.
 */
export async function releaseJob(
  scope: CliScope,
  jobPublicId: string,
  instanceId: string,
  reason: string | null,
): Promise<Release | null> {
  // Two phrasings of the same news, because they are read in different places. The
  // job's note sits beside the reap's in the queue's own bookkeeping; the run's is
  // shown to a developer as the whole explanation of a run with no steps.
  const note = reason ?? 'the machine gave this job back without saying why';
  const runNote = reason
    ? `The machine could not run this: ${reason}`
    : 'The machine gave this run back and did not say why.';

  // The claiming machine's own job, still claimed. The same gate as a completion,
  // and the same reason: it is what makes saying this twice a no-op.
  const held = and(
    eq(jobs.publicId, jobPublicId),
    eq(jobs.projectId, scope.projectId),
    eq(jobs.status, 'claimed'),
    eq(jobs.claimedBy, instanceId),
  );

  return db.transaction(async (tx) => {
    const [revived] = await tx
      .update(jobs)
      .set({
        status: 'pending',
        claimedBy: null,
        claimedAt: null,
        nextRetryAt: sql`now() + (interval '10 seconds' * ${jobs.attempts})`,
        errorMessage: note,
      })
      .where(and(held, sql`${jobs.attempts} < ${jobs.maxAttempts}`))
      .returning({ type: jobs.type, payload: jobs.payload });

    if (revived) {
      await settleRunOf(tx, revived, scope.projectId, 'pending');
      return 'requeued';
    }

    const [dead] = await tx
      .update(jobs)
      .set({ status: 'dead', errorMessage: note })
      .where(and(held, sql`${jobs.attempts} >= ${jobs.maxAttempts}`))
      .returning({ type: jobs.type, payload: jobs.payload });

    if (dead) {
      await settleRunOf(tx, dead, scope.projectId, { error: runNote });
      return 'dead';
    }

    return null;
  });
}
