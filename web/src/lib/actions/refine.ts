'use server';

import { revalidatePath } from 'next/cache';
import { clientIp } from '@/lib/client-ip';
import { record } from '@/lib/db/audit';
import { PlanArchivedError, PlanMovedError, writeRevision } from '@/lib/db/drafts';
import { requireScope } from '@/lib/db/scope';
import { planDetail } from '@/lib/db/plans';
import { listRules, toTestingRule } from '@/lib/db/rules';
import { CliUnavailableError, NoModelKeyError, refinePlan } from '@/lib/agent';

/**
 * "Ask for a new version", connected to something.
 *
 * The composer has been submitting into nothing since it was built, and this is
 * where it lands. A server action rather than a streaming route, because of what the
 * button promises: *writes v4 for you to read*. That is a request and an answer, and
 * a token stream would be a different product -- watching a plan get typed instead
 * of being handed the version to read. Streaming belongs to the generate wizard,
 * where there is no v3 to compare against and the waiting is the whole experience.
 *
 * It is slow on purpose. The agent reads the developer's actual code before it
 * writes, which takes as long as it takes, and the alternative is a fast answer
 * about code it guessed at.
 */

/** Long enough for a paragraph, short enough that a paste accident is not a prompt. */
const MAX_INSTRUCTION = 2_000;

export type RefineState = null | { error: string } | { ok: true; version: number; summary: string };

/**
 * Everything a new version changes on screen.
 *
 * The status line is in here because a revision can move one: an approved plan
 * drops back to `draft`, so the queue loses a row and the badge changes -- and a
 * page still showing `Approved` beside v4 would be describing v3.
 */
function revalidateRevision(planPublicId: string): void {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/queue');
  revalidatePath('/dashboard/test-plans');
  revalidatePath(`/dashboard/test-plans/${planPublicId}`);
  revalidatePath('/dashboard/settings/activity');
}

/**
 * The failures worth naming, in the words of what to do about them.
 *
 * Each of these is a state the developer can act on rather than an error report:
 * two of them are a thing that is not switched on yet, and one is a page that has
 * gone stale. Anything else falls through to the last line, which says the model
 * did not produce a usable plan and does not pretend to know why.
 */
function readable(error: unknown): string {
  if (error instanceof NoModelKeyError) {
    return 'No model key yet, so there is nothing to draft with. Add one in Settings → AI.';
  }
  if (error instanceof CliUnavailableError) {
    return 'GritQA could not reach your machine, so it has no way to read the code. Start the CLI and ask again.';
  }
  if (error instanceof PlanMovedError) {
    return 'This plan changed while you were reading it. Reload the page and ask again.';
  }
  if (error instanceof PlanArchivedError) {
    return 'This plan is archived. Copy it into a new plan to take it further.';
  }
  /* Logged rather than shown. A provider's own error text is written for whoever
     wired the provider up, and it is the one place a request id or a key fragment
     could turn up in something a browser renders. */
  console.error('refine: could not produce a revision', error);
  return 'The model did not come back with a usable plan. Try asking again, or say it a different way.';
}

export async function refinePlanAction(
  _previous: RefineState,
  formData: FormData,
): Promise<RefineState> {
  const publicId = String(formData.get('publicId') ?? '')
    .trim()
    .slice(0, 64);
  const instruction = String(formData.get('refine') ?? '')
    .trim()
    .slice(0, MAX_INSTRUCTION);

  if (!publicId) return { error: 'Reload the page and try again.' };
  if (!instruction) return { error: 'Say what should change first.' };

  const scope = await requireScope();

  /* Read through the scope, so a plan belonging to someone else is simply not
     found -- the same answer the detail page gives, and one that does not confirm
     the id exists. */
  const detail = await planDetail(scope.projectId, publicId);
  if (!detail) return { error: 'That plan is not in this project any more.' };

  const rules = (await listRules(scope.projectId)).map(toTestingRule);

  try {
    const draft = await refinePlan({ detail, instruction, rules });

    /* `detail.version` is the version the agent was shown, and it is passed through
       rather than re-read: it is what makes the write refuse if somebody else
       revised the plan while this draft was being written. */
    const written = await writeRevision({
      projectId: scope.projectId,
      userId: scope.userId,
      planPublicId: publicId,
      fromVersion: detail.version,
      instruction,
      draft,
    });

    await record({
      userId: scope.userId,
      action: 'test_plan.revised',
      entityType: 'test_plans',
      entityId: written.planId,
      /* The model's name, never its key, and not the transcript either -- the
         instruction is already on the revision row, where the developer can read
         it back. */
      values: { name: draft.name, version: written.version, model: draft.modelLabel },
      ip: await clientIp(),
    });

    revalidateRevision(publicId);
    return { ok: true, version: written.version, summary: draft.summary };
  } catch (error) {
    return { error: readable(error) };
  }
}
