'use server';

import { after } from 'next/server';
import { redirect } from 'next/navigation';
import { clientIp } from '@/lib/client-ip';
import { requireScope } from '@/lib/db/scope';
import { enqueueWork } from '@/lib/db/work';
import { agentUnavailable } from '@/lib/work/ready';
import { runWork } from '@/lib/work/run';
import { WORK } from '@/lib/work/where';

/**
 * The generate wizard, connected to something.
 *
 * Step three has been a progress bar over nothing since it was built: every
 * transition in the modal was a `<Link>`, so "Draft it" moved the URL to
 * `g=drafting` and the animation ran for as long as you cared to watch it. This is
 * what it moves to instead.
 *
 * The action no longer drafts. It writes down what was asked for and hands the work
 * to the queue, which is a smaller change than it sounds and a much better shape: a
 * draft is a research pass, a write and a verify -- a minute or two of model calls --
 * and holding a request open for that made navigating away destructive. Now the click
 * lands on the work page, where the agent says what it is reading as it reads, and
 * closing the tab costs nothing.
 *
 * What is kept is the instant answer to the two failures that are settings rather
 * than surprises: no key, no machine. See `agentUnavailable`.
 */

/** A brief is a paragraph, not a pasted file. */
const MAX_BRIEF = 2_000;
const MAX_NAME = 120;

export type DraftState = null | { error: string };

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

  const blocked = await agentUnavailable();
  if (blocked) return { error: blocked };

  /* Read here, before the work is handed off. `headers()` cannot be called inside
     `after()` on every path, and the address that belongs on the audit row is the one
     that clicked the button rather than whichever request happens to pick the job up
     later. So it travels in the payload. */
  const ip = await clientIp();

  const jobId = await enqueueWork({
    projectId: scope.projectId,
    userId: scope.userId,
    type: 'draft_plan',
    /* What the row on the work page says. The name if they gave one, because it is
       what they will look for; the brief otherwise, because it is what they said. */
    label: name ?? brief,
    request: { brief, baseUrl, ...(name ? { name } : {}), ...(ip ? { ip } : {}) },
  });

  /* Starts now and outlives this response, so the developer is not waiting on it and
     is not required to stay for it either. If this process dies mid-draft the row is
     still `claimed` and still has attempts left, and opening the work page picks it
     up. */
  after(() => runWork(jobId));

  /* Outside any try, because `redirect` works by throwing and a catch around it would
     read the navigation as a failed draft. */
  redirect(WORK);
}
