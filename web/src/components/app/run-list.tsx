import Link from 'next/link';
import { StatusDot } from '@/components/ui/badge';
import { MethodBadge } from '@/components/ui/method-badge';
import { Meter } from './meter';
import type { ExecutionStatus, TestExecution } from '@/lib/model';

const TONE: Record<ExecutionStatus, 'pass' | 'fail' | 'running' | 'skip'> = {
  passed: 'pass',
  failed: 'fail',
  error: 'fail',
  running: 'running',
  pending: 'skip',
};

export function RunList({
  runs,
  hrefFor = (id) => `/dashboard/runs/${id}`,
}: {
  runs: TestExecution[];
  /** Where a row goes — a drawer on the pages that host one, the run's page otherwise. */
  hrefFor?: (publicId: string) => string;
}) {
  return (
    <ul className="divide-y divide-rule-soft">
      {runs.map((run) => {
        const passed = run.steps.filter((s) => s.status === 'passed').length;
        const broke = run.steps.find((s) => s.status === 'failed');

        return (
          <li key={run.publicId}>
            <Link
              href={hrefFor(run.publicId)}
              className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-app-hover"
            >
              <StatusDot tone={TONE[run.status]} pulse={run.status === 'running'} />

              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-ink">{run.planName}</p>
                <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-subtle">
                  {broke ? (
                    <>
                      <MethodBadge method={broke.method} className="h-[15px] w-[46px] text-[9px]" />
                      <span className="truncate font-mono">{broke.path}</span>
                      <span className="nums shrink-0 text-fail">{broke.responseStatus}</span>
                    </>
                  ) : run.status === 'pending' ? (
                    /* No steps and no duration, because it has not started. The row
                       said "0 steps · running" before, which was two lies. */
                    <span className="truncate">Waiting for your machine</span>
                  ) : (
                    <span className="nums truncate">
                      {run.steps.length} steps
                      {run.durationMs ? ` · ${(run.durationMs / 1000).toFixed(1)}s` : ' · running'}
                    </span>
                  )}
                </p>
              </div>

              <Meter
                total={run.steps.length}
                passed={passed}
                tone={run.status === 'running' ? 'skip' : 'fail'}
                className="hidden sm:inline-flex"
              />

              <span className="nums w-[54px] shrink-0 text-right text-[11.5px] text-ink-subtle">
                {run.startedLabel}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
