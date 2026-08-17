import type { CoverageState } from '@/lib/mock/types';

export const COVERAGE_FILL: Record<CoverageState, string> = {
  approved: 'bg-pass',
  draft: 'bg-warn',
  failing: 'bg-fail',
  none: 'bg-rule-strong',
};

export const COVERAGE_LABEL: Record<CoverageState, string> = {
  approved: 'Approved plan',
  draft: 'Needs review',
  failing: 'Failing',
  none: 'No plan yet',
};

export const COVERAGE_TONE: Record<CoverageState, 'pass' | 'warn' | 'fail' | 'skip'> = {
  approved: 'pass',
  draft: 'warn',
  failing: 'fail',
  none: 'skip',
};

export const COVERAGE_ORDER: CoverageState[] = ['approved', 'draft', 'failing', 'none'];

/** What to do next about an endpoint in each state, in the product's own words. */
export const COVERAGE_NEXT: Record<CoverageState, string> = {
  approved: 'Covered and approved. Nothing to decide here.',
  draft: 'A draft is waiting on you before this counts as covered.',
  failing: 'The last run of this broke. Read it before anything else.',
  none: 'Nothing covers this yet.',
};
