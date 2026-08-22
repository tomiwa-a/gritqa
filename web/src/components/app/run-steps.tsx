import Link from 'next/link';
import { StepBadge } from '@/components/ui/step-badge';
import { Icon } from '@/components/ui/icon';
import { Fence } from '@/components/ui/prose';
import { StatusDot } from '@/components/ui/badge';
import { endpointHref } from '@/lib/plan';
import { STEP_TONE, STEP_WORD, bodyText, checkLine, stepLine, stepOutcome } from '@/lib/runs';
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

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 font-mono text-[10px] tracking-[0.16em] text-ink-subtle uppercase">
      {children}
    </p>
  );
}

/** A body, or a sentence about why there is not one. Nothing at all when it is empty. */
function Body({ value }: { value: unknown }) {
  const read = bodyText(value);
  if (!read) return null;
  if (typeof read === 'string') {
    return <p className="text-[12.5px] leading-relaxed text-ink-subtle">{read}</p>;
  }
  return <Fence code={read.code} tag={read.tag} />;
}

/**
 * What actually came back, under the step it came back from.
 *
 * Closed by default and that is the load-bearing decision. The report's job is to be
 * scannable -- twelve steps, one of them red -- and twelve open response bodies is not
 * a report. Every one of these was already in Postgres and simply never read back, so
 * what this adds is the answer to "and what did it say", one click from the question.
 *
 * Outside the row's link rather than inside it: a `details` nested in an anchor opens
 * the endpoint panel instead of expanding, and no amount of `preventDefault` in a
 * server component fixes that.
 *
 * The checks are worth as much as the body. A green step showing `data.token is there`
 * is the difference between trusting the run and taking its word for it -- and a plan
 * that quietly asserts nothing looks identical to one that passed, until you open it
 * and find no checks listed.
 */
function Evidence({ step }: { step: StepResult }) {
  const broke = step.status === 'failed' || step.status === 'error';
  /* The inline block above already prints a failed command's output, which is where it
     belongs -- so this carries the output nobody could see: the one from a step that
     worked. */
  const output = broke ? null : step.output;
  const checks = step.assertions;

  if (!checks.length && !step.responseBody && !step.requestBody && !output) return null;

  const counts = [
    checks.length ? `${checks.length} check${checks.length === 1 ? '' : 's'}` : null,
    step.responseBody ? 'response' : null,
    output ? 'output' : null,
  ].filter(Boolean);

  return (
    <details className="group relative z-10 -mt-1.5 pr-4 pb-3.5 pl-[52px]">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-[11.5px] text-ink-subtle transition-colors duration-150 hover:text-ink-muted [&::-webkit-details-marker]:hidden">
        <Icon
          name="chevronRight"
          size={11}
          className="transition-transform duration-150 group-open:rotate-90"
        />
        <span className="nums">What came back · {counts.join(' · ')}</span>
      </summary>

      <div className="mt-2.5 flex flex-col gap-3.5 border-l border-rule-soft pl-3">
        {checks.length > 0 && (
          <div>
            <Label>Checks</Label>
            <ul className="flex flex-col gap-1">
              {checks.map((check, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <Icon
                    name={check.passed ? 'check' : 'close'}
                    size={11}
                    className={cn('mt-[3.5px] shrink-0', check.passed ? 'text-pass' : 'text-fail')}
                  />
                  <span
                    className={cn(
                      'font-mono text-[11.5px] leading-snug [overflow-wrap:anywhere]',
                      check.passed ? 'text-ink-muted' : 'text-fail',
                    )}
                  >
                    {checkLine(check)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {step.responseBody !== null && step.responseBody !== undefined && (
          <div>
            <Label>{step.kind === 'sql' ? 'Rows' : 'Response'}</Label>
            <Body value={step.responseBody} />
          </div>
        )}

        {output && (
          <div>
            <Label>Output</Label>
            <Fence code={output} tag={undefined} />
          </div>
        )}

        {/* Named for what it is. The runner stores the body the plan declares, not the
            body it sent, which is why no password a run uses is in the database -- and
            saying "Request" over a `{{signupPassword}}` would be a quiet lie about
            what went over the wire. */}
        {step.requestBody !== null && step.requestBody !== undefined && (
          <div>
            <Label>Sent, as the plan writes it</Label>
            <Body value={step.requestBody} />
          </div>
        )}
      </div>
    </details>
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

            <Evidence step={step} />
          </li>
        );
      })}
    </ol>
  );
}
