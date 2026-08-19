import { recentRuns, runHistory, runStripStats } from '@/lib/mock/data';
import type { RunHistoryEntry, TestExecution } from '@/lib/mock/types';

/** Totals across every run on record. Becomes an aggregate query, hence the read. */
export type RunStripStats = typeof runStripStats;

export async function getRecentRuns(): Promise<TestExecution[]> {
  return recentRuns;
}

export async function getRunHistory(): Promise<RunHistoryEntry[]> {
  return runHistory;
}

export async function getRunStripStats(): Promise<RunStripStats> {
  return runStripStats;
}
