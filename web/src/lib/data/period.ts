import { cache } from 'react';
import { currentScope } from '@/lib/db/scope';
import { periodWindows, type WindowStats } from '@/lib/db/period';

/**
 * The overview's window, and the same window one step back.
 *
 * Labels and the numbers behind them, side by side, for the same reason the rest of the
 * read model carries both: the card shows `1.1s`, and the delta beside it has to do
 * arithmetic that `'1.1s'` cannot.
 */
export type Period = {
  /** How many days the window spans. The chip above the metrics says so out loud. */
  days: number;
  runs: number;
  runsPrevious: number;
  /** Steps in the window. One step is one request that went out. */
  steps: number;
  /** Steps, not runs: a run that fails on step 4 of 6 passed five-sixths of its work. */
  passRate: string | null;
  passRatePrevious: string | null;
  medianRun: string;
  medianRunPrevious: string;
  medianRunSeconds: number | null;
  medianRunPreviousSeconds: number | null;
};

/** An em dash, not `0.0s`: no run finished, which is not the same as a fast one. */
function secondsLabel(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`;
}

/** Null for the same reason `medianRun` is an em dash: no step ran to have a rate. */
function passRateOf(window: WindowStats): string | null {
  return window.steps ? ((window.passed / window.steps) * 100).toFixed(1) : null;
}

const EMPTY: Period = {
  days: 30,
  runs: 0,
  runsPrevious: 0,
  steps: 0,
  passRate: null,
  passRatePrevious: null,
  medianRun: '—',
  medianRunPrevious: '—',
  medianRunSeconds: null,
  medianRunPreviousSeconds: null,
};

export const getPeriod = cache(async (): Promise<Period> => {
  const scope = await currentScope();
  if (!scope) return EMPTY;

  const { days, current, previous } = await periodWindows(scope.projectId);

  return {
    days,
    runs: current.runs,
    runsPrevious: previous.runs,
    steps: current.steps,
    passRate: passRateOf(current),
    passRatePrevious: passRateOf(previous),
    medianRun: secondsLabel(current.medianMs),
    medianRunPrevious: secondsLabel(previous.medianMs),
    medianRunSeconds: current.medianMs === null ? null : current.medianMs / 1000,
    medianRunPreviousSeconds: previous.medianMs === null ? null : previous.medianMs / 1000,
  };
});
