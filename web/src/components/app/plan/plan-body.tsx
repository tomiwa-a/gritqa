import Link from 'next/link';
import { Panel } from '@/components/app/panel';
import { StepSpine } from './step-spine';
import { VariableChain } from './variable-chain';
import { Provenance } from './provenance';
import { Assumptions } from './assumptions';
import { ChecksTally, StepChecks } from './step-checks';
import { RulesApplied } from './rules-applied';
import { FailureTriage } from './failure-triage';
import { kindsIn } from '@/lib/plan';
import { checkIsDoubt } from '@/lib/model';
import type { TestPlan, TestPlanDetail } from '@/lib/model';
import { cn } from '@/lib/cn';

/**
 * "its request, headers and checks" is three of the four things a step can have, and
 * none of the first three belong to a step that runs a statement instead.
 */
function stepsSubtitle(steps: TestPlanDetail['steps']): string {
  const kinds = kindsIn(steps);
  return kinds.length === 1 && kinds[0] === 'http'
    ? 'Open any step for its request, headers and checks'
    : 'Open any step for what it sends or runs, and its checks';
}

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
      <div className={cn('flex flex-col gap-4', className)}>
        <Panel title="Steps" bodyClassName="p-4">
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
      </div>
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

      {/* Why a plan exists without a diff behind it is the conversation's job now. */}
      {detail.diffContext && (
        <Panel
          title="What changed"
          subtitle="The push this draft was written for"
          bodyClassName="p-0"
        >
          <Provenance diff={detail.diffContext} />
        </Panel>
      )}

      {/* Evidence before self-report: a verdict that the code says otherwise outranks
          anything else on the page, and a plan with no checks says nothing here --
          which is what every plan written before the third pass existed is. */}
      {detail.checks.length > 0 && (
        <Panel
          title="What it verified"
          subtitle="Each step against the code, or against a call this project really made"
          meta={<ChecksTally checks={detail.checks} />}
          bodyClassName="p-0"
          className={detail.checks.some(checkIsDoubt) ? 'border-warn/30' : undefined}
        >
          <StepChecks
            steps={detail.steps}
            checks={detail.checks}
            hrefFor={stepHrefFor}
            planPublicId={detail.publicId}
          />
        </Panel>
      )}

      {/* Before the rules and before the steps: this is the part that decides whether
          the rest is worth reading closely. */}
      {detail.assumptions.length > 0 && (
        <Panel
          title="What it guessed at"
          subtitle="Not findings — send the plan back if one of these is wrong"
          bodyClassName="p-0"
          className="border-warn/30"
        >
          <Assumptions assumptions={detail.assumptions} />
        </Panel>
      )}

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
        subtitle={stepsSubtitle(detail.steps)}
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
          checks={detail.checks}
        />
      </Panel>
    </div>
  );
}
