import { cache } from 'react';
import { currentScope } from '@/lib/db/scope';
import { listCoverage } from '@/lib/db/coverage';
import type { CoverageFile, CoverageState } from '@/lib/model';

/** Endpoint counts by coverage state. Derived from `getCoverage`, so it cannot disagree. */
export type CoverageTotals = Record<CoverageState, number> & { total: number };

export const getCoverage = cache(async (): Promise<CoverageFile[]> => {
  const scope = await currentScope();
  if (!scope) return [];
  return listCoverage(scope.projectId);
});

export async function getCoverageTotals(): Promise<CoverageTotals> {
  const coverage = await getCoverage();
  return coverage
    .flatMap((file) => file.endpoints)
    .reduce<CoverageTotals>(
      (totals, endpoint) => ({
        ...totals,
        [endpoint.state]: totals[endpoint.state] + 1,
        total: totals.total + 1,
      }),
      { approved: 0, draft: 0, failing: 0, none: 0, total: 0 },
    );
}
