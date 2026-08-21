'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { clientIp } from '@/lib/client-ip';
import { record } from '@/lib/db/audit';
import { writeNewPlan } from '@/lib/db/drafts';
import { requireScope } from '@/lib/db/scope';
import { listRules, toTestingRule } from '@/lib/db/rules';
import { CliUnavailableError, NoModelKeyError, draftPlan } from '@/lib/agent';

/**
 * The generate wizard, connected to something.
 *
 * Step three has been a progress bar over nothing since it was built: every
 * transition in the modal was a `<Link>`, so "Draft it" moved the URL to
 * `g=drafting` and the animation ran for as long as you cared to watch it. This is
 * what it moves to instead.
 *
 * A server action rather than a stream, for now, and the honest version of why: a
 * stream would show the plan being written, which is a better experience and a
 * bigger build -- a route handler, a client reader, a partial-plan renderer, and a
 * writer that runs after the last chunk instead of inside a transaction. The data
 * path is the same either way, so it can be put in front of this later without
 * moving anything. What the developer loses in the meantime is watching it happen;
 * what they do not lose is the plan, which lands whole and already saved.
 */

/** A brief is a paragraph, not a pasted file. */
const MAX_BRIEF = 2_000;
const MAX_NAME = 120;

export type DraftState = null | { error: string };

/**
 * The failures worth naming, in the words of what to do about them.
 *
 * Deliberately the same three as `refine.ts`, because they are the same three
 * conditions and a developer who has seen one of these sentences on the plan page
 * should read the identical sentence here rather than wonder if it is a different
 * problem.
 */
function readable(error: unknown): string {
  if (error instanceof NoModelKeyError) {
    return 'No model key yet, so there is nothing to draft with. Add one in Settings → AI.';
  }
  if (error instanceof CliUnavailableError) {
    /* Logged, unlike the other named failures, because `detail` carries the address
       that did not answer and the reason -- and this is the one condition a developer
       has to fix rather than read. */
    console.error('agent: research unavailable', error.detail);
    return 'GritQA could not reach the research server on your machine, so it has no way to read the code. That is a separate channel from the job poller, so a connected machine can still be missing it — start it and ask again.';
  }
  console.error('generate: could not produce a plan', error);
  return 'The model did not come back with a usable plan. Try saying it a different way.';
}

/** A plan records where it will run, so a typo here would be stored as fact. */
function cleanBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export async function draftPlanAction(
  _previous: DraftState,
  formData: FormData,
): Promise<DraftState> {
  const brief = String(formData.get('brief') ?? '')
    .trim()
    .slice(0, MAX_BRIEF);
  const name =
    String(formData.get('name') ?? '')
      .trim()
      .slice(0, MAX_NAME) || undefined;
  const baseUrl = cleanBaseUrl(String(formData.get('baseUrl') ?? '').trim());

  if (!brief) return { error: 'Say what the plan should prove first.' };
  if (!baseUrl)
    return { error: 'That address is not a URL GritQA can call. Try http://localhost:8080.' };

  const scope = await requireScope();
  const rules = (await listRules(scope.projectId)).map(toTestingRule);

  let written: Awaited<ReturnType<typeof writeNewPlan>>;
  try {
    const draft = await draftPlan({ brief, baseUrl, name, rules });

    written = await writeNewPlan({
      projectId: scope.projectId,
      userId: scope.userId,
      baseUrl,
      /* The brief is the instruction, and storing it is what makes the plan's own
         page able to open with the sentence that produced it. */
      instruction: brief,
      draft,
    });

    await record({
      userId: scope.userId,
      action: 'test_plan.drafted',
      entityType: 'test_plans',
      entityId: written.planId,
      values: { name: written.name, steps: draft.steps.length, model: draft.modelLabel },
      ip: await clientIp(),
    });
  } catch (error) {
    return { error: readable(error) };
  }

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/queue');
  revalidatePath('/dashboard/test-plans');
  revalidatePath('/dashboard/settings/activity');

  /* Outside the try, because `redirect` works by throwing and a catch around it
     would read the navigation as a failed draft. */
  redirect(`/dashboard/test-plans/${written.publicId}`);
}
