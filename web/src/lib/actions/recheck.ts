'use server';

import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { requireScope } from '@/lib/db/scope';
import { enqueueWork } from '@/lib/db/work';
import { runWork } from '@/lib/work/run';
import { WORK } from '@/lib/work/where';

/**
 * Look again at one step: queue a focused recheck that merges a fresh verdict
 * into the plan's existing checks. A refine job with a step pinned to it —
 * same queue, same version lock, a narrower turn — so it lands on the work
 * page like every other long read.
 */
export async function requestRecheckAction(formData: FormData): Promise<void> {
  const plan = String(formData.get('plan') ?? '').trim().slice(0, 64);
  const step = String(formData.get('step') ?? '').trim().slice(0, 64);
  if (!plan || !step) return;

  const scope = await requireScope();

  const job = await enqueueWork({
    projectId: scope.projectId,
    userId: scope.userId,
    type: 'refine_plan',
    label: 'Recheck a step',
    request: { plan, recheckStep: step },
  });

  after(() => runWork(job));
  redirect(WORK);
}
