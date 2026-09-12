import type { CoverageState } from '@/lib/model';

export const COVERAGE_FILL: Record<CoverageState, string> = {
  approved: 'bg-pass',
  draft: 'bg-warn',
  failing: 'bg-fail',
  none: 'bg-rule-strong',
  tested: 'bg-info',
  invalid: 'bg-series-4',
};

export const COVERAGE_LABEL: Record<CoverageState, string> = {
  approved: 'Approved plan',
  draft: 'Needs review',
  failing: 'Failing',
  none: 'No plan yet',
  tested: 'Proven, uncovered',
  invalid: 'Not a real endpoint',
};

export const COVERAGE_TONE: Record<CoverageState, 'pass' | 'warn' | 'fail' | 'skip' | 'tested' | 'invalid'> = {
  approved: 'pass',
  draft: 'warn',
  failing: 'fail',
  none: 'skip',
  tested: 'tested',
  invalid: 'invalid',
};

export const COVERAGE_ORDER: CoverageState[] = ['approved', 'draft', 'failing', 'none', 'tested', 'invalid'];

/** What to do next about an endpoint in each state, in the product's own words. */
export const COVERAGE_NEXT: Record<CoverageState, string> = {
  approved: 'Covered and approved. Nothing to decide here.',
  draft: 'A draft is waiting on you before this counts as covered.',
  failing: 'The last run of this broke. Read it before anything else.',
  none: 'Nothing covers this yet.',
  tested: 'Proven real, but no approved plan covers it. Draft one.',
  invalid: 'No such endpoint — the plan claiming it names something the code does not serve.',
};
