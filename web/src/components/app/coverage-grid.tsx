import Link from 'next/link';
import { getCoverage, getCoverageTotals } from '@/lib/data';
import { endpointHref, fileHref } from '@/lib/plan';
import { COVERAGE_FILL, COVERAGE_LABEL, COVERAGE_ORDER } from '@/lib/coverage';
import { cn } from '@/lib/cn';

export async function CoverageGrid() {
  const [coverage, coverageTotals] = await Promise.all([getCoverage(), getCoverageTotals()]);

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
                href={fileHref(file.file)}
                title={`${file.file} — ${file.endpoints.length} endpoints`}
                className="w-[104px] shrink-0 truncate font-mono text-[11px] text-ink-subtle transition-colors duration-150 hover:text-ink sm:w-[132px]"
              >
                {file.file.replace(/^routes\//, '')}
              </Link>

              <div className="flex flex-wrap gap-1">
                {file.endpoints.map((e) => (
                  <Link
                    key={`${e.method} ${e.path}`}
                    href={endpointHref(e)}
                    title={`${e.method} ${e.path} — ${COVERAGE_LABEL[e.state]}`}
                    aria-label={`${e.method} ${e.path}, ${COVERAGE_LABEL[e.state]}`}
                    className={cn(
                      'h-3 w-3 rounded-[3px] transition-shadow duration-150',
                      'hover:ring-2 hover:ring-ink/25',
                      COVERAGE_FILL[e.state],
                    )}
                  />
                ))}
              </div>

              <span className="sr-only">
                {file.file}: {file.endpoints.length} endpoints —{' '}
                {COVERAGE_ORDER.filter((s) => counts[s])
                  .map((s) => `${counts[s]} ${COVERAGE_LABEL[s]}`)
                  .join(', ')}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule-soft pt-3.5">
        {COVERAGE_ORDER.map((state) => (
          <span key={state} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-[3px]', COVERAGE_FILL[state])} />
            <span className="text-[12px] text-ink-muted">{COVERAGE_LABEL[state]}</span>
            <span className="nums text-[12px] font-medium text-ink">{coverageTotals[state]}</span>
          </span>
        ))}
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-ink-subtle">
        One square is one endpoint. Open a square to see which plans cover it and what to do next.
      </p>
    </div>
  );
}
