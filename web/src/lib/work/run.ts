import { revalidatePath } from 'next/cache';
import { record } from '@/lib/db/audit';
import { answeredIn, conversationHistory, findConversation, historyBefore } from '@/lib/db/conversations';
import { PlanArchivedError, PlanMovedError, writeNewPlan, writeRevision } from '@/lib/db/drafts';
import { planDetail } from '@/lib/db/plans';
import { listRules, toTestingRule } from '@/lib/db/rules';
import { failWork, holdWork, recorder, settleWork } from '@/lib/db/work';
import {
  CliUnavailableError,
  NoModelKeyError,
  askAgent,
  draftPlan,
  priorFindingsOf,
  refinePlan,
} from '@/lib/agent';
import type { Held, Recorder } from '@/lib/db/work';

/**
 * The runner: one job, start to finish.
 *
 * The only module that imports both the record and the agent, which is what keeps
 * `db/work.ts` free of the model and `agent/` free of Postgres. Everything above it
 * -- an action that enqueued something, a page that noticed something unattended --
 * calls `runWork(id)` and nothing else.
 *
 * There is no worker process and no polling. Work starts in `after()` on the request
 * that asked for it, so it begins immediately and outlives the response, and it is
 * started again by whoever next opens the work page. That is the whole scheduler, and
 * it is deliberate: a resident worker is a deployment shape to choose once, not one to
 * guess at while the idea is being validated.
 */

/**
 * Do the work, or find out somebody else already is.
 *
 * Never throws. A caller is either `after()`, where a rejection is an unhandled
 * promise in a request that has already answered, or a page render, where it would
 * take the page down over a job -- and the failure is a row either way, which is the
 * whole point of the table.
 */
export async function runWork(jobPublicId: string): Promise<void> {
  let job: Held | null = null;
  try {
    job = await holdWork(jobPublicId);
  } catch (error) {
    console.error('work: could not claim a job', error);
    return;
  }
  /* Null is the ordinary answer, not an error: somebody else holds it, or it is
     already finished, or it has been tried as often as it is allowed to be. Two page
     loads a second apart both call this, and exactly one of them works. */
  if (!job) return;

  const watch = recorder(job);
  try {
    const done = await carryOut(job, watch);
    watch.note({ phase: 'save', kind: 'note', label: done.note });
    await settleWork(job, { href: done.href, note: done.note });
    refresh(done.revalidate);
  } catch (error) {
    const why = readable(error);
    watch.note({ phase: 'save', kind: 'failed', label: why });
    await failWork(job, why).catch((second: unknown) => {
      console.error('work: could not record a failure', second);
    });
  } finally {
    /* The barrier. Notes are written without being awaited so that recording what
       the agent did never slows the agent down, which leaves inserts in flight at
       exactly the moment the job is marked finished -- and a completed job whose
       transcript never landed is a page showing the end of a story with the middle
       missing. */
    await watch.settled();
  }
}

/** What a finished job produced: where it lives, what to say about it, what went stale. */
type Done = { href: string; note: string; revalidate: string[] };

/**
 * Which work this is.
 *
 * The payload is read here rather than validated at the boundary, because the shapes
 * are this module's business on both sides: it wrote them into the queue and it is
 * the only thing that reads them back. A field missing means a caller and this
 * function disagree, which is a bug to see rather than a state to handle.
 */
async function carryOut(job: Held, watch: Recorder): Promise<Done> {
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  const userId = job.requestedBy;
  if (userId === null) {
    throw new Error('This work has no requester, so there is nobody to write it for.');
  }

  switch (job.type) {
    case 'draft_plan':
      return draftJob(job, watch, payload, userId);
    case 'refine_plan':
      return refineJob(job, watch, payload, userId);
    case 'answer_question':
      return answerJob(job, watch, payload);
    default:
      /* A machine job in this queue means `claimNextJob`'s type filter and
         `AGENT_JOBS` disagree, which is worth saying rather than silently dropping. */
      throw new Error(`This machine does not know how to do ${job.type} work.`);
  }
}

