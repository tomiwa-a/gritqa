import { commits, lastDraftedFrom, pendingChanges } from '@/lib/mock/data';
import type { Commit, PlanDiffContext } from '@/lib/mock/types';

/**
 * The project's history, newest first. There is no table for this yet — the schema
 * keeps one diff blob per plan, so a project's history has nowhere to live and a
 * commit cannot be looked up by hash. Both are needed to draft from a range.
 */
export async function getCommits(): Promise<Commit[]> {
  return commits;
}

/** The oldest commit nothing has been drafted for — where "what moved" starts reading. */
export async function getLastDraftedFrom(): Promise<string> {
  return lastDraftedFrom;
}

export async function getPendingChanges(): Promise<PlanDiffContext | null> {
  return pendingChanges;
}
