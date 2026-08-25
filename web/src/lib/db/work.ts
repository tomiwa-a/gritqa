import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, sql as raw } from '@/lib/db';
import { AGENT_JOBS, jobEvents, jobs } from '@/lib/db/schema';
import { agoLabel } from '@/lib/when';
import type { AgentJobType } from '@/lib/db/schema';
import type { WorkNote, Watcher } from '@/lib/agent/watch';

/**
 * The agent's work, as rows.
 *
 * Drafting, refining and answering all used to happen inside the request that asked
 * for them: a minute or two of model calls with the browser holding the connection
 * open, and nothing written down until the end. That made navigating away destructive,
 * which is the opposite of what the work is like -- it is long, it is not interactive,
 * and the developer has other things to do while it runs.
 *
 * So it becomes queued work, in the same table a run already uses, and this module is
 * the whole of what the web writes and reads there. Two things about it are worth
 * saying out loud.
 *
 * **Nothing polls.** There is no worker process. Work starts in `after()` on the
 * request that asked for it, so it begins immediately and outlives the response, and it
 * is picked up again when somebody opens the work page. That is a real limit and it is
 * deliberate for now: a resident worker is a deployment shape to choose once, not a
 * thing to guess at while the idea is being validated.
 *
 * **The lease is the same two columns the CLI uses.** `claimed_by` and `claimed_at`,
 * with a holder id per web process rather than per machine. No new columns, and the
 * abandonment question is asked the same way on both sides -- "did whoever held this
 * stop speaking" -- with a different answer for how long silence is allowed.
 */

/**
 * How long a held job may go quiet before somebody else may take it.
 *
 * Much longer than the CLI's ninety seconds, and for a specific reason: the `write`
 * phase is a single `generateObject` with no tools, so it emits nothing at all for as
 * long as the model takes to produce a whole plan. Anything shorter and a job would be
 * declared abandoned in the middle of the call that is doing the work.
 *
 * Which is also why the runner writes a note before each phase rather than only after
 * one: the boundary marks are what keep the silence inside this window.
 */
const ABANDON_AFTER = '3 minutes';

/**
 * Who holds a job, from this process's point of view.
 *
 * Cached on `globalThis` for the same reason the connection pool is: `next dev`
 * re-evaluates a module on every edit in its import graph, and a fresh id per
 * evaluation would make this process fail to recognise its own leases -- so an edit
 * during a draft would look exactly like a crash.
 */
const globalForWork = globalThis as unknown as { __gritqaHolder?: string };

export const holder: string = (globalForWork.__gritqaHolder ??= `web:${crypto.randomUUID()}`);

/** A label longer than this is a mistake somewhere, not something to store. */
const MAX_LABEL = 4_000;

export type WorkStatus = 'pending' | 'claimed' | 'completed' | 'failed' | 'dead';

/**
 * Ask for work, and get back the id to watch it by.
 *
 * `label` goes into the payload rather than into a column of its own, because it is
 * the same kind of fact as everything else in there -- what was asked for -- and the
 * page needs exactly one field of a payload whose shape is the runner's business.
 * `executionIdOf` in `cli.ts` is the same idiom.
 */
export async function enqueueWork(input: {
  projectId: number;
  userId: number;
  type: AgentJobType;
  /** What this is, in the developer's own words, for the row on the work page. */
  label: string;
  /** Everything the runner needs to do the work. Shapes are the runner's business. */
  request: Record<string, unknown>;
}): Promise<string> {
  const [job] = await db
    .insert(jobs)
    .values({
      projectId: input.projectId,
      type: input.type,
      status: 'pending',
      requestedBy: input.userId,
      payload: { label: input.label.slice(0, MAX_LABEL), ...input.request },
    })
    .returning({ publicId: jobs.publicId });
  return job.publicId;
}