/** A field the payload has to carry, or the two halves of this module disagree. */
function text(payload: Record<string, unknown>, name: string): string {
  const value = payload[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`This work is missing its ${name}, so it cannot be done.`);
  }
  return value;
}

function maybe(payload: Record<string, unknown>, name: string): string | undefined {
  const value = payload[name];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * The address of whoever asked, carried in the payload rather than read here.
 *
 * `headers()` is not callable inside `after()` on a Server Component's path, and it
 * would be the wrong answer anyway: the request that matters is the one that clicked
 * the button, which may have finished minutes ago and may have been on a different
 * machine to the one that picked the job up.
 */
function askedFrom(payload: Record<string, unknown>): string | undefined {
  return maybe(payload, 'ip');
}

/** A plan from a brief, and the conversation it came out of when there was one. */
async function draftJob(
  job: Held,
  watch: Recorder,
  payload: Record<string, unknown>,
  userId: number,
): Promise<Done> {
  const brief = text(payload, 'brief');
  const baseUrl = text(payload, 'baseUrl');
  const name = maybe(payload, 'name');
  const threadId = maybe(payload, 'conversation');

  const rules = (await listRules(job.projectId)).map(toTestingRule);

  /* Resolved here rather than carried as an internal id, so a thread deleted between
     the click and the work is a named failure instead of a foreign key violation. */
  const conversation = threadId ? await findConversation(job.projectId, threadId) : null;
  if (threadId && !conversation) {
    throw new Error('That conversation is not in this project any more.');
  }

  const priorFindings = conversation
    ? priorFindingsOf(await conversationHistory(conversation.id))
    : undefined;

  const draft = await draftPlan({ brief, baseUrl, name, rules, priorFindings, watch });

  const written = await writeNewPlan({
    projectId: job.projectId,
    userId,
    baseUrl,
    instruction: brief,
    ...(conversation ? { conversationId: conversation.id } : {}),
    draft,
    checks: draft.checks,
  });

  await record({
    userId,
    action: 'test_plan.drafted',
    entityType: 'test_plans',
    entityId: written.planId,
    values: {
      name: written.name,
      steps: draft.steps.length,
      model: draft.modelLabel,
      ...(conversation ? { from: 'conversation' } : {}),
    },
    ip: askedFrom(payload),
    /* The click, not the finish. An audit row timestamped when the model happened to
       return would put a plan somebody asked for at 16:01 into the timeline at 16:04,
       between things that came after it. */
    at: job.requestedAt,
  });

  return {
    href: `/dashboard/test-plans/${written.publicId}`,
    note: `Wrote "${written.name}" — ${draft.steps.length} ${draft.steps.length === 1 ? 'step' : 'steps'}.`,
    revalidate: [
      '/dashboard',
      '/dashboard/queue',
      '/dashboard/test-plans',
      '/dashboard/settings/activity',
      ...(conversation
        ? ['/dashboard/conversations', `/dashboard/conversations/${conversation.publicId}`]
        : []),
    ],
  };
}

/** The next version of a plan that already exists. */
async function refineJob(
  job: Held,
  watch: Recorder,
  payload: Record<string, unknown>,
  userId: number,
): Promise<Done> {
  const publicId = text(payload, 'plan');
  const instruction = text(payload, 'instruction');

  /* Read here rather than carried in the payload, and that is the load-bearing part:
     `fromVersion` has to be the version the agent was actually shown, so a plan
     revised twice in a row refuses the second write instead of overwriting the
     first. Enqueue-time state would make the check pass and the plan wrong. */
  const detail = await planDetail(job.projectId, publicId);
  if (!detail) throw new Error('That plan is not in this project any more.');

  const rules = (await listRules(job.projectId)).map(toTestingRule);
  const draft = await refinePlan({ detail, instruction, rules, watch });

  const written = await writeRevision({
    projectId: job.projectId,
    userId,
    planPublicId: publicId,
    fromVersion: detail.version,
    instruction,
    draft,
    checks: draft.checks,
  });

  await record({
    userId,
    action: 'test_plan.revised',
    entityType: 'test_plans',
    entityId: written.planId,
    values: { name: draft.name, version: written.version, model: draft.modelLabel },
    ip: askedFrom(payload),
    at: job.requestedAt,
  });

  return {
    href: `/dashboard/test-plans/${publicId}`,
    note: `Wrote v${written.version} of "${draft.name}".`,
    revalidate: [
      '/dashboard',
      '/dashboard/queue',
      '/dashboard/test-plans',
      `/dashboard/test-plans/${publicId}`,
      '/dashboard/settings/activity',
    ],
  };
}

/**
 * One turn of a conversation.
 *
 * The question is already a row, written by the action so the thread exists while the
 * agent reads. `seq` came with it, which is what lets the answer land in the slot
 * after its own question rather than after whatever is last -- two people asking in
 * one thread would otherwise cross their answers over.
 */
async function answerJob(
  job: Held,
  watch: Recorder,
  payload: Record<string, unknown>,
): Promise<Done> {
  const threadId = text(payload, 'conversation');
  const question = text(payload, 'question');
  const seq = payload.seq;
  if (typeof seq !== 'number') {
    throw new Error('This question has no place in its thread, so it cannot be answered.');
  }

  const conversation = await findConversation(job.projectId, threadId);
  if (!conversation) throw new Error('That conversation is not in this project any more.');

  watch.note({ phase: 'research', kind: 'note', label: 'Reading the code.' });
  const history = await historyBefore(conversation.id, seq);
  const answer = await askAgent({ question, history, watch });

  await answeredIn({ conversationId: conversation.id, seq, answer });

  /* No audit row, which matches what the blocking version did. The activity timeline
     phrases a row from `entity_type`, and it has no vocabulary for a conversation --
     inventing one here would be a second feature riding along on this one. The
     exchange is already a pair of rows somebody can read. */

  return {
    href: `/dashboard/conversations/${conversation.publicId}`,
    note: 'Answered.',
    revalidate: ['/dashboard/conversations', `/dashboard/conversations/${conversation.publicId}`],
  };
}

/**
 * Redraw what the work changed.
 *
 * Best-effort, and it has to be: `revalidatePath` is documented for actions and route
 * handlers, and this runs inside `after()` where the request it belonged to has
 * already answered. Every one of these pages reads cookies through `requireScope()`,
 * so they are dynamically rendered and there is no full-route cache entry to be
 * stale -- what a failed call costs is a client Router Cache entry that a navigation
 * refreshes anyway. Not worth failing a finished job over.
 */
function refresh(paths: string[]): void {
  /* Always, because the work page is what the developer is looking at. */
  for (const path of ['/dashboard/work', ...paths]) {
    try {
      revalidatePath(path);
    } catch (error) {
      console.warn(`work: could not revalidate ${path}`, error);
    }
  }
}

/**
 * The failure, in the words of what to do about it.
 *
 * The same sentences the blocking actions used to return, because they are the same
 * conditions -- a developer who saw one of these in a form should read the identical
 * line on the work page rather than wonder if it is a different problem. The
 * difference is where it lands: a row that stays there, instead of a message under a
 * button they may have navigated away from.
 */
function readable(error: unknown): string {
  if (error instanceof NoModelKeyError) {
    return 'No model key yet, so there was nothing to do this with. Add one in Settings → AI.';
  }
  if (error instanceof CliUnavailableError) {
    console.error('agent: research unavailable', error.detail);
    return 'GritQA could not reach the research server on your machine, so it had no way to read the code. Start it and ask again.';
  }
  if (error instanceof PlanMovedError) {
    return 'The plan changed while this was being written, so the new version was not saved. Ask again from the plan as it stands.';
  }
  if (error instanceof PlanArchivedError) {
    return 'That plan is archived. Copy it into a new plan to take it further.';
  }
  /* A provider's own error text is written for whoever wired the provider up, and it
     is the one place a request id or a key fragment could turn up in something a
     browser renders. So the log gets it and the row gets a sentence. */
  console.error('work: could not finish', error);
  return 'The model did not come back with something usable. Ask again, or say it a different way.';
}
