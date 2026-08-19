import { coverage, coverageTotals } from '@/lib/mock/data';
import type { CoverageFile } from '@/lib/mock/types';

/** Endpoint counts by coverage state. Derived from `coverage` today, so it cannot disagree. */
export type CoverageTotals = typeof coverageTotals;

export async function getCoverage(): Promise<CoverageFile[]> {
  return coverage;
}

export async function getCoverageTotals(): Promise<CoverageTotals> {
  return coverageTotals;
}
