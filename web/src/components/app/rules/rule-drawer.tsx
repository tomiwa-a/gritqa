import Link from 'next/link';
import { Drawer, DrawerBlock } from '../drawer';
import { RuleSwitch } from './rule-switch';
import { Icon } from '@/components/ui/icon';
import { buttonVariants } from '@/components/ui/button';
import { CATEGORY, scopeOf } from './categories';
import { getAllPlans, getPlanDetails, getRules } from '@/lib/data';
import { deleteRuleAction } from '@/lib/actions/rules';
import { reachOf } from '@/lib/plan';

const STATUS_WORD = { draft: 'Draft', approved: 'Approved', archived: 'Archived' } as const;

/**
 * A rule on its own, and the thing the list cannot show: what it is currently
 * shaping. Turning a rule off is the one edit here with reach beyond itself, so
 * the plans it touches are named before the switch is in reach, not after.
 */
export async function RuleDrawer({
  id,
  closeHref,
  editHref,
}: {
  id: string;
  closeHref: string;
  editHref: string;
}) {
  const [rules, allPlans, details] = await Promise.all([
    getRules(),
    getAllPlans(),
    getPlanDetails(),
  ]);

  const rule = rules.find((r) => r.publicId === id);
  if (!rule) return null;

  const meta = CATEGORY[rule.category];
  const reach = reachOf(rules, allPlans, details, rule);
  const count = reach.plans.length;

  return (
    <Drawer
      id="rule"
      closeHref={closeHref}
      label="rule"
      eyebrow={meta.label}
      title={rule.name}
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium text-ink">Active</p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-ink-subtle">
              {rule.isActive
                ? `Shaping ${count} plan${count === 1 ? '' : 's'}. Turning it off only changes the next draft.`
                : 'Off, so nothing follows it. Turn it on and the next draft does.'}
            </p>
          </div>
          <RuleSwitch publicId={rule.publicId} name={rule.name} isActive={rule.isActive} />
        </div>
      }
    >
      <DrawerBlock label="What it does">
        <p className="text-[12.5px] leading-relaxed text-ink-muted">{rule.detail}</p>
        <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-ink-subtle">
          <Icon name={meta.icon} size={12} className={`mt-px shrink-0 ${meta.tone}`} />
          {meta.blurb}
        </p>
      </DrawerBlock>

      <DrawerBlock label="Applies to">
        <p className="text-[12.5px] leading-relaxed text-ink-muted">{scopeOf(rule)}</p>
      </DrawerBlock>

      <DrawerBlock label="This rule">
        <div className="flex items-center gap-2">
          <Link
            href={editHref}
            scroll={false}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <Icon name="pencil" size={13} />
            Edit
          </Link>

          {/* Its own form, so it is a real submission rather than a click handler,
              and so it needs no JavaScript to work. */}
          <form action={deleteRuleAction}>
            <input type="hidden" name="publicId" value={rule.publicId} />
            <button type="submit" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              <Icon name="trash" size={13} />
              Delete
            </button>
          </form>
        </div>
        <p className="mt-2 text-[11.5px] leading-snug text-ink-subtle">
          Deleting it leaves every plan already drafted under it alone. Only the next draft changes.
        </p>
      </DrawerBlock>

      <DrawerBlock
        label="Plans it shaped"
        meta={rule.isActive && count > 0 ? String(count) : undefined}
      >
        {!rule.isActive ? (
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            Nothing, while it is off. Turn it on and it applies from the next draft onward.
          </p>
        ) : count === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            No plan on record reaches it yet, so it has shaped nothing so far.
          </p>
        ) : (
          <ul className="-mx-1 flex flex-col">
            {reach.plans.map((plan) => (
              <li key={plan.publicId}>
                <Link
                  href={`/dashboard/test-plans/${plan.publicId}`}
                  className="group flex items-center gap-2 rounded-md px-1 py-1.5 transition-colors duration-150 hover:bg-app-hover"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">{plan.name}</span>
                    <span className="block text-[11px] text-ink-subtle">
                      {STATUS_WORD[plan.status]}
                    </span>
                  </span>
                  <Icon
                    name="chevronRight"
                    size={13}
                    className="shrink-0 text-ink-subtle transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* Only a mock rule can be unknown, and only where the steps are missing.
            Saying so beats implying every plan was checked. */}
        {rule.isActive && reach.unknown > 0 && (
          <p className="mt-2 border-t border-rule-soft pt-2 text-[11.5px] leading-snug text-ink-subtle">
            {reach.unknown} other plan{reach.unknown === 1 ? '' : 's'} have no steps on record, so
            this rule could not be checked against {reach.unknown === 1 ? 'it' : 'them'}.
          </p>
        )}
      </DrawerBlock>
    </Drawer>
  );
}
