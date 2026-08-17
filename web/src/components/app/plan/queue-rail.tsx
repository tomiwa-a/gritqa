import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import type { TestPlan } from '@/lib/mock/types';
import { cn } from '@/lib/cn';

export function QueueRail({
  plans,
  selectedId,
  hrefFor,
  className,
}: {
  plans: TestPlan[];
  selectedId: string;
  hrefFor: (planId: string) => string;
  className?: string;
}) {
  return (
    <nav
      aria-label="Drafts waiting for review"
      className={cn('flex min-h-0 flex-col border-rule bg-app-panel', className)}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-rule-soft px-3.5 py-3">
        <h2 className="text-[12.5px] font-medium text-ink">Waiting on you</h2>
        <span className="nums ml-auto font-mono text-[11px] text-ink-subtle">{plans.length}</span>
      </header>

      <ol
        data-queue-rail
        className="min-h-0 flex-1 overflow-y-auto lg:max-h-none max-h-[13.5rem]"
      >
        {plans.map((plan, i) => {
          const on = plan.publicId === selectedId;
          const broke = plan.lastRun?.status === 'failed';

          return (
            <li key={plan.publicId}>
              <Link
                href={hrefFor(plan.publicId)}
                data-queue-item={plan.publicId}
                aria-current={on ? 'true' : undefined}
                className={cn(
                  'relative flex flex-col gap-1.5 border-b border-rule-soft px-3.5 py-3 transition-colors duration-150',
                  on ? 'bg-app-active' : 'hover:bg-app-hover',
                )}
              >
                {on && (
                  <span
                    aria-hidden
                    className="absolute top-1/2 left-0 h-6 w-[2px] -translate-y-1/2 rounded-r-full bg-punch-red"
                  />
                )}

                <div className="flex items-start gap-2">
                  <span className="nums mt-px shrink-0 font-mono text-[10.5px] text-ink-subtle">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 text-[13px] leading-snug',
                      on ? 'font-medium text-ink' : 'text-ink',
                    )}
                  >
                    {plan.name}
                  </span>
                  {broke && (
                    <span
                      aria-hidden
                      className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-fail"
                      title="A previous version failed"
                    />
                  )}
                </div>

                <p className="nums flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-[1.65rem] font-mono text-[10.5px] text-ink-subtle">
                  <Icon
                    name={plan.triggerSource === 'git_push' ? 'branch' : 'user'}
                    size={11}
                  />
                  {plan.version > 1 && (
                    <>
                      <span className="text-ink-muted">v{plan.version}</span>
                      <span aria-hidden>·</span>
                    </>
                  )}
                  <span>{plan.stepCount} steps</span>
                  <span aria-hidden>·</span>
                  <span>{plan.assertionCount} checks</span>
                  <span aria-hidden>·</span>
                  <span>{plan.createdLabel}</span>
                </p>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
