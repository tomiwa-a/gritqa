import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { CATEGORY } from '../rules/categories';
import { getRules } from '@/lib/data';
import { rulesFor } from '@/lib/plan';
import type { RuleCategory, TestPlanDetail } from '@/lib/model';
import { cn } from '@/lib/cn';

/* Its own order, not the Rules page's: on a plan, what ran and what was checked
   are the two things you read first, and mocks are a detail of how. */
const ORDER: RuleCategory[] = ['ordering', 'assertion', 'mock', 'fixture'];

export async function RulesApplied({
  plan,
  className,
}: {
  plan: TestPlanDetail;
  className?: string;
}) {
  const applied = rulesFor(await getRules(), plan);

  if (applied.length === 0) {
    return (
      <p className={cn('px-4 py-3.5 text-[12.5px] text-ink-muted', className)}>
        No rules were active when this was drafted, so nothing was imposed on it.{' '}
        <Link
          href="/dashboard/rules"
          className="font-medium text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
        >
          Set some up
        </Link>{' '}
        and the next draft will follow them.
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <p className="px-4 pt-3.5 pb-3 text-[12.5px] text-ink-muted">
        <span className="nums font-medium text-ink">{applied.length} rules</span> shaped this draft.
        Change one and the next version follows the new one.
      </p>

      <dl className="border-t border-rule-soft">
        {ORDER.map((category) => {
          const group = applied.filter((r) => r.category === category);
          if (group.length === 0) return null;
          const meta = CATEGORY[category];

          return (
            <div key={category} className="flex gap-3 px-4 py-2.5">
              <dt className="flex w-[5.5rem] shrink-0 items-baseline gap-1.5">
                <Icon name="rules" size={12} className={cn('mt-px', meta.tone)} />
                <span className="text-[12px] font-medium text-ink">{meta.short}</span>
              </dt>
              <dd className="min-w-0 flex-1">
                <p className="text-[12.5px] leading-snug text-ink-muted">
                  {group.map((r) => r.name).join(' · ')}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-subtle">{meta.applied}</p>
              </dd>
            </div>
          );
        })}
      </dl>

      <Link
        href="/dashboard/rules"
        className="group flex items-center gap-1.5 border-t border-rule-soft px-4 py-2.5 text-[12.5px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
      >
        Manage rules
        <Icon
          name="arrowRight"
          size={13}
          className="transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </Link>
    </div>
  );
}
