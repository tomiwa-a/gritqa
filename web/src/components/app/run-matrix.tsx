import Link from 'next/link';
import { getRecentRuns, getRunHistory, getRunStripStats } from '@/lib/data';
import { CELL_FILL, CELL_WORD, runRowsOf } from '@/lib/runs';
import { cn } from '@/lib/cn';

const ORDER = ['p', 'f', 's'];

function summarise(cells: string, planName: string, whenLabel: string) {
  const failed = [...cells].filter((c) => c === 'f').length;
  const tail = failed
    ? `${failed} of ${cells.length} steps failed`
    : `all ${cells.length} steps passed`;
  return `${planName} · ${whenLabel} — ${tail}`;
}

export async function RunMatrix({
  hrefFor = (id) => `/dashboard/runs/${id}`,
}: {
  hrefFor?: (publicId: string) => string;
} = {}) {
  const [history, recent, runStripStats] = await Promise.all([
    getRunHistory(),
    getRecentRuns(),
    getRunStripStats(),
  ]);
  /* Oldest on the left, so the strip reads the way time does.
   *
   * A run with no steps is left out rather than drawn. One column is one run and one
   * square is one step, so a queued run's column has no squares in it -- an invisible
   * two-pixel link whose tooltip would have claimed "all 0 steps passed". It joins the
   * strip when its first step comes back. */
  const COLUMNS = [...runRowsOf(history, recent)].reverse().filter((run) => run.cells.length > 0);

  return (
    <div>
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="flex items-end gap-[3px]">
          {COLUMNS.map((run) => (
            <Link
              key={run.publicId}
              href={hrefFor(run.publicId)}
              title={summarise(run.cells, run.planName, run.whenLabel)}
              aria-label={summarise(run.cells, run.planName, run.whenLabel)}
              className="flex flex-col-reverse gap-[3px] rounded-sm p-px transition-opacity duration-150 hover:opacity-60"
            >
              {[...run.cells].map((c, j) => (
                <span key={j} className={cn('h-2 w-2 rounded-[2px]', CELL_FILL[c])} />
              ))}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[10.5px] tracking-[0.06em] text-ink-subtle uppercase">
        <span>Oldest</span>
        <span className="h-px flex-1 bg-rule-soft" />
        <span>Newest</span>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule-soft pt-3.5">
        {ORDER.map((c) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-[2px]', CELL_FILL[c])} />
            <span className="text-[12px] text-ink-muted capitalize">{CELL_WORD[c]}</span>
            <span className="nums text-[12px] font-medium text-ink">
              {c === 'p'
                ? runStripStats.passed
                : c === 'f'
                  ? runStripStats.failed
                  : runStripStats.skipped}
            </span>
          </span>
        ))}
        <span className="nums ml-auto text-[12px] text-ink-subtle">
          {runStripStats.total} steps
        </span>
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-ink-subtle">
        One column is one run, one square is one step. Open a column to read that run.
      </p>
    </div>
  );
}
