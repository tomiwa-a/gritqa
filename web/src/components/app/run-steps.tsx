import Link from 'next/link';
import { StepBadge } from '@/components/ui/step-badge';
import { Icon } from '@/components/ui/icon';
import { Fence } from '@/components/ui/prose';
import { StatusDot } from '@/components/ui/badge';
import { endpointHref } from '@/lib/plan';
import { STEP_TONE, STEP_WORD, stepLine, stepOutcome } from '@/lib/runs';
import type { StepResult } from '@/lib/model';
import { cn } from '@/lib/cn';

const NUMBER: Record<StepResult['status'], string> = {
  passed: 'border-rule bg-app-panel text-ink-subtle',
  failed: 'border-fail/30 bg-fail-soft text-fail',
  error: 'border-fail/30 bg-fail-soft text-fail',
  skipped: 'border-rule-soft bg-app text-ink-subtle/60',
  pending: 'border-rule bg-app-panel text-ink-subtle',
};

/**
 * The row, linked to the endpoint panel only when there is an endpoint to link to.
 *
 * Every row was a link before, because every step was a request. A sql or shell step
 * has no route pattern, and the href it built out of one -- `?endpoint=GET%20` -- opened
 * a panel about nothing at all. So the two kinds that are not requests are rows rather
 * than links, and they lose the hover and the chevron that promised somewhere to go.
 */
function Row({
  href,
  title,
  children,
}: {
  href: string | null;
  title?: string;
  children: React.ReactNode;
}) {
  const shape = cn(
    'group relative flex gap-3 px-4 py-3.5',
    href && 'transition-colors duration-150 hover:bg-app-hover',
  );

  if (!href) return <div className={shape}>{children}</div>;
  return (
    <Link href={href} title={title} className={shape}>
      {children}
    </Link>
  );
}

export function RunSteps({ steps, className }: { steps: StepResult[]; className?: string }) {
  const stopped = steps.findIndex((s) => s.status === 'failed' || s.status === 'error');

  return (
    <ol className={cn('flex flex-col', className)}>
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        const broke = i === stopped;
        const after = stopped >= 0 && i > stopped;
        const to =
          step.kind === 'http' && step.path
            ? endpointHref({ method: step.method ?? 'GET', path: step.path })
            : null;

        return (
          <li key={`${step.stepName}-${i}`} className="relative">
            {!last && (
              <span
                aria-hidden
                className="absolute top-10 left-[27px] h-[calc(100%-1.75rem)] w-px bg-rule-soft"
              />
            )}

            <Row
              href={to}
              title={to ? `${step.method} ${step.path} — see what covers this endpoint` : undefined}
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
                  <StepBadge kind={step.kind} method={step.method} />
                  <span
                    className={cn(
                      'truncate font-mono text-[12.5px]',
                      after ? 'text-ink-subtle' : 'text-ink',
                    )}
                  >
                    {stepLine(step)}
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

                {/* The one line that says what the plan expected. Without it the report
                    shows a red 500 and leaves the reader to work out what it should have
                    been -- which the runner already knew and wrote down. Only on the step
                    that failed: a note attached to a step that passed reads as a warning
                    about it. */}
                {step.errorMessage && (step.status === 'failed' || step.status === 'error') && (
                  <p className="mt-1.5 font-mono text-[11.5px] leading-snug text-fail">
                    {step.errorMessage}
                  </p>
                )}

                {/* What it printed, on the step that did not work, for the same reason
                    the line above is only there: a wall of output under a step that
                    passed reads as a complaint about it. Untagged on purpose -- this is
                    a command's output, not a command, and colouring it as one would be
                    inventing syntax it does not have. */}
                {step.output && (step.status === 'failed' || step.status === 'error') && (
                  <Fence code={step.output} tag={undefined} />
                )}
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

                {/* Wider than it was, because a status code was the widest thing it
                    ever held and now `3 rows` and `exit 0` share the column. Fixed so
                    the numbers line up down the report. */}
                <span className="nums w-[104px] text-right font-mono text-[11.5px] text-ink-subtle">
                  {stepOutcome(step) ?? '—'}
                  {step.responseTimeMs !== null && (
                    <span className="text-ink-subtle/70"> · {step.responseTimeMs}ms</span>
                  )}
                </span>

                {to && (
                  <Icon
                    name="chevronRight"
                    size={14}
                    className="text-rule-strong transition-colors duration-150 group-hover:text-ink-subtle"
                  />
                )}
              </span>
            </Row>
          </li>
        );
      })}
    </ol>
  );
}
