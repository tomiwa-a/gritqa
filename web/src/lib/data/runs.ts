import { cache } from 'react';
import { currentScope } from '@/lib/db/scope';
import { executionHistory, recentExecutions, stripStatsOf } from '@/lib/db/runs';
import type { RunHistoryEntry, TestExecution } from '@/lib/model';

export type { RunStripStats } from '@/lib/db/runs';

/**
 * The newest runs, with a step-by-step report each.
 *
 * Six because that is what the run list shows above the strip, not because only six
 * have their steps recorded -- every execution does. Reading all thirty in the
 * window would mean several hundred result rows to render columns that need one
 * character apiece.
 */
export const getRecentRuns = cache(async (): Promise<TestExecution[]> => {
  const scope = await currentScope();
  if (!scope) return [];
  return recentExecutions(scope.projectId);
});

export const getRunHistory = cache(async (): Promise<RunHistoryEntry[]> => {
  const scope = await currentScope();
  if (!scope) return [];
  return executionHistory(scope.projectId);
});

/**
 * Totals across the strip, derived from the same cells it draws. Cheap because
 * `getRunHistory` is cached for the render, so this does not read anything twice.
 */
export async function getRunStripStats() {
  return stripStatsOf(await getRunHistory());
}
