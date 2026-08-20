import { cache } from 'react';
import { currentScope } from '@/lib/db/scope';
import { draftedShas, listCommits } from '@/lib/db/commits';
import { undraftedFrom } from '@/lib/commits';
import type { Commit } from '@/lib/mock/types';

/** The project's history, newest first. Pushed by the CLI alongside the index. */
export const getCommits = cache(async (): Promise<Commit[]> => {
  const scope = await currentScope();
  if (!scope) return [];
  return listCommits(scope.projectId);
});

/**
 * The oldest commit nothing has been drafted for — where "what moved" starts reading.
 *
 * Derived from the two tables rather than stored, because a column for it would be a
 * third answer that can disagree with the plans and the history it is computed from.
 * Empty string when the project has no commits: `resolveFrom` treats it as a hash
 * matching nothing, and the wizard already renders a history of none.
 */
export const getLastDraftedFrom = cache(async (): Promise<string> => {
  const scope = await currentScope();
  if (!scope) return '';
  const [history, drafted] = await Promise.all([getCommits(), draftedShas(scope.projectId)]);
  return undraftedFrom(history, drafted) ?? '';
});
