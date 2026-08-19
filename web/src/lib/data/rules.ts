import { cache } from 'react';
import { currentScope } from '@/lib/db/scope';
import { listRules, toTestingRule } from '@/lib/db/rules';
import type { TestingRule } from '@/lib/mock/types';

/**
 * The current project's rules. Four screens read this while rendering one page --
 * the rules table, the summary card, a plan's applied-rules panel and the drawer --
 * so it is memoized per request rather than asked four times.
 *
 * Empty for a developer with no rules yet, which is a real state: the rules screen
 * has copy for it, and a draft with no rules is still a draft.
 */
export const getRules = cache(async (): Promise<TestingRule[]> => {
  const scope = await currentScope();
  if (!scope) return [];
  return (await listRules(scope.projectId)).map(toTestingRule);
});