export type Held = {
  id: number;
  publicId: string;
  type: AgentJobType;
  projectId: number;
  requestedBy: number | null;
  /**
   * When the work was asked for, which is not when it is being done.
   *
   * Carried because the audit row is timestamped with it: a plan somebody asked for
   * at 16:01 belongs in the timeline at 16:01, not at 16:04 where the model happened
   * to return -- which would put it after things that came after it.
   */
  requestedAt: Date;
  payload: unknown;
  /** Which try this is, counting from one. */
  attempt: number;
  /** How many events are already recorded, so this attempt numbers on from them. */
  events: number;
  /**
   * What a previous attempt's research established, when there was one.
   *
   * This is the whole of what a resume saves, and it is worth being precise about:
   * the work is re-run, not resumed mid-call. Research is the expensive phase and its
   * entire output is one block of text, so an attempt that died after reading the code
   * starts again from those findings instead of paying for the reading twice. Nothing
   * finer than that is recoverable, and pretending otherwise would be a lie the page
   * would tell.
   */
  resumeFrom?: string;
};

/**
 * Take a job, if it is takeable.
 *
 * One statement decides it, so two requests racing to start the same work cannot both
 * win -- `FOR UPDATE SKIP LOCKED` means the loser reads nothing rather than waiting for
 * the winner and then also proceeding. Null is the ordinary answer and not an error:
 * somebody else has it, or it is already finished, or it has been tried as often as it
 * is allowed to be.
 *
 * `attempts` increments on the way in, counting times the work was *started* rather
 * than times it succeeded, which is what bounds a job that dies the same way forever.
 */
export async function holdWork(jobPublicId: string): Promise<Held | null> {
  const [job] = await raw<
    {
      id: number;
      public_id: string;
      type: AgentJobType;
      project_id: number;
      requested_by: number | null;
      created_at: Date;
      payload: unknown;
      attempts: number;
    }[]
  >`
    UPDATE jobs SET
      status     = 'claimed',
      claimed_by = ${holder},
      claimed_at = now(),
      attempts   = attempts + 1
    WHERE id = (
      SELECT id FROM jobs
      WHERE public_id = ${jobPublicId}
        AND type = ANY(${[...AGENT_JOBS]}::job_type[])
        AND attempts < max_attempts
        AND (
          status = 'pending'
          OR (status = 'claimed' AND claimed_at < now() - ${ABANDON_AFTER}::interval)
        )
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, public_id, type, project_id, requested_by, created_at, payload, attempts
  `;
  if (!job) return null;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobEvents)
    .where(eq(jobEvents.jobId, job.id));

  return {
    id: job.id,
    publicId: job.public_id,
    type: job.type,
    projectId: job.project_id,
    requestedBy: job.requested_by,
    requestedAt: job.created_at,
    payload: job.payload,
    attempt: job.attempts,
    events: count,
    resumeFrom: await priorFindings(job.id),
  };
}

/**
 * The findings a previous attempt wrote, if any.
 *
 * Last one wins: an attempt that got further than its predecessor recorded more, and
 * the most recent reading is the one that describes the tree as it is now.
 */
async function priorFindings(jobId: number): Promise<string | undefined> {
  const [row] = await db
    .select({ label: jobEvents.label })
    .from(jobEvents)
    .where(and(eq(jobEvents.jobId, jobId), eq(jobEvents.kind, 'findings')))
    .orderBy(desc(jobEvents.seq))
    .limit(1);
  return row?.label || undefined;
}

/** A watcher that writes, plus the barrier that makes sure it finished. */
export type Recorder = Watcher & {
  /**
   * Wait for every note to be written.
   *
   * Notes are written without being awaited, so that recording what the agent did
   * never adds latency to the agent doing it. That leaves inserts in flight when the
   * work finishes, and a job marked complete before its own transcript landed is a
   * page that renders the end of the story with the middle missing.
   */
  settled(): Promise<void>;
};

