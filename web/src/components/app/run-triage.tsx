import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MethodBadge } from '@/components/ui/method-badge';
import type { StepResult } from '@/lib/mock/types';
import { cn } from '@/lib/cn';

/**
 * The judgement the product exists to capture. Nothing stores it yet — see the
 * FailureVerdict note in mock/types.ts.
 */
export function RunTriage({
  step,
  stepIndex,
  planName,
  refineHref,
  className,
}: {
  step: StepResult;
  stepIndex: number;
  planName: string;
  refineHref: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex gap-3 px-4 py-3.5">
        <Icon name="alert" size={15} className="mt-px shrink-0 text-fail" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-snug text-ink">
            Step <span className="nums font-medium">{stepIndex + 1}</span>,{' '}
            {step.stepName.toLowerCase()}, came back{' '}
            <span className="nums font-mono font-medium text-fail">{step.responseStatus}</span>.
          </p>
          <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
            <MethodBadge method={step.method} className="h-[15px] w-[46px] text-[9px]" />
            <span className="truncate font-mono text-[11.5px] text-ink-muted">{step.path}</span>
          </p>
        </div>
      </div>

      <div className="border-t border-rule-soft px-4 py-3.5">
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          Two very different things look identical here: your code broke, or the test asked for the
          wrong thing. Only you can say which, and the answer sends this somewhere different.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm">
            <Icon name="alert" size={13} className="text-fail" />
            The code was wrong
          </Button>
          <Link
            href={refineHref}
            scroll={false}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <Icon name="plan" size={13} className="text-warn" />
            The test was wrong
          </Link>
        </div>

        <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-subtle">
          Calling it a bad test opens {planName} so you can say what should change instead. Calling
          it a real bug leaves the run on record as a genuine catch.
        </p>
      </div>
    </div>
  );
}
