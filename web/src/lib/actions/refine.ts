'use server';

import { after } from 'next/server';
import { clientIp } from '@/lib/client-ip';
import { requireScope } from '@/lib/db/scope';
import { planDetail } from '@/lib/db/plans';
import { enqueueWork } from '@/lib/db/work';
import { agentUnavailable } from '@/lib/work/ready';
import { runWork } from '@/lib/work/run';

/**
 * "Ask for a new version", connected to something.
 *
 * It used to write the version inside this request: a minute or so of model calls
 * with the button spinning, and the honest reason given for it was that the button
 * promises *writes v4 for you to read* -- a request and an answer rather than a
 * stream. That reasoning was about streaming, and it is still right about streaming.
 * It was never an argument for holding the request open.
 *
 * So the ask becomes queued work. What the developer gets back immediately is the
 * fact that it started, and v4 arrives on the plan page whether or not they stayed to
 * watch -- which is a better answer to the same promise, because the previous one
 * quietly depended on them not navigating away.
 */

/** Long enough for a paragraph, short enough that a paste accident is not a prompt. */
const MAX_INSTRUCTION = 2_000;

/**
 * What comes back from asking.
 *
 * `queued` carries the job's id rather than only a flag, and it earns its place: the
 * composer keys itself on it, so a second ask is a new field with the caret in it
 * instead of an effect that clears the old one. The version number cannot be in here
 * any more -- nothing knows it yet -- and that is the honest shape of the change.
 */
export type RefineState = null | { error: string } | { queued: true; job: string };

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
     the id exists. Read here as well as in the runner, for two different jobs: this
     one refuses an id that is already gone, so nobody watches a job fail for a
     reason the form could have said. The runner's read is the one that decides
     `fromVersion`, and it has to happen there. */
  const detail = await planDetail(scope.projectId, publicId);
  if (!detail) return { error: 'That plan is not in this project any more.' };

  const blocked = await agentUnavailable();
  if (blocked) return { error: blocked };

  const ip = await clientIp();

  const job = await enqueueWork({
    projectId: scope.projectId,
    userId: scope.userId,
    type: 'refine_plan',
    /* Named for the plan and the version being asked for, because the work page
       lists jobs across a project and "make the tax assertion stricter" on its own
       does not say which plan it is about. */
    label: `${detail.name} v${detail.version + 1}: ${instruction}`,
    request: { plan: publicId, instruction, ...(ip ? { ip } : {}) },
  });

  after(() => runWork(job));

  return { queued: true, job };
}
