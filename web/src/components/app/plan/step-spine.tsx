import Link from 'next/link';
import { MethodBadge } from '@/components/ui/method-badge';
import { Icon } from '@/components/ui/icon';
import { Leader } from '@/components/ui/rule';
import { assertionLabel, variablesUsedBy } from '@/lib/plan';
import type { PlanFailureSeed, PlanStepSpec } from '@/lib/mock/types';
import { cn } from '@/lib/cn';

function Line({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline">
      <dt className="shrink-0 font-mono text-[11px] text-ink-subtle">{term}</dt>
      <Leader />
      <dd className="min-w-0 font-mono text-[11.5px] text-ink-muted">{children}</dd>
    </div>
  );
}

export function StepSpine({
  steps,
  selectedId,
  hrefFor,
  failure,
  className,
}: {
  steps: PlanStepSpec[];
  selectedId?: string;
  hrefFor: (stepId: string) => string;
  failure?: PlanFailureSeed | null;
  className?: string;
}) {
  return (
    <ol className={cn('flex flex-col', className)}>
      {steps.map((step, i) => {
        const on = step.id === selectedId;
        const broke = failure?.stepId === step.id;
        const uses = variablesUsedBy(step);
        const last = i === steps.length - 1;

        return (
          <li key={step.id} className="relative">
            {!last && (
              <span
                aria-hidden
                className="absolute top-10 left-[27px] h-[calc(100%-1.75rem)] w-px bg-rule-soft"
              />
            )}

            <Link
              href={hrefFor(step.id)}
              aria-current={on ? 'true' : undefined}
              className={cn(
                'group relative flex gap-3 px-4 py-3.5 transition-colors duration-150',
                on ? 'bg-app-active' : 'hover:bg-app-hover',
              )}
            >
              {on && (
                <span
                  aria-hidden
                  className="absolute top-3.5 left-0 h-6 w-[2px] rounded-r-full bg-punch-red"
                />
              )}

              <span
                className={cn(
                  'nums relative z-10 mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md border font-mono text-[11px]',
                  broke
                    ? 'border-fail/30 bg-fail-soft text-fail'
                    : 'border-rule bg-app-panel text-ink-subtle',
                )}
              >
                {i + 1}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <MethodBadge method={step.request.method} />
                  <span className="truncate font-mono text-[12.5px] text-ink">
                    {step.request.url}
                  </span>
                  {broke && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-fail">
                      <Icon name="alert" size={11} />v{failure.version} broke here
                    </span>
                  )}
                </div>

                <p className="mt-1 text-[13px] leading-snug text-ink">{step.name}</p>

                <dl className="mt-2 space-y-1">
                  {uses.map((name) => (
                    <Line key={`uses-${name}`} term="uses">
                      <span className="text-punch-red">{`{{${name}}}`}</span>
                    </Line>
                  ))}
                  {step.extract.map((e) => (
                    <Line key={`extract-${e.name}`} term="extract">
                      <span className="text-punch-red">{e.name}</span>
                      <span className="text-ink-subtle"> ← </span>
                      {e.path}
                    </Line>
                  ))}
                  {step.assertions.map((a, ai) => (
                    <Line key={`assert-${ai}`} term="check">
                      {assertionLabel(a)}
                    </Line>
                  ))}
                </dl>
              </div>

              <Icon
                name="chevronRight"
                size={14}
                className={cn(
                  'mt-1 shrink-0 transition-colors duration-150',
                  on ? 'text-ink-muted' : 'text-rule-strong group-hover:text-ink-subtle',
                )}
              />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
