'use server';

import { revalidatePath } from 'next/cache';
import { requireScope } from '@/lib/db/scope';
import { enqueueIndex } from '@/lib/db/jobs';

/**
 * "Read it again" — queue a fresh index pass on the developer's machine.
 *
 * The web app cannot read code; the CLI does, on the next poll (two seconds
 * when idle). Queueing twice is not an error: a pass already in flight answers
 * the click. Both pages that can ask revalidate, so the button becomes the
 * waiting state without a navigation.
 */
export async function requestReindexAction(): Promise<void> {
  const scope = await requireScope();
  await enqueueIndex(scope.projectId, scope.userId);
  revalidatePath('/dashboard/codebase');
  revalidatePath('/dashboard/settings/project');
}
