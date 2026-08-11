import Link from 'next/link';
import { coverage, coverageTotals } from '@/lib/mock/data';
import type { CoverageState } from '@/lib/mock/types';
import { cn } from '@/lib/cn';

const FILL: Record<CoverageState, string> = {
  approved: 'bg-pass',
  draft: 'bg-warn',
  failing: 'bg-fail',
  none: 'bg-rule-strong',
};

const LABEL: Record<CoverageState, string> = {
  approved: 'Approved plan',
  draft: 'Needs review',
  failing: 'Failing',
  none: 'No plan yet',
};

const ORDER: CoverageState[] = ['approved', 'draft', 'failing', 'none'];

export function CoverageGrid() {
  return (
    <div>
      <div className="flex flex-col gap-2">
        {coverage.map((file) => {
          const counts = file.endpoints.reduce<Record<string, number>>(
            (acc, e) => ({ ...acc, [e.state]: (acc[e.state] ?? 0) + 1 }),
            {},
          );

          return (
            <div key={file.file} className="flex items-center gap-3">
              <Link
                href="/dashboard/codebase"
                title={file.file}
                className="w-[104px] shrink-0 truncate font-mono text-[11px] text-ink-subtle transition-colors duration-150 hover:text-ink sm:w-[132px]"
              >
                {file.file.replace(/^routes\//, '')}
              </Link>

              <div className="flex flex-wrap gap-1" aria-hidden>
                {file.endpoints.map((e) => (
                  <span
                    key={`${e.method} ${e.path}`}
                    title={`${e.method} ${e.path} — ${LABEL[e.state]}`}
                    className={cn(
                      'h-3 w-3 rounded-[3px] transition-shadow duration-150',
                      'hover:ring-2 hover:ring-ink/25',
                      FILL[e.state],
                    )}
                  />
                ))}
              </div>

              <span className="sr-only">
                {file.file}: {file.endpoints.length} endpoints —{' '}
                {ORDER.filter((s) => counts[s]).map((s) => `${counts[s]} ${LABEL[s]}`).join(', ')}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule-soft pt-3.5">
        {ORDER.map((state) => (
          <span key={state} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-[3px]', FILL[state])} />
            <span className="text-[12px] text-ink-muted">{LABEL[state]}</span>
            <span className="nums text-[12px] font-medium text-ink">{coverageTotals[state]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
