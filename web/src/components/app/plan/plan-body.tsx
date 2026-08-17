import Link from 'next/link';
import { Panel } from '@/components/app/panel';
import { StepSpine } from './step-spine';
import { VariableChain } from './variable-chain';
import { Provenance } from './provenance';
import { RulesApplied } from './rules-applied';
import { FailureTriage } from './failure-triage';
import type { TestPlan, TestPlanDetail } from '@/lib/mock/types';
import { cn } from '@/lib/cn';

/** Detail exists for some plans only; the rest say so instead of faking steps. */
export function PlanBody({
  plan,
  detail,
  selectedStepId,
  stepHrefFor,
  fullHref,
  className,
}: {
  plan: TestPlan;
  detail: TestPlanDetail | undefined;
  selectedStepId?: string;
  stepHrefFor: (stepId: string) => string;
  fullHref?: string;
  className?: string;
}) {
  if (!detail) {
    return (
      <Panel title="Steps" bodyClassName="p-4" className={className}>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          The steps for {plan.name.toLowerCase()} have not been loaded into this build yet.
          {fullHref && (
            <>
              {' '}
              <Link
                href={fullHref}
                className="font-medium text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
              >
                Open the full plan
              </Link>{' '}
              to see how the page is laid out.
            </>
          )}
        </p>
      </Panel>
    );
  }

  const failureStepIndex = detail.previousFailure
    ? detail.steps.findIndex((s) => s.id === detail.previousFailure?.stepId)
    : -1;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {detail.previousFailure && (
        <Panel
          title="Last time this ran"
          subtitle="Read this before you approve the new version"
          bodyClassName="p-0"
          className="border-fail/25"
        >
          <FailureTriage
            failure={detail.previousFailure}
            step={detail.steps[failureStepIndex]}
            stepIndex={failureStepIndex}
          />
        </Panel>
      )}

      <Panel
        title={detail.diffContext ? 'What changed' : 'Why this exists'}
        subtitle={
          detail.diffContext ? 'The push this draft was written for' : 'The request that started it'
        }
        bodyClassName="p-0"
      >
        <Provenance plan={detail} />
      </Panel>

      <Panel title="Rules it followed" bodyClassName="p-0">
        <RulesApplied plan={detail} />
      </Panel>

      <Panel
        title="How the steps feed each other"
        subtitle="What each step needs, and which earlier step hands it over"
        bodyClassName="p-0"
      >
        <VariableChain plan={detail} stepHrefFor={stepHrefFor} />
      </Panel>

      <Panel
        title="Steps"
        subtitle="Open any step for its request, headers and checks"
        meta={
          <span className="nums shrink-0 font-mono text-[11.5px] text-ink-subtle">
            {detail.baseUrl}
          </span>
        }
        bodyClassName="p-0"
      >
        <StepSpine
          steps={detail.steps}
          selectedId={selectedStepId}
          hrefFor={stepHrefFor}
          failure={detail.previousFailure}
        />
      </Panel>
    </div>
  );
}
