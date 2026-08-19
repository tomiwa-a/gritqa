import Link from 'next/link';
import { Switch } from '@/components/ui/switch';
import { reachOf } from '@/lib/plan';
import type { TestingRule } from '@/lib/mock/types';
import { cn } from '@/lib/cn';

/**
 * One row per rule. The switch is a sibling of the link rather than inside it,
 * because a control nested in a link is a control you cannot reliably hit — so
 * the row hands off its width to the link and keeps the toggle out of it.
 *
 * An inactive rule mutes its name rather than dimming the whole row: the switch
 * is what you came for, and greying out the way back on is the wrong instinct.
 */
export function RuleRows({
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

  return (
    <ul className="flex flex-col">
      {rules.map((rule) => {
        const reach = reachOf(rule);

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

            <Switch
              label={`Turn ${rule.name} ${rule.isActive ? 'off' : 'on'}`}
              defaultOn={rule.isActive}
            />
          </li>
        );
      })}
    </ul>
  );
}
