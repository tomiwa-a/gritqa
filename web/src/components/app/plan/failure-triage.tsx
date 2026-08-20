import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import type { PlanFailureSeed, PlanStepSpec } from '@/lib/model';
import { cn } from '@/lib/cn';

const VERDICT = {
  real_bug: { label: 'You called it a real bug', className: 'text-fail' },
  bad_test: { label: 'You called it a bad test', className: 'text-warn' },
  undecided: { label: 'Not decided yet', className: 'text-ink-subtle' },
} as const;

/**
 * The judgement the product exists to capture. Nothing stores it yet — see the
 * FailureVerdict note in `src/lib/model.ts`.
 */
export function FailureTriage({
  failure,
  step,
  stepIndex,
  className,
}: {
  failure: PlanFailureSeed;
  step: PlanStepSpec | undefined;
  stepIndex: number;
  className?: string;
}) {
  const verdict = VERDICT[failure.verdict];

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex gap-3 px-4 py-3.5">
        <Icon name="alert" size={15} className="mt-px shrink-0 text-fail" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-snug text-ink">
            v{failure.version} of this plan failed {failure.whenLabel.toLowerCase()} on step{' '}
            <span className="nums font-medium">{stepIndex + 1}</span>
            {step && <>, {step.name.toLowerCase()}</>}.
          </p>
          <p className="mt-1.5 font-mono text-[11.5px] text-ink-muted">
            expected {failure.expected} · got {failure.actual}
          </p>
        </div>
      </div>

      <div className="border-t border-rule-soft px-4 py-3.5">
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          Before you approve v{failure.version + 1}, say what that was. It is the one thing a machine
          cannot work out for you, and it changes what the next draft assumes.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm">
            <Icon name="alert" size={13} className="text-fail" />
            The code was wrong
          </Button>
          <Button variant="secondary" size="sm">
            <Icon name="plan" size={13} className="text-warn" />
            The test was wrong
          </Button>
        </div>

        <p className={cn('mt-2.5 text-[11.5px]', verdict.className)}>{verdict.label}</p>
      </div>
    </div>
  );
}
