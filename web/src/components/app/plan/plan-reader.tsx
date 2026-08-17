import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { PlanBody } from './plan-body';
import { DecisionBar } from './decision-bar';
import type { TestPlan, TestPlanDetail } from '@/lib/mock/types';
import { cn } from '@/lib/cn';

function Summary({ plan }: { plan: TestPlan }) {
  return (
    <p className="nums flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-subtle">
      <span>{plan.stepCount} steps</span>
      <span aria-hidden>·</span>
      <span>{plan.assertionCount} checks</span>
      <span aria-hidden>·</span>
      <span>
        {plan.covers.length} endpoint{plan.covers.length === 1 ? '' : 's'}
      </span>
      <span aria-hidden>·</span>
      <span>{plan.createdLabel}</span>
    </p>
  );
}

export function PlanReader({
  plan,
  detail,
  cliConnected,
  selectedStepId,
  stepHrefFor,
  askHref,
  className,
}: {
  plan: TestPlan;
  detail: TestPlanDetail | undefined;
  cliConnected: boolean;
  selectedStepId?: string;
  stepHrefFor: (stepId: string) => string;
  /** This page's own URL plus #ask — the conversation is right below. */
  askHref: string;
  className?: string;
}) {
  const fullHref = `/dashboard/test-plans/${plan.publicId}`;
  const diffHrefFor = (version: number) =>
    version > 1 ? `${fullHref}?tab=diff&v=${version}` : `${fullHref}?tab=diff`;

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5">
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="draft" size="sm">
              Draft
            </Badge>
            {plan.version > 1 && (
              <Badge variant="outline" size="sm" mono className="nums bg-app-panel">
                v{plan.version}
              </Badge>
            )}
            <span className="flex items-center gap-1.5 text-[11.5px] text-ink-subtle">
              <Icon name={plan.triggerSource === 'git_push' ? 'branch' : 'user'} size={12} />
              {plan.triggerSource === 'git_push' ? 'Drafted from a push' : 'Started by hand'}
            </span>
          </div>

          <h2 className="mt-2 text-[19px] leading-snug font-semibold tracking-[-0.02em] text-ink">
            {plan.name}
          </h2>
          <p className="mt-1 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-muted">
            {plan.description}
          </p>
          <div className="mt-2">
            <Summary plan={plan} />
          </div>
        </header>

        <PlanBody
          plan={plan}
          detail={detail}
          selectedStepId={selectedStepId}
          stepHrefFor={stepHrefFor}
          diffHrefFor={diffHrefFor}
          fullHref={fullHref}
        />
      </div>

      <DecisionBar
        planId={plan.publicId}
        cliConnected={cliConnected}
        refineHref={askHref}
        fullHref={fullHref}
        showKeys
      />
    </div>
  );
}
