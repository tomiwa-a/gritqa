import { sql as raw } from '@/lib/db';

/**
 * The window the overview compares against itself: the last N days, and the N before.
 *
 * The mock kept six numbers for this -- `runs: 142`, `passRatePrevious: '91.0'` -- and
 * they were the last invented figures on the page. Nothing could recompute them, so
 * every delta on the overview was decoration: the arrow pointed wherever the constant
 * said, and the pass rate could fall while the badge claimed a rise.
 *
 * Both windows come out of the same query, keyed by a boolean, so the two figures a
 * delta is built from are always measured the same way. A number and its comparison
 * drifting apart is the failure this replaces.
 */
export type WindowStats = {
  /** Executions started in the window. A run still going counts: it started. */
  runs: number;
  /** Steps, and the ones that passed -- the same construction `stripStatsOf` uses. */
  steps: number;
  passed: number;
  /**
   * Median wall-clock of the runs that finished. Null when none did, which is a real
   * state for a fresh project and reads as an em dash rather than a zero.
   */
  medianMs: number | null;
};

export type PeriodWindows = { days: number; current: WindowStats; previous: WindowStats };

const EMPTY: WindowStats = { runs: 0, steps: 0, passed: 0, medianMs: null };

type Row = { current: boolean; runs: number; median_ms: string | number | null };
type StepRow = { current: boolean; steps: number; passed: number };

export async function periodWindows(projectId: number, days = 30): Promise<PeriodWindows> {
  // Two queries rather than one, because they count different things: a join to
  // `test_results` multiplies the execution rows, so counting runs and steps in one
  // pass would report a run once per step it has.
  const [runs, steps] = await Promise.all([
    raw`
      SELECT started_at > now() - make_interval(days => ${days}) AS current,
             count(*)::int AS runs,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)
               FILTER (WHERE duration_ms IS NOT NULL) AS median_ms
      FROM test_executions
      WHERE project_id = ${projectId}
        AND started_at > now() - make_interval(days => ${days * 2})
      GROUP BY 1
    ` as unknown as Promise<Row[]>,
    raw`
      SELECT e.started_at > now() - make_interval(days => ${days}) AS current,
             count(*)::int AS steps,
             count(*) FILTER (WHERE r.status = 'passed')::int AS passed
      FROM test_executions e
      JOIN test_results r ON r.execution_id = e.id
      WHERE e.project_id = ${projectId}
        AND e.started_at > now() - make_interval(days => ${days * 2})
      GROUP BY 1
    ` as unknown as Promise<StepRow[]>,
  ]);

  const windows = new Map<boolean, WindowStats>([
    [true, { ...EMPTY }],
    [false, { ...EMPTY }],
  ]);

  for (const row of runs) {
    const window = windows.get(row.current);
    if (!window) continue;
    window.runs = row.runs;
    // `percentile_cont` returns double precision, which the driver may hand back as a
    // string. It also interpolates between two runs, so this is not always an integer.
    window.medianMs = row.median_ms === null ? null : Math.round(Number(row.median_ms));
  }

  for (const row of steps) {
    const window = windows.get(row.current);
    if (!window) continue;
    window.steps = row.steps;
    window.passed = row.passed;
  }

  return {
    days,
    current: windows.get(true) ?? EMPTY,
    previous: windows.get(false) ?? EMPTY,
  };
}
