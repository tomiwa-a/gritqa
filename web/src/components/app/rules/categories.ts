import type { IconName } from '@/components/ui/icon';
import { mockTargetOf } from '@/lib/plan';
import type { RuleCategory, TestingRule } from '@/lib/model';

/**
 * One source for what the four rule categories are called, because three screens
 * now name them and they were each carrying their own copy of the list.
 *
 * Two label sets on purpose: the full one for a screen with room for it, and the
 * short one for the narrow panel on a plan, where `Assertions` does not fit. Same
 * for the blurbs -- a sentence when it is a heading, a fragment when it trails a
 * list of rule names.
 */
export const CATEGORY: Record<
  RuleCategory,
  {
    /** Full name, for a heading with room. */
    label: string;
    /** Short name, for the plan panel's fixed label column. */
    short: string;
    icon: IconName;
    /** Sentence case — a heading's subtitle. */
    blurb: string;
    /** Lowercase fragment — trails the rule names on a plan. */
    applied: string;
    tone: string;
    /**
     * A real detail line from this category, shown as the editor's placeholder so
     * the shape of the field is demonstrated rather than described.
     */
    example: string;
  }
> = {
  ordering: {
    label: 'Ordering',
    short: 'Order',
    icon: 'runs',
    blurb: 'What runs before what',
    applied: 'what runs before what',
    tone: 'text-series-1',
    example: 'priority 2 — never assert on a list before seeding it',
  },
  mock: {
    label: 'Mocks',
    short: 'Mocks',
    icon: 'mock',
    blurb: 'Who answers instead of the real service',
    applied: 'stood in for a provider',
    tone: 'text-series-4',
    example: 'target stripe — signed event, 200',
  },
  assertion: {
    label: 'Assertions',
    short: 'Checks',
    icon: 'check',
    blurb: 'What every step must hold to',
    applied: 'added to every step',
    tone: 'text-series-2',
    example: 'status notEquals 500 on every step',
  },
  fixture: {
    label: 'Fixtures',
    short: 'Values',
    icon: 'database',
    blurb: 'The values each run is given',
    applied: 'reused across plans',
    tone: 'text-series-3',
    example: 'testAmount — 50000 minor units',
  },
};

/** Cheapest first, roughly: order, then who answers, then what is checked, then values. */
export const CATEGORY_ORDER: RuleCategory[] = ['ordering', 'mock', 'assertion', 'fixture'];

/**
 * What a rule applies to, in words. Only mock rules are conditional — the other
 * three are imposed on a draft whatever it turns out to contain.
 */
export function scopeOf(rule: TestingRule): string {
  if (rule.category !== 'mock') return 'Every plan drafted while this is on.';
  const target = mockTargetOf(rule);
  /* Same `while this is on` qualifier as the blanket categories, so the sentence
     stays true of a rule that is currently off. */
  return target
    ? `Only plans that reach ${target}, while this is on.`
    : 'Only plans that reach the service this rule names, while this is on.';
}
