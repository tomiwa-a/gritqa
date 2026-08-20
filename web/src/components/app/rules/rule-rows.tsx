import Link from 'next/link';
import { RuleSwitch } from './rule-switch';
import { getAllPlans, getPlanDetails, getRules } from '@/lib/data';
import { reachOf } from '@/lib/plan';
import type { TestingRule } from '@/lib/model';
import { cn } from '@/lib/cn';

/**
 * One row per rule. The switch is a sibling of the link rather than inside it,
 * because a control nested in a link is a control you cannot reliably hit — so
 * the row hands off its width to the link and keeps the toggle out of it.
 *
 * An inactive rule mutes its name rather than dimming the whole row: the switch
 * is what you came for, and greying out the way back on is the wrong instinct.
 */
export async function RuleRows({
  rules,
  hrefFor,
}: {
  rules: TestingRule[];
  hrefFor: (publicId: string) => string;
}) {
  if (rules.length === 0) {
    return (
      <p className="px-4 py-3.5 text-[12.5px] leading-relaxed text-ink-muted">
        Nothing here yet. Add a rule and every plan drafted after it follows it.
      </p>
    );
  }

  /* Reach is read off every rule and every plan, not just this group's, so it is
     resolved once here -- a map over JSX has nowhere to await. */
  const [allRules, allPlans, details] = await Promise.all([
    getRules(),
    getAllPlans(),
    getPlanDetails(),
  ]);
  const reachFor = new Map(
    rules.map((rule) => [rule.publicId, reachOf(allRules, allPlans, details, rule)]),
  );

  return (
    <ul className="flex flex-col">
      {rules.map((rule) => {
        const reach = reachFor.get(rule.publicId)!;

        return (
          <li
            key={rule.publicId}
            className="flex items-center gap-3 border-b border-rule-soft px-4 py-3 transition-colors duration-150 last:border-b-0 hover:bg-app-hover"
          >
            <Link href={hrefFor(rule.publicId)} scroll={false} className="min-w-0 flex-1">
              <span
                className={cn(
                  'block truncate text-[13px] font-medium',
                  rule.isActive ? 'text-ink' : 'text-ink-subtle',
                )}
              >
                {rule.name}
              </span>
              <span className="block truncate text-[12px] text-ink-subtle">{rule.detail}</span>
            </Link>

            <span className="nums hidden shrink-0 text-[12px] text-ink-subtle sm:block">
              {rule.isActive
                ? `${reach.plans.length} plan${reach.plans.length === 1 ? '' : 's'}`
                : 'off'}
            </span>

            <RuleSwitch
              publicId={rule.publicId}
              name={rule.name}
              isActive={rule.isActive}
            />
          </li>
        );
      })}
    </ul>
  );
}
