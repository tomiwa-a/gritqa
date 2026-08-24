'use server';

import { observedCall } from '@/lib/db/contracts';
import { requireScope } from '@/lib/db/scope';
import type { ObservedCall } from '@/lib/model';

/**
 * One endpoint's last real call, fetched when somebody asks for it.
 *
 * An action rather than data on the page because of what it weighs: the editor lists
 * every route a project has exercised, and two JSON bodies per row would be a
 * megabyte of payload to draw a list somebody may not open. So the list comes with
 * the page and a body comes one at a time.
 *
 * Scoped like every other read: a route pattern belonging to another project is
 * simply not found, and the answer does not say whether it exists.
 */
export async function observedCallAction(
  method: string,
  path: string,
): Promise<ObservedCall | null> {
  const scope = await requireScope();
  return observedCall(scope.projectId, method.slice(0, 10), path.slice(0, 512));
}