/**
 * Somewhere for the agent's notes to go.
 *
 * `seq` comes off a counter in memory rather than off `max(seq) + 1`, because the
 * inserts are not awaited and two of them reading the same maximum would collide --
 * which the unique index would catch, correctly, by losing a row. The counter starts
 * where the last attempt stopped, so a resume continues the transcript instead of
 * writing over it.
 */
export function recorder(job: Held): Recorder {
  let seq = job.events;
  let pending: Promise<void>[] = [];
  let beat = 0;

  const write = (note: WorkNote): void => {
    seq += 1;
    pending.push(
      db
        .insert(jobEvents)
        .values({
          jobId: job.id,
          seq,
          phase: note.phase,
          kind: note.kind,
          label: note.label.slice(0, MAX_LABEL),
          detail: note.detail ?? null,
        })
        .then(
          () => {},
          (error: unknown) => {
            /* Swallowed on purpose. A transcript row that could not be written is
               worth a line in the server log and nothing else: failing the draft
               because its narration failed would be the recording deciding the
               outcome of the thing it is recording. */
            console.error('work: could not record an event', error);
          },
        ),
    );
  };

  return {
    resumeFrom: job.resumeFrom,
    note(note) {
      write(note);
      /* The lease, moved by the same activity that produces the transcript, at most
         once a stretch so a chatty research pass does not turn into an UPDATE per tool
         call. Fire-and-forget like the note itself: a missed heartbeat costs a resume
         somebody has to trigger, not a lost draft. */
      const now = Date.now();
      if (now - beat > 20_000) {
        beat = now;
        pending.push(beatWork(job).then(() => {}));
      }
    },
    async settled() {
      /* A loop rather than one `Promise.all`, because awaiting the batch is exactly
         when the last few notes of the `save` phase arrive. */
      while (pending.length) {
        const batch = pending;
        pending = [];
        await Promise.all(batch);
      }
    },
  };
}

