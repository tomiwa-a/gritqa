import { cache } from 'react';
import { currentScope } from '@/lib/db/scope';
import { observedRoutes } from '@/lib/db/contracts';
import type { ObservedRoute } from '@/lib/model';

/** Every endpoint this project has really called, for a form that would rather not guess. */
export const getObservedRoutes = cache(async (): Promise<ObservedRoute[]> => {
  const scope = await currentScope();
  if (!scope) return [];
  return observedRoutes(scope.projectId);
});
