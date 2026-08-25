import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db, sql as raw } from '@/lib/db';
import {
  MACHINE_JOBS,
  cliInstances,
  codebaseIndex,
  executionState,
  jobs,
  planRevisions,
  projects,
  testExecutions,
  testPlans,
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
    .select({
      userId: users.id,
      projectId: projects.id,
      projectPublicId: projects.publicId,
    })
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

/** One file as the CLI mirrors it. The three jsonb columns are NOT NULL, so none is optional. */
export type MirroredFile = {
  filePath: string;
  fileHash: string;
  language: string;
  symbols: unknown;
  dependencies: unknown;
  endpoints: unknown;
};

export type Mirrored = { written: number; removed: number };

/**
 * The index arrives.
 *
 * Mark and sweep, not a diff: every pushed file is stamped with one `now`, and a
 * `complete` push then deletes whatever still carries an older stamp. That is one
 * cheap statement where `NOT IN (...4000 paths)` would be a query the size of the
 * push, and it needs nothing remembered between calls.
 *
 * The mirror is not correctness-bearing -- the agent reads files through the CLI, not
 * from here -- so this replaces rather than reconciles, and nothing about a run
 * depends on it being current.
 */
export async function mirrorIndex(
  projectId: number,
  files: MirroredFile[],
  complete: boolean,
): Promise<Mirrored> {
  /* Last one wins. Two entries for one path in a single statement is
     "ON CONFLICT DO UPDATE cannot affect row a second time" -- a 500 caused by a
     machine reporting the same file twice, which is exactly the misconfiguration
     this file's header says not to trust the body about. */
  const unique = new Map(files.map((f) => [f.filePath, f]));

  return db.transaction(async (tx) => {
    const now = new Date();
    const rows = [...unique.values()].map((f) => ({
      projectId,
      filePath: f.filePath,
      fileHash: f.fileHash,
      language: f.language,
      symbols: f.symbols,
      dependencies: f.dependencies,
      endpoints: f.endpoints,
      lastIndexedAt: now,
    }));

    /* Postgres takes 65535 bound parameters per statement and each row spends eight,
       so a project of any size has to arrive in more than one. */
    for (let at = 0; at < rows.length; at += 500) {
      await tx
        .insert(codebaseIndex)
        .values(rows.slice(at, at + 500))
        .onConflictDoUpdate({
          target: [codebaseIndex.projectId, codebaseIndex.filePath],
          set: {
            fileHash: sql`excluded.file_hash`,
            language: sql`excluded.language`,
            symbols: sql`excluded.symbols`,
            dependencies: sql`excluded.dependencies`,
            endpoints: sql`excluded.endpoints`,
            lastIndexedAt: sql`excluded.last_indexed_at`,
            updatedAt: now,
          },
        });
    }

    /* Swept only when something arrived. An empty `complete` push is a walk that
       failed, not a project that lost every file, and emptying the mirror on it would
       turn a CLI bug into deleted rows. */
    let removed = 0;
    if (complete && rows.length) {
      const gone = await tx
        .delete(codebaseIndex)
        .where(and(eq(codebaseIndex.projectId, projectId), lt(codebaseIndex.lastIndexedAt, now)))
        .returning({ id: codebaseIndex.id });
      removed = gone.length;
    }

    await tx.update(projects).set({ lastIndexedAt: now }).where(eq(projects.id, projectId));

    return { written: rows.length, removed };
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
 *
 * Bounded to `MACHINE_JOBS`, because "the machine stopped reporting" is not a question
 * that can be asked about an agent job at all. Those are held by a web process and
 * heartbeat on a different clock, and reaping one here would hand the developer's draft
 * back to a poller that has no model key and no idea what to do with it. Agent work has
 * its own reaper in `work.ts`.
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
      AND type = ANY(${[...MACHINE_JOBS]}::job_type[])
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
      AND type = ANY(${[...MACHINE_JOBS]}::job_type[])
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
 *
 * The type filter is not a tidiness measure. Without it this query takes the oldest
 * pending job of *any* kind, so the first draft a developer asks for would be handed to
 * whichever machine polled next, met `attach.go`'s "this machine does not know what a
 * draft_plan job is", and been given back and re-handed until it died -- while the
 * developer watched a queue page saying their plan was being worked on.
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
        AND type = ANY(${[...MACHINE_JOBS]}::job_type[])
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
  /**
   * What this step was. A request, a statement against GritQA's own copy of the
   * database, or a command inside its container -- and the field the three below
   * are only meaningful under.
   */
  kind: TestResultRow['stepKind'];
  method: string | null;
  routePattern: string | null;
  requestUrl: string | null;
  requestBody: unknown;
  responseStatus: number | null;
  responseBody: unknown;
  /**
   * How long the step took, whatever kind it was. The column is still called
   * `response_time_ms` because four read paths spell it that way and renaming it
   * would rewrite all of them for a word.
   */
  responseTimeMs: number | null;
  /**
   * Rows a sql step touched: rows returned by a `verify` query, rows affected by a
   * `setup` one. Nullable and reported rather than defaulted, because `0` is the
   * answer a verification step exists to catch -- "returned 201, wrote nothing" --
   * and it must not be indistinguishable from a step with no rows to report.
   */
  rowCount: number | null;
  /** What a shell step exited with. Nullable for the same reason: `0` is success. */
  exitCode: number | null;
  /** What a shell step printed on stdout, masked and bounded by the caller. */
  output: string | null;
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

/**
 * The steps of a run, and what each of them moved.
 *
 * Shared by the two ways a run's results arrive -- `completeJob`, which settles a run
 * the dashboard queued, and `recordRun`, which writes one that happened on a
 * developer's own machine and was reported afterwards. One function rather than two
 * copies, because these rows are what the run report renders and what the coverage
 * grid counts: the two diverging would mean a run's evidence depended on which button
 * started it.
 *
 * Always inside a transaction with whatever settles the execution. The failure that
 * matters is the half-done one -- a run marked finished whose steps never landed reads
 * as a run that did nothing.
 */
async function writeResults(tx: Executor, executionId: number, report: RunReport): Promise<void> {
  /* The previous attempt's rows are not this attempt's answer. A job that was reaped
     and re-handed out reports afresh, and two attempts' steps left side by side would
     read as one run of twice the length -- the report is ordered by id and has no
     column saying which attempt a row belongs to. */
  /* The run's own ledger rows go too, and they need saying separately: they hang off
     the execution rather than off a step, so deleting the steps does not cascade to
     them. Before the steps, so the cascade has nothing left to do. */
  await tx.delete(executionState).where(eq(executionState.executionId, executionId));
  await tx.delete(testResults).where(eq(testResults.executionId, executionId));

  const resultIds = new Map<string, number>();
  if (report.steps.length) {
    const written = await tx
      .insert(testResults)
      .values(
        report.steps.map((step) => ({
          executionId,
          stepId: step.stepId,
          stepName: step.stepName,
          status: step.status,
          stepKind: step.kind,
          requestMethod: step.method,
          routePattern: step.routePattern,
          requestUrl: step.requestUrl,
          requestBody: step.requestBody ?? null,
          responseStatus: step.responseStatus,
          responseBody: step.responseBody ?? null,
          responseTimeMs: step.responseTimeMs,
          rowCount: step.rowCount,
          exitCode: step.exitCode,
          output: step.output,
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
      (step.moved ?? []).map((unit) => ({
        unit,
        resultId: resultIds.get(step.stepId) ?? null,
      })),
    ),
    ...(report.moved ?? []).map((unit) => ({ unit, resultId: null })),
  ];
  if (!ledger.length) return;

  await tx.insert(executionState).values(
    ledger.map(({ unit, resultId }, seq) => ({
      executionId,
      testResultId: resultId,
      seq,
      unit: unit.unit,
      rowsMoved: unit.rows,
      fromValue: unit.from ?? null,
      toValue: unit.to ?? null,
    })),
  );
}

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

    await writeResults(tx, execution.id, report);

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

/**
 * A step lands while the run is still going.
 *
 * **A preview, not the record.** `completeJob` clears every step of a run before it
 * writes the completion's, so nothing written here survives the end of the run and
 * nothing here can make a finished run say something the runner did not report. What
 * it buys is a dashboard that shows a thirty-second run as it happens rather than as a
 * blank panel followed by everything at once.
 *
 * Idempotent by replacement: a step that arrives twice -- a retried POST, a step the
 * repairer re-ran -- replaces the row it wrote before, and the delete cascades to that
 * row's ledger so margins do not accumulate either. No new column and no migration:
 * the step id is already the identity within a run.
 *
 * Null when the job is not this machine's, same as the heartbeat, and it renews the
 * claim on the way past for the same reason -- a machine sending steps is a machine
 * still working.
 */
export async function recordSteps(
  scope: CliScope,
  jobPublicId: string,
  instanceId: string,
  steps: StepReport[],
): Promise<number | null> {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .update(jobs)
      .set({ claimedAt: new Date() })
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

    // Only a run has steps. An `index_codebase` job has no execution behind it, and a
    // machine previewing steps for one is confused rather than unauthorised.
    if (job.type !== 'execute_tests' || !steps.length) return 0;

    const executionPublicId = executionIdOf(job.payload);
    if (!executionPublicId) return 0;

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
    if (!execution) return 0;

    await tx.delete(testResults).where(
      and(
        eq(testResults.executionId, execution.id),
        inArray(
          testResults.stepId,
          steps.map((s) => s.stepId),
        ),
      ),
    );

    const written = await tx
      .insert(testResults)
      .values(
        steps.map((step) => ({
          executionId: execution.id,
          stepId: step.stepId,
          stepName: step.stepName,
          status: step.status,
          stepKind: step.kind,
          requestMethod: step.method,
          routePattern: step.routePattern,
          requestUrl: step.requestUrl,
          requestBody: step.requestBody ?? null,
          responseStatus: step.responseStatus,
          responseBody: step.responseBody ?? null,
          responseTimeMs: step.responseTimeMs,
          rowCount: step.rowCount,
          exitCode: step.exitCode,
          output: step.output,
          assertionResults: step.assertions ?? null,
          errorMessage: step.errorMessage,
        })),
      )
      .returning({ id: testResults.id, stepId: testResults.stepId });

    const resultIds = new Map(written.map((row) => [row.stepId, row.id]));
    const ledger = steps.flatMap((step) =>
      (step.moved ?? []).map((unit) => ({
        unit,
        resultId: resultIds.get(step.stepId) ?? null,
      })),
    );

    if (ledger.length) {
      /* `seq` continues from what is already there, so a ledger read in `seq` order is
         read in the order the readings were taken. Only approximately, for a step that
         arrived twice -- its replacement sorts after steps that came later. The
         completion rewrites the whole ledger in one go, which is where the ordering
         stops being approximate. */
      const [{ used }] = await tx
        .select({ used: sql<number>`count(*)::int` })
        .from(executionState)
        .where(eq(executionState.executionId, execution.id));

      await tx.insert(executionState).values(
        ledger.map(({ unit, resultId }, at) => ({
          executionId: execution.id,
          testResultId: resultId,
          seq: used + at,
          unit: unit.unit,
          rowsMoved: unit.rows,
          fromValue: unit.from ?? null,
          toValue: unit.to ?? null,
        })),
      );
    }

    return written.length;
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

/**
 * A plan the CLI wrote, and where it landed.
 *
 * `changed: false` is an answer, not a failure: pushing the same text twice leaves the
 * plan on the version it was already on. Without that, a machine that re-pushes its
 * drafts on every boot would walk an approved plan back to `draft` and bump its
 * version for nothing.
 */
export type PlanPush =
  | { ok: true; publicId: string; version: number; changed: boolean }
  | { ok: false; reason: 'unknown' | 'archived' };

export type PlanBody = {
  /** The plan this is a new version of. Absent means a plan that did not exist. */
  planPublicId?: string | null;
  name: string;
  description: string | null;
  baseUrl: string;
  /** What the runner reads: variables, steps, and whatever the drafter recorded beside them. */
  planJson: Record<string, unknown>;
  /** One line for the revision thread. */
  summary: string;
};

/**
 * A draft written on a developer's machine, into the record.
 *
 * **The file is the cache and this is the record.** A plan drafted at a terminal used
 * to exist only under `.gritqa/drafts/`, which meant the run that came out of it had
 * nowhere to hang -- `test_executions.test_plan_id` is `NOT NULL`, so a run of a file
 * is a run of nothing as far as the dashboard is concerned. Pushing the plan first is
 * what makes the run recordable at all, and it is also what lets somebody else on the
 * team read a plan a colleague drafted.
 *
 * Compared canonically rather than by `JSON.stringify`, because `jsonb` does not keep
 * key order: the stored copy comes back with its keys sorted differently from the way
 * they went in, so a plain string comparison would find every push different from
 * itself and bump the version each time.
 *
 * `status` goes back to `draft` on a change, exactly as `writeRevision` does it and
 * for the same reason -- approval is approval of a particular text.
 */
export async function savePlan(scope: CliScope, input: PlanBody): Promise<PlanPush> {
  return db.transaction(async (tx) => {
    if (!input.planPublicId) {
      const [created] = await tx
        .insert(testPlans)
        .values({
          projectId: scope.projectId,
          name: input.name,
          description: input.description,
          baseUrl: input.baseUrl,
          planJson: input.planJson,
          status: 'draft',
          version: 1,
          /* `manual` because somebody ran a command. `git_push` is for the drafts that
             appear on their own once the CLI is watching a branch. */
          triggerSource: 'manual',
        })
        .returning({ id: testPlans.id, publicId: testPlans.publicId });

      await tx.insert(planRevisions).values({
        testPlanId: created.id,
        version: 1,
        /* `agent` with no instruction: the drafter wrote it. The developer's own words
           went to the model on the command line and the CLI does not keep them, so
           claiming a `human` turn here would put a row in the thread with nothing in
           it -- and the table's CHECK requires an instruction for one. */
        author: 'agent',
        instruction: null,
        summary: input.summary,
        changes: [],
        createdBy: scope.userId,
      });

      return { ok: true as const, publicId: created.publicId, version: 1, changed: true };
    }

    const [current] = await tx
      .select({
        id: testPlans.id,
        version: testPlans.version,
        status: testPlans.status,
        planJson: testPlans.planJson,
      })
      .from(testPlans)
      .where(
        and(eq(testPlans.projectId, scope.projectId), eq(testPlans.publicId, input.planPublicId)),
      )
      .limit(1);

    /* Scoped by project, so a plan belonging to somebody else reads as absent rather
       than as forbidden -- the same answer the read side gives. */
    if (!current) return { ok: false as const, reason: 'unknown' as const };
    if (current.status === 'archived') return { ok: false as const, reason: 'archived' as const };

    if (canonical(current.planJson) === canonical(input.planJson)) {
      return {
        ok: true as const,
        publicId: input.planPublicId,
        version: current.version,
        changed: false,
      };
    }

    const next = current.version + 1;
    const [moved] = await tx
      .update(testPlans)
      .set({
        name: input.name,
        description: input.description,
        baseUrl: input.baseUrl,
        planJson: input.planJson,
        status: 'draft',
        version: next,
      })
      /* The version as the lock, same as `writeRevision`: two pushes that read v3
         cannot both write v4, because the second finds no row. */
      .where(and(eq(testPlans.id, current.id), eq(testPlans.version, current.version)))
      .returning({ id: testPlans.id });
    if (!moved) return { ok: false as const, reason: 'unknown' as const };

    await tx.insert(planRevisions).values({
      testPlanId: current.id,
      version: next,
      author: 'agent',
      instruction: null,
      summary: input.summary,
      changes: [],
      createdBy: scope.userId,
    });

    return { ok: true as const, publicId: input.planPublicId, version: next, changed: true };
  });
}

/**
 * The same object twice is the same string.
 *
 * `jsonb` stores keys in its own order, so what comes back out of Postgres is rarely
 * spelled the way it went in. Sorting every object's keys on the way to a string is
 * what makes "has this plan changed" a question about the plan rather than about how
 * the database chose to lay it out.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const source = entry as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = source[key];
    return out;
  });
}

/**
 * A run that already happened.
 *
 * The other end of `completeJob`: same report, same results, no job behind it. A
 * developer typing `gritqa --run` has finished the run by the time anything is told
 * about it, so this inserts the execution **already settled** -- status is the outcome
 * and both timestamps are in the one INSERT. That is also what keeps it clear of
 * `test_executions_one_live_idx`, which is partial over the unsettled statuses: there
 * is no moment at which this row is `running`, so it cannot collide with a queued run
 * of the same plan, and a queued run cannot be settled by this arriving.
 *
 * `completedAt` is computed from the run's own start and duration rather than set to
 * now. The run ended when it ended; the gap before it was reported is network and
 * process time, and folding that in would make `completed_at - started_at` disagree
 * with the duration the runner measured.
 */
export async function recordRun(
  scope: CliScope,
  input: { planPublicId: string; startedAt: Date | null; report: RunReport },
): Promise<{ runPublicId: string; steps: number } | null> {
  const { report } = input;

  return db.transaction(async (tx) => {
    const [plan] = await tx
      .select({ id: testPlans.id, version: testPlans.version })
      .from(testPlans)
      .where(
        and(eq(testPlans.projectId, scope.projectId), eq(testPlans.publicId, input.planPublicId)),
      )
      .limit(1);
    if (!plan) return null;

    const startedAt = input.startedAt;
    const completedAt =
      startedAt && report.durationMs !== null
        ? new Date(startedAt.getTime() + report.durationMs)
        : new Date();

    const [run] = await tx
      .insert(testExecutions)
      .values({
        testPlanId: plan.id,
        projectId: scope.projectId,
        /* The plan's current version, because that is the text the runner just read --
           the CLI pushes the plan before it reports the run, so the two agree by
           construction rather than by the CLI naming a number. */
        planVersion: plan.version,
        status: report.outcome,
        trigger: 'terminal',
        dockerContainerId: report.containerId,
        startedAt,
        completedAt,
        durationMs: report.durationMs,
        errorMessage: report.errorMessage,
        stateNote: report.stateNote ?? null,
      })
      .returning({ id: testExecutions.id, publicId: testExecutions.publicId });

    await writeResults(tx, run.id, report);

    return { runPublicId: run.publicId, steps: report.steps.length };
  });
}
