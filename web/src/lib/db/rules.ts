import { and, asc, eq, not } from 'drizzle-orm';
import { db } from '@/lib/db';
import { testingRules } from '@/lib/db/schema';
import type { TestingRuleRow } from '@/lib/db/schema';
import type { RuleCategory, TestingRule } from '@/lib/model';

/**
 * Rules, which are the one thing in here a developer writes by hand.
 *
 * `rule_config` is JSONB rather than four columns because the four categories want
 * different fields, and inventing a union of them all would leave three quarters of
 * every row null. The structured per-category form is still the goal -- an
 * assertion as target x operator x expected, an ordering rule as a number -- and
 * `ruleDetail` below is written so that arriving does not change what the screens
 * render.
 */
export type RuleConfig = {
  /** The line the drafter is handed, and today the only field the editor writes. */
  description?: string;
  /** Structured fields, for when the editor grows them. */
  priority?: number;
  target?: string;
  field?: string;
  operator?: string;
  expected?: unknown;
  [key: string]: unknown;
};

/**
 * The config, in the words the rules screen shows.
 *
 * The mock rules were written as if something produced them from a config --
 * `priority 1 — test authentication before other endpoints`, `target paystack —
 * 200, status success, amount 10000` -- so this is that something. A config
 * carrying only a description renders as just the description, which is what the
 * editor writes today and why the swap changes nothing on screen.
 */
export function ruleDetail(category: RuleCategory, config: RuleConfig): string {
  const description = typeof config.description === 'string' ? config.description.trim() : '';

  const prefix = (() => {
    if (category === 'ordering' && typeof config.priority === 'number') {
      return `priority ${config.priority}`;
    }
    if (category === 'mock' && typeof config.target === 'string') {
      return `target ${config.target}`;
    }
    if (category === 'assertion' && config.field && config.operator) {
      return [config.field, config.operator, config.expected].filter((v) => v != null).join(' ');
    }
    return '';
  })();

  if (prefix && description) return `${prefix} — ${description}`;
  return prefix || description;
}

export function toTestingRule(row: TestingRuleRow): TestingRule {
  return {
    publicId: row.publicId,
    name: row.name,
    category: row.category,
    isActive: row.isActive,
    detail: ruleDetail(row.category, (row.ruleConfig ?? {}) as RuleConfig),
  };
}

/**
 * Ordered by category and then by age, which is the order the screen groups them
 * in. Inactive rules are included: the switch has to have something to be off on.
 */
export async function listRules(projectId: number): Promise<TestingRuleRow[]> {
  return db
    .select()
    .from(testingRules)
    .where(eq(testingRules.projectId, projectId))
    .orderBy(asc(testingRules.category), asc(testingRules.createdAt), asc(testingRules.id));
}

export async function createRule(input: {
  projectId: number;
  name: string;
  category: RuleCategory;
  config: RuleConfig;
}): Promise<TestingRuleRow> {
  const [row] = await db
    .insert(testingRules)
    .values({
      projectId: input.projectId,
      name: input.name,
      category: input.category,
      ruleConfig: input.config,
    })
    .returning();
  return row;
}

/**
 * Every write takes the project id as well as the rule's public id, and matches on
 * both. A public id is a UUIDv7 and not guessable, but "not guessable" is not the
 * same guarantee as "not yours", and this is the difference between the two.
 */
export async function updateRule(
  projectId: number,
  publicId: string,
  patch: { name?: string; category?: RuleCategory; config?: RuleConfig; isActive?: boolean },
): Promise<TestingRuleRow | null> {
  const [row] = await db
    .update(testingRules)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.category === undefined ? {} : { category: patch.category }),
      ...(patch.config === undefined ? {} : { ruleConfig: patch.config }),
      ...(patch.isActive === undefined ? {} : { isActive: patch.isActive }),
    })
    .where(and(eq(testingRules.publicId, publicId), eq(testingRules.projectId, projectId)))
    .returning();
  return row ?? null;
}

/** Flips whatever the row currently says, so two tabs cannot both turn it "on". */
export async function toggleRule(
  projectId: number,
  publicId: string,
): Promise<TestingRuleRow | null> {
  const [row] = await db
    .update(testingRules)
    .set({ isActive: not(testingRules.isActive) })
    .where(and(eq(testingRules.publicId, publicId), eq(testingRules.projectId, projectId)))
    .returning();
  return row ?? null;
}

/**
 * Returns the row it removed, because the audit entry has to be phrased from it: a
 * deleted rule cannot be looked up afterwards to find out what it was called, and
 * "A rule removed" is a worse record than "Pagination envelope removed". Null means
 * nothing matched, which is a rule that was already gone.
 */
export async function deleteRule(
  projectId: number,
  publicId: string,
): Promise<TestingRuleRow | null> {
  const [row] = await db
    .delete(testingRules)
    .where(and(eq(testingRules.publicId, publicId), eq(testingRules.projectId, projectId)))
    .returning();
  return row ?? null;
}
