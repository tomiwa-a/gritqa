import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icon';
import { Prose } from '@/components/ui/prose';
import { checkIsDoubt } from '@/lib/model';
import type { PlanStepSpec, StepCheck, StepCheckVerdict } from '@/lib/model';
import { cn } from '@/lib/cn';

/**
 * Three verdicts in the reader's words. `unsupported` is the one worth naming
 * carefully: it does not mean the step is wrong and it does not mean it is fine, it
 * means the agent went looking and came back with nothing. "Unverified" would read as
 * a shrug; naming what happened leaves the judgment with the reader.
 */
const VERDICT: Record<
  StepCheckVerdict,
  { label: string; heading: string; icon: IconName; tone: string }
> = {
  confirmed: {
    label: 'found in the code',
    heading: 'Found in the code',
    icon: 'check',
    tone: 'text-pass',
  },
  unsupported: {
    label: 'nothing settled it',
    heading: 'Nothing settled this step',
    icon: 'help',
    tone: 'text-warn',
  },
  wrong: {
    label: 'the code says otherwise',
    heading: 'The code says otherwise',
    icon: 'alert',
    tone: 'text-fail',
  },
};

/** `check` is already this app's word for an assertion, so none of the copy reuses it. */
const COUNT: Record<StepCheckVerdict, string> = {
  confirmed: 'confirmed',
  unsupported: 'unsettled',
  wrong: 'contradicted',
};

/** Worst first, and a verdict nothing landed on is left out rather than shown as zero. */
function tally(checks: StepCheck[]) {
  const order: StepCheckVerdict[] = ['wrong', 'unsupported', 'confirmed'];
  return order
    .map((verdict) => ({ verdict, n: checks.filter((c) => c.verdict === verdict).length }))
    .filter((row) => row.n > 0);
}

/** The panel's numbers, so a clean pass says so without a row per step. */
export function ChecksTally({ checks }: { checks: StepCheck[] }) {
  return (
    <span className="nums flex shrink-0 items-center gap-2 font-mono text-[11px]">
      {tally(checks).map(({ verdict, n }) => (
        <span key={verdict} className={VERDICT[verdict].tone}>
          {n} {COUNT[verdict]}
        </span>
      ))}
    </span>
  );
}

/**
 * What the third pass found, for the person deciding whether to approve.
 *
 * Only the doubts get a row. A confirmation is a step that needs no attention, and
 * fourteen green rows would bury the one that says the field is called something else
 * -- the tally in the header is where a confirmation is worth counting.
 *
 * Each row names the step and carries the note as written, which is the whole reason
 * the verdicts are stored: "step 4 is wrong" is not actionable, and "`guests.email` is
 * `email_address` in the migration" is.
 */
export function StepChecks({
  steps,
  checks,
  hrefFor,
}: {
  steps: PlanStepSpec[];
  checks: StepCheck[];
  hrefFor: (stepId: string) => string;
}) {
  const at = new Map(steps.map((step, i) => [step.id, i]));
  const named = new Map(steps.map((step) => [step.id, step.name]));
  const doubts = checks
    .filter(checkIsDoubt)
    .sort((a, b) => (at.get(a.stepId) ?? 0) - (at.get(b.stepId) ?? 0));

  if (doubts.length === 0) {
    return (
      <p className="flex items-start gap-2.5 px-4 py-3 text-[13px] leading-snug text-ink-muted">
        <Icon name="check" size={13} className="mt-[3px] shrink-0 text-pass" />
        Every step was traced back to the code or to a call this project really made. That is not a
        promise the plan passes — it means nothing in it was invented.
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {doubts.map((check) => {
        const index = at.get(check.stepId);
        const verdict = VERDICT[check.verdict];

        return (
          <li key={check.stepId} className="border-b border-rule-soft last:border-b-0">
            <Link
              href={hrefFor(check.stepId)}
              className="flex gap-2.5 px-4 py-2.5 transition-colors duration-150 hover:bg-app-hover"
            >
              <Icon
                name={verdict.icon}
                size={13}
                className={cn('mt-[3px] shrink-0', verdict.tone)}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] leading-snug">
                  <span className={cn('font-medium', verdict.tone)}>{verdict.label}</span>
                  <span className="text-ink-subtle"> · </span>
                  <span className="nums text-ink">
                    {index === undefined ? check.stepId : `step ${index + 1}`}
                  </span>
                  {named.get(check.stepId) && (
                    <span className="text-ink-muted">, {named.get(check.stepId)}</span>
                  )}
                </p>
                <Prose size="sm" className="mt-1">
                  {check.note}
                </Prose>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The same verdict in the spine, so a flagged step is visible while scrolling steps. */
export function CheckMark({ check }: { check: StepCheck | undefined }) {
  if (!check || !checkIsDoubt(check)) return null;
  const verdict = VERDICT[check.verdict];

  return (
    <span className={cn('flex items-center gap-1 text-[11px] font-medium', verdict.tone)}>
      <Icon name={verdict.icon} size={11} />
      {verdict.label}
    </span>
  );
}

/** And in the drawer, where the note has room to be read. */
export function CheckNote({ check }: { check: StepCheck | undefined }) {
  if (!check || !checkIsDoubt(check)) return null;
  const verdict = VERDICT[check.verdict];

  return (
    <div
      className={cn(
        'flex gap-2.5 border-b px-4 py-3',
        check.verdict === 'wrong'
          ? 'border-fail/20 bg-fail-soft/50'
          : 'border-warn/20 bg-warn-soft/50',
      )}
    >
      <Icon name={verdict.icon} size={14} className={cn('mt-px shrink-0', verdict.tone)} />
      <div className="min-w-0">
        <p className="text-[12.5px] leading-snug font-medium text-ink">{verdict.heading}</p>
        <Prose size="sm" className="mt-1">
          {check.note}
        </Prose>
      </div>
    </div>
  );
}
