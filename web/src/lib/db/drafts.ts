import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { planRevisions, testPlans } from '@/lib/db/schema';
import type { PlanDraft, RevisionDraft } from '@/lib/agent/plan-schema';
import type { StepCheck } from '@/lib/model';

/**
 * Landing a new version of a plan.
 *
 * `plan_revisions` has been read since W3 -- `planDetail` joins it, the thread on
 * the detail page replays it -- and written by nothing. This is the writer, and it
 * is the only one: a version that exists without a row here is a plan that changed
 * for no recorded reason, which is the thing that table was added to prevent.
 *
 * All of it in one transaction, because the three writes are one fact. A bumped
 * version with no revision row is a silent change; a revision row against a plan
 * whose body did not move describes a change that did not happen.
 */

/**
 * Two writers raced, and the loser is told so rather than having its work applied
 * on top of a plan it never read.
 *
 * This is what `CAP.md` means by optimistic locking on `version`: the refine that
 * started from v3 may only produce v4, and if the plan is already at v4 by the time
 * it finishes then somebody else's v4 is there and this draft is answering a
 * question about text that has moved.
 */
export class PlanMovedError extends Error {
  readonly code = 'PLAN_MOVED';
  constructor(readonly expected: number) {
    super(`PLAN_MOVED: the plan is no longer at v${expected}.`);
    this.name = 'PlanMovedError';
  }
}

/** An archived plan is one somebody retired. Revising it is almost certainly a mistake. */
export class PlanArchivedError extends Error {
  readonly code = 'PLAN_ARCHIVED';
  constructor() {
    super('PLAN_ARCHIVED: this plan is archived. Restore it before revising it.');
    this.name = 'PlanArchivedError';
  }
}

export type WrittenRevision = { planId: number; version: number; status: 'draft' };

export async function writeRevision(input: {
  projectId: number;
  userId: number;
  planPublicId: string;
  /** The version the draft was written against. */
  fromVersion: number;
  /** The sentence the developer typed. Null when the agent redrafted unasked. */
  instruction: string | null;
  draft: RevisionDraft;
  /**
   * How each step came out when it was checked against the code. Written with the plan
   * rather than beside it, because a verdict outlives the turn that produced it and has
   * to move when the steps move: a hand edit that rewrites step 4 keeps the checks it
   * did not touch and drops the one it invalidated (`checksAfter` in `plan-edit.ts`).
   * Omitted reads as unverified, which is what every plan was before this existed.
   */
  checks?: StepCheck[];
}): Promise<WrittenRevision> {
  const next = input.fromVersion + 1;

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: testPlans.id, version: testPlans.version, status: testPlans.status })
      .from(testPlans)
      .where(
        and(eq(testPlans.projectId, input.projectId), eq(testPlans.publicId, input.planPublicId)),
      )
      .limit(1);

    /* Scoped by project, so a plan belonging to someone else reads as absent rather
       than as forbidden -- the same answer the read side gives. */
    if (!current) throw new Error('no such plan in this project');
    if (current.status === 'archived') throw new PlanArchivedError();
    if (current.version !== input.fromVersion) throw new PlanMovedError(input.fromVersion);

    const [moved] = await tx
      .update(testPlans)
      .set({
        name: input.draft.name,
        description: input.draft.description,
        version: next,
        /* Back to draft, always. Approval is approval of a particular text, and this
           is different text -- an approved plan that silently stayed approved through
           a rewrite would be a plan running something nobody read. Already-draft
           plans are unaffected, which is the common case. */
        status: 'draft',
        planJson: {
          variables: input.draft.variables,
          covers: input.draft.covers,
          steps: input.draft.steps,
          assumptions: input.draft.assumptions,
          checks: input.checks ?? [],
        },
      })
      /* The version predicate again, this time as the lock. The SELECT above is for
         the error message; this is what makes it true -- two transactions that read
         v3 concurrently cannot both write v4, because the second finds no row. */
      .where(and(eq(testPlans.id, current.id), eq(testPlans.version, input.fromVersion)))
      .returning({ id: testPlans.id });

    if (!moved) throw new PlanMovedError(input.fromVersion);

    await tx.insert(planRevisions).values({
      testPlanId: current.id,
      version: next,
      /* Who *asked*, not who wrote: the thread renders one row as two turns, and the
         summary turn is always GritQA's. So `human` is a refinement somebody
         requested and `agent` is one it took upon itself, which is also what the
         table's CHECK encodes. */
      author: input.instruction ? 'human' : 'agent',
      instruction: input.instruction,
      summary: input.draft.summary,
      changes: input.draft.changes,
      createdBy: input.userId,
    });

    return { planId: current.id, version: next, status: 'draft' as const };
  });
}