/** "Still working on it." Moves `claimed_at`, which is what abandonment is measured on. */
export async function beatWork(job: Held): Promise<boolean> {
  const rows = await raw<{ id: number }[]>`
    UPDATE jobs SET claimed_at = now()
    WHERE id = ${job.id}
      AND claimed_by = ${holder}
      AND status = 'claimed'
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * The work is done, and here is where what it produced lives.
 *
 * Scoped to this holder, so a process that lost its lease to a resume cannot come back
 * later and declare the job finished over the top of the attempt that actually
 * finished it.
 */
export async function settleWork(job: Held, result: { href: string; note: string }): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'completed', result, errorMessage: null })
    .where(and(eq(jobs.id, job.id), eq(jobs.claimedBy, holder)));
}

/**
 * The work failed, and this is why.
 *
 * Terminal: no retry, no backoff. A machine job is retried because the failure is
 * usually the machine -- a dropped connection, a laptop closing -- and the same errand
 * on the next poll succeeds. An agent job that came back with an unusable plan will
 * come back with an unusable plan again, and spending the developer's model budget
 * three times to establish that is worse than telling them once. Asking again is a
 * button, and a new request is a new job.
 *
 * Abandonment is the other thing, and it is not this: a job whose holder stopped
 * speaking is still `claimed`, and `holdWork` will let the next comer take it.
 */
export async function failWork(job: Held, message: string): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'failed', errorMessage: message.slice(0, MAX_LABEL) })
    .where(and(eq(jobs.id, job.id), eq(jobs.claimedBy, holder)));
}

/**
 * Give up on jobs nobody can pick up any more.
 *
 * A job held by a process that died leaves no trace except silence, and silence reads
 * the same as work in progress. Once its attempts are spent there is nothing left to
 * try, so it is said plainly rather than left looking busy forever.
 */
export async function reapHopeless(projectId: number): Promise<number> {
  const rows = await raw<{ id: number }[]>`
    UPDATE jobs SET
      status        = 'dead',
      error_message = 'This stopped partway through and there are no attempts left. Ask again.'
    WHERE project_id = ${projectId}
      AND status = 'claimed'
      AND type = ANY(${[...AGENT_JOBS]}::job_type[])
      AND claimed_at < now() - ${ABANDON_AFTER}::interval
      AND attempts >= max_attempts
    RETURNING id
  `;
  return rows.length;
}

/** The two fields of a payload and a result that this module reads. */
function labelOf(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'Work';
  const label = (payload as { label?: unknown }).label;
  return typeof label === 'string' && label.trim() ? label : 'Work';
}

function hrefOf(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const href = (result as { href?: unknown }).href;
  return typeof href === 'string' && href.startsWith('/') ? href : null;
}

export type WorkRow = {
  publicId: string;
  type: AgentJobType;
  status: WorkStatus;
  label: string;
  whenLabel: string;
  createdAt: string;
  attempt: number;
  maxAttempts: number;
  /** The last thing it said, so a row still running says what it is doing. */
  latest: string | null;
  /** Where the finished thing lives. Null until there is one. */
  href: string | null;
  error: string | null;
  /**
   * Held, but silent for longer than a phase can be. Reopening the page restarts it,
   * which is what makes closing the tab survivable.
   */
  stalled: boolean;
};

/** How much of the history the work page shows. It is a queue, not an archive. */
const RECENT = 40;

export async function listWork(projectId: number): Promise<WorkRow[]> {
  const rows = await db
    .select({
      publicId: jobs.publicId,
      type: jobs.type,
      status: jobs.status,
      payload: jobs.payload,
      result: jobs.result,
      error: jobs.errorMessage,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      createdAt: jobs.createdAt,
      /* The last line of the transcript, as a subquery rather than a join: the list is
         short, `job_events_seq_idx` answers it directly, and joining events would
         multiply the job row before anything could be picked off it. */
      latest: sql<string | null>`(
        SELECT ${jobEvents.label} FROM ${jobEvents}
        WHERE ${jobEvents.jobId} = ${jobs.id}
        ORDER BY ${jobEvents.seq} DESC
        LIMIT 1
      )`,
      stalled: sql<boolean>`(
        ${jobs.status} = 'claimed'
        AND ${jobs.claimedAt} < now() - ${ABANDON_AFTER}::interval
      )`,
    })
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), inArray(jobs.type, [...AGENT_JOBS])))
    .orderBy(desc(jobs.createdAt))
    .limit(RECENT);

  return rows.map((row) => ({
    publicId: row.publicId,
    type: row.type as AgentJobType,
    status: row.status,
    label: labelOf(row.payload),
    whenLabel: agoLabel(row.createdAt),
    createdAt: row.createdAt.toISOString(),
    attempt: row.attempts,
    maxAttempts: row.maxAttempts,
    latest: row.latest,
    href: hrefOf(row.result),
    error: row.error,
    stalled: row.stalled,
  }));
}

export type WorkEvent = {
  publicId: string;
  seq: number;
  phase: string;
  kind: string;
  label: string;
  whenLabel: string;
};

export type WorkDetail = WorkRow & { events: WorkEvent[] };

export async function workDetail(
  projectId: number,
  jobPublicId: string,
): Promise<WorkDetail | null> {
  const [row] = await db
    .select({
      id: jobs.id,
      publicId: jobs.publicId,
      type: jobs.type,
      status: jobs.status,
      payload: jobs.payload,
      result: jobs.result,
      error: jobs.errorMessage,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      claimedAt: jobs.claimedAt,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), eq(jobs.publicId, jobPublicId)))
    .limit(1);
  if (!row) return null;

  const events = await db
    .select({
      publicId: jobEvents.publicId,
      seq: jobEvents.seq,
      phase: jobEvents.phase,
      kind: jobEvents.kind,
      label: jobEvents.label,
      createdAt: jobEvents.createdAt,
    })
    .from(jobEvents)
    .where(eq(jobEvents.jobId, row.id))
    .orderBy(asc(jobEvents.seq));

  const silence = row.claimedAt ? Date.now() - row.claimedAt.getTime() : 0;

  return {
    publicId: row.publicId,
    type: row.type as AgentJobType,
    status: row.status,
    label: labelOf(row.payload),
    whenLabel: agoLabel(row.createdAt),
    createdAt: row.createdAt.toISOString(),
    attempt: row.attempts,
    maxAttempts: row.maxAttempts,
    latest: events.at(-1)?.label ?? null,
    href: hrefOf(row.result),
    error: row.error,
    stalled: row.status === 'claimed' && silence > STALE_MS,
    events: events.map((event) => ({
      publicId: event.publicId,
      seq: event.seq,
      phase: event.phase,
      kind: event.kind,
      label: event.label,
      whenLabel: agoLabel(event.createdAt),
    })),
  };
}

/**
 * The same window as `ABANDON_AFTER`, in milliseconds.
 *
 * One detail page compares one timestamp, which is not worth a round trip to Postgres
 * to have `now()` do it -- but the two numbers must agree, so the interval is the
 * declaration and this is derived from it rather than typed again.
 */
const STALE_MS = 3 * 60 * 1_000;

/**
 * Which jobs a page load should start.
 *
 * Everything never begun, and everything begun by a process that is not talking any
 * more. This is the resume, and it is triggered by somebody looking rather than by a
 * timer, because there is no worker: opening the page is the event.
 */
export async function unattendedWork(projectId: number): Promise<string[]> {
  const rows = await raw<{ public_id: string }[]>`
    SELECT public_id FROM jobs
    WHERE project_id = ${projectId}
      AND type = ANY(${[...AGENT_JOBS]}::job_type[])
      AND attempts < max_attempts
      AND (
        status = 'pending'
        OR (status = 'claimed' AND claimed_at < now() - ${ABANDON_AFTER}::interval)
      )
    ORDER BY created_at
    LIMIT 4
  `;
  return rows.map((row) => row.public_id);
}

/**
 * One string that changes when the work does.
 *
 * What the browser polls. The page is server-rendered like everything else here, so
 * the only way a transcript grows on screen is `router.refresh()` -- and refreshing on
 * a timer regardless would re-render the route tree all afternoon to confirm nothing
 * had happened. So the poller wants the smallest possible answer to *has anything
 * moved*, and this is it.
 *
 * Two numbers, because either one alone would miss something: the count catches a job
 * starting or finishing, and the newest note catches a job that is still running and
 * has said something new. Both are scoped to work that is still in flight, which is
 * what makes the answer stable at rest -- an idle project returns `0:0` forever, and
 * the poller stops refreshing rather than following a number that keeps climbing.
 */
export async function workMark(projectId: number): Promise<string> {
  const [row] = await raw<{ mark: string }[]>`
    SELECT count(*)::text || ':' || coalesce((
      SELECT max(e.id) FROM job_events e
      JOIN jobs a ON a.id = e.job_id
      WHERE a.project_id = ${projectId} AND a.status IN ('pending', 'claimed')
    ), 0)::text AS mark
    FROM jobs j
    WHERE j.project_id = ${projectId}
      AND j.type = ANY(${[...AGENT_JOBS]}::job_type[])
      AND j.status IN ('pending', 'claimed')
  `;
  return row?.mark ?? '0:0';
}

/** How many things are on the go, for the badge in the sidebar. */
export async function workRunning(projectId: number): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobs)
    .where(
      and(
        eq(jobs.projectId, projectId),
        /* `inArray` and not ``sql`= ANY(${arr})` ``: drizzle expands a JS array inside an
           `sql` template into a comma-separated parameter list, so `ANY` receives three
           scalars and Postgres refuses with *requires array on right side*. The `raw`
           postgres.js queries above bind a real array and keep their explicit
           `::job_type[]` cast; the two template kinds are not interchangeable. */
        inArray(jobs.type, [...AGENT_JOBS]),
        sql`${jobs.status} IN ('pending', 'claimed')`,
      ),
    );
  return count;
}
