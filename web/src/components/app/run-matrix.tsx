import { runStrip, runStripStats } from '@/lib/mock/data';
import { cn } from '@/lib/cn';

const FILL: Record<string, string> = { p: 'bg-pass', f: 'bg-fail', s: 'bg-skip' };
const LABEL: Record<string, string> = { p: 'passed', f: 'failed', s: 'skipped' };
const ORDER = ['p', 'f', 's'];

function summarise(run: string, index: number) {
  const failed = [...run].filter((c) => c === 'f').length;
  const skipped = [...run].filter((c) => c === 's').length;
  const tail = failed
    ? `${failed} failed, ${skipped} skipped`
    : `all ${run.length} steps passed`;
  return `Run ${index + 1} of ${runStrip.length} — ${tail}`;
}

export function RunMatrix() {
  return (
    <div>
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="flex items-end gap-[3px]">
          {runStrip.map((run, i) => (
            <div
              key={i}
              title={summarise(run, i)}
              className="flex flex-col-reverse gap-[3px] rounded-sm transition-opacity duration-150 hover:opacity-70"
            >
              {[...run].map((c, j) => (
                <span key={j} className={cn('h-2 w-2 rounded-[2px]', FILL[c])} />
              ))}
            </div>
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
            <span className={cn('h-2.5 w-2.5 rounded-[2px]', FILL[c])} />
            <span className="text-[12px] text-ink-muted capitalize">{LABEL[c]}</span>
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
    </div>
  );
}
