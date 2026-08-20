import Link from 'next/link';
import { MethodBadge } from '@/components/ui/method-badge';
import { Icon } from '@/components/ui/icon';
import { StatusDot } from '@/components/ui/badge';
import { endpointHref } from '@/lib/plan';
import { STEP_TONE, STEP_WORD } from '@/lib/runs';
import type { StepResult } from '@/lib/model';
import { cn } from '@/lib/cn';

const NUMBER: Record<StepResult['status'], string> = {
  passed: 'border-rule bg-app-panel text-ink-subtle',
  failed: 'border-fail/30 bg-fail-soft text-fail',
  error: 'border-fail/30 bg-fail-soft text-fail',
  skipped: 'border-rule-soft bg-app text-ink-subtle/60',
  pending: 'border-rule bg-app-panel text-ink-subtle',
};

export function RunSteps({ steps, className }: { steps: StepResult[]; className?: string }) {
  const stopped = steps.findIndex((s) => s.status === 'failed' || s.status === 'error');

  return (
    <ol className={cn('flex flex-col', className)}>
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        const broke = i === stopped;
        const after = stopped >= 0 && i > stopped;

        return (
          <li key={`${step.stepName}-${i}`} className="relative">
            {!last && (
              <span
                aria-hidden
                className="absolute top-10 left-[27px] h-[calc(100%-1.75rem)] w-px bg-rule-soft"
              />
            )}

            <Link
              href={endpointHref({ method: step.method, path: step.path })}
              title={`${step.method} ${step.path} — see what covers this endpoint`}
              className="group relative flex gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-app-hover"
            >
              <span
                className={cn(
                  'nums relative z-10 mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md border font-mono text-[11px]',
                  NUMBER[step.status],
                )}
              >
                {i + 1}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <MethodBadge method={step.method} />
                  <span
                    className={cn(
                      'truncate font-mono text-[12.5px]',
                      after ? 'text-ink-subtle' : 'text-ink',
                    )}
                  >
                    {step.path}
                  </span>
                  {broke && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-fail">
                      <Icon name="alert" size={11} />
                      stopped here
                    </span>
                  )}
                </div>

                <p
                  className={cn(
                    'mt-1 text-[13px] leading-snug',
                    after ? 'text-ink-subtle' : 'text-ink-muted',
                  )}
                >
                  {step.stepName}
                </p>
              </div>

              <span className="flex shrink-0 items-center gap-2.5 self-start pt-0.5">
                <span className="hidden items-center gap-1.5 sm:flex">
                  <StatusDot tone={STEP_TONE[step.status]} label={STEP_WORD[step.status]} />
                  <span
                    className={cn(
                      'text-[11.5px]',
                      step.status === 'failed' || step.status === 'error'
                        ? 'font-medium text-fail'
                        : 'text-ink-subtle',
                    )}
                  >
                    {STEP_WORD[step.status]}
                  </span>
                </span>

                <span className="nums w-[74px] text-right font-mono text-[11.5px] text-ink-subtle">
                  {step.responseStatus ?? '—'}
                  {step.responseTimeMs !== null && (
                    <span className="text-ink-subtle/70"> · {step.responseTimeMs}ms</span>
                  )}
                </span>

                <Icon
                  name="chevronRight"
                  size={14}
                  className="text-rule-strong transition-colors duration-150 group-hover:text-ink-subtle"
                />
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