export type WrittenPlan = { planId: number; publicId: string; name: string };

/**
 * A plan that did not exist a moment ago, and its first revision row.
 *
 * One transaction for the same reason `writeRevision` is one: the plan and the
 * account of where it came from are a single fact. A plan with no v1 revision would
 * be a plan nobody can find out the origin of, which is precisely what the table
 * was added to prevent -- and here the origin is the developer's own sentence, so
 * losing it loses the only record of what they asked for.
 *
 * `author` follows the same rule as a refinement: who *asked*, not who wrote. A
 * developer who typed a brief is a `human` turn with their words on it, which is
 * what makes the thread on the detail page open with the request instead of a
 * reconstruction of it. An unattended draft is `agent` with no instruction, which
 * the table's CHECK allows and the thread renders as GritQA speaking first.
 */
export async function writeNewPlan(input: {
  projectId: number;
  userId: number;
  baseUrl: string;
  /** The developer's own words. Null when nobody typed anything. */
  instruction: string | null;
  /** The diff the draft was written from, when it came from one. */
  diffContext?: unknown;
  /**
   * The conversation this came out of, when it came out of one. `trigger_source`
   * stays `manual` either way -- a person still asked for it -- and this carries the
   * difference between typing a brief into the wizard and arriving at one by talking.
   */
  conversationId?: number;
  draft: PlanDraft;
  /**
   * How each step came out when it was checked against the code. Written with the plan
   * rather than beside it, because a verdict outlives the turn that produced it and has
   * to move when the steps move: a hand edit that rewrites step 4 keeps the checks it
   * did not touch and drops the one it invalidated (`checksAfter` in `plan-edit.ts`).
   * Omitted reads as unverified, which is what every plan was before this existed.
   */
  checks?: StepCheck[];
}): Promise<WrittenPlan> {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(testPlans)
      .values({
        projectId: input.projectId,
        name: input.draft.name,
        description: input.draft.description,
        baseUrl: input.baseUrl,
        planJson: {
          variables: input.draft.variables,
          covers: input.draft.covers,
          steps: input.draft.steps,
          assumptions: input.draft.assumptions,
          checks: input.checks ?? [],
        },
        /* Draft, and there is no other option. Nothing arrives approved -- the whole
           product is the gate between a plan existing and a plan running. */
        status: 'draft',
        version: 1,
        /* `manual` because a person asked for this one. `git_push` is for the drafts
           that appear on their own once the CLI is watching a branch. */
        triggerSource: 'manual',
        diffContext: input.diffContext ?? null,
        conversationId: input.conversationId ?? null,
      })
      .returning({ id: testPlans.id, publicId: testPlans.publicId, name: testPlans.name });

    await tx.insert(planRevisions).values({
      testPlanId: created.id,
      version: 1,
      author: input.instruction ? 'human' : 'agent',
      instruction: input.instruction,
      summary: input.draft.summary,
      /* Empty on purpose: a first version has nothing to have changed from. */
      changes: [],
      createdBy: input.userId,
    });

    return { planId: created.id, publicId: created.publicId, name: created.name };
  });
}
