import { Icon, type IconName } from '@/components/ui/icon';
import type { PlanChange, PlanRevision } from '@/lib/model';
import { cn } from '@/lib/cn';

const KIND: Record<
  PlanChange['kind'],
  { sign: string; label: string; icon: IconName; tone: string; mark: string }
> = {
  step_added: { sign: '+', label: 'Step added', icon: 'plus', tone: 'text-pass', mark: 'bg-pass' },
  step_removed: {
    sign: '−',
    label: 'Step removed',
    icon: 'close',
    tone: 'text-fail',
    mark: 'bg-fail',
  },
  step_reordered: {
    sign: '~',
    label: 'Step moved',
    icon: 'arrowRight',
    tone: 'text-info',
    mark: 'bg-info',
  },
  assertion_added: {
    sign: '+',
    label: 'Check added',
    icon: 'check',
    tone: 'text-pass',
    mark: 'bg-pass',
  },
  assertion_removed: {
    sign: '−',
    label: 'Check removed',
    icon: 'close',
    tone: 'text-fail',
    mark: 'bg-fail',
  },
  value_changed: {
    sign: '~',
    label: 'Value changed',
    icon: 'diff',
    tone: 'text-warn',
    mark: 'bg-warn',
  },
};

function Row({ change }: { change: PlanChange }) {
  const kind = KIND[change.kind];

  return (
    <li className="flex gap-3 border-t border-rule-soft px-4 py-2.5 first:border-t-0">
      <span
        aria-hidden
        className={cn('nums mt-px w-3 shrink-0 text-center font-mono text-[13px]', kind.tone)}
      >
        {kind.sign}
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
          <span className="text-ink">{change.detail}</span>
          <span className="text-[11px] text-ink-subtle">{kind.label}</span>
        </p>

        {change.from !== undefined && change.to !== undefined && (
          <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11.5px]">
            <span className="text-fail line-through decoration-fail/40">{change.from}</span>
            <Icon name="arrowRight" size={11} className="text-ink-subtle" />
            <span className="text-pass">{change.to}</span>
          </p>
        )}
      </div>
    </li>
  );
}

/** Every version leaves a receipt. Without it, "refine" is just a black box. */
export function PlanDiff({
  revision,
  previous,
  className,
}: {
  revision: PlanRevision;
  previous: PlanRevision | undefined;
  className?: string;
}) {
  const byStep = revision.changes.reduce<Map<string, PlanChange[]>>((acc, change) => {
    const list = acc.get(change.stepName);
    if (list) list.push(change);
    else acc.set(change.stepName, [change]);
    return acc;
  }, new Map());

  const counts = revision.changes.reduce<Record<string, number>>((acc, c) => {
    const sign = KIND[c.kind].sign;
    acc[sign] = (acc[sign] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className={cn('flex flex-col', className)}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-rule-soft px-4 py-3">
        <span className="nums flex items-center gap-1.5 font-mono text-[12px] text-ink">
          {previous ? (
            <>
              v{previous.version}
              <Icon name="arrowRight" size={11} className="text-ink-subtle" />
            </>
          ) : null}
          v{revision.version}
        </span>
        <span className="text-[11.5px] text-ink-subtle">{revision.whenLabel}</span>

        {revision.changes.length > 0 && (
          <span className="nums ml-auto flex items-center gap-2 font-mono text-[11.5px]">
            {counts['+'] && <span className="text-pass">+{counts['+']}</span>}
            {counts['−'] && <span className="text-fail">−{counts['−']}</span>}
            {counts['~'] && <span className="text-warn">~{counts['~']}</span>}
          </span>
        )}
      </header>

      <div className="border-b border-rule-soft px-4 py-3">
        {revision.instruction && (
          <blockquote className="mb-2.5 border-l-2 border-punch-red pl-3 text-[12.5px] leading-relaxed text-ink">
            {revision.instruction}
          </blockquote>
        )}
        <p className="text-[13px] leading-relaxed text-ink-muted">{revision.summary}</p>
      </div>

      {revision.changes.length === 0 ? (
        <p className="px-4 py-8 text-center text-[12.5px] text-ink-subtle">
          {previous
            ? 'Nothing changed structurally in this version.'
            : 'This is the first draft, so there is nothing before it to compare.'}
        </p>
      ) : (
        <div className="flex flex-col">
          {[...byStep.entries()].map(([stepName, changes]) => (
            <section key={stepName} className="border-b border-rule-soft last:border-b-0">
              <h4 className="flex items-center gap-2 bg-app px-4 py-2 text-[12px] font-medium text-ink">
                <span aria-hidden className="h-3 w-[2px] shrink-0 rounded-full bg-rule-strong" />
                <span className="truncate">{stepName}</span>
              </h4>
              <ul>
                {changes.map((change, i) => (
                  <Row key={i} change={change} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
