'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { safePath } from '@/lib/after-auth';
import { clientIp } from '@/lib/client-ip';
import { record } from '@/lib/db/audit';
import { requireScope } from '@/lib/db/scope';
import { createRule, deleteRule, toggleRule, updateRule } from '@/lib/db/rules';
import type { RuleConfig } from '@/lib/db/rules';
import type { RuleCategory } from '@/lib/model';

/**
 * Writing rules down. Every action re-derives the project from the session rather
 * than accepting one, so a form cannot name a project the developer does not own --
 * the client is trusted for what the rule says, never for whose it is.
 *
 * Each one also appends to the audit log, after the write and never instead of it.
 * A rule change is worth recording because it changes what the next draft is handed:
 * "why did the agent stop mocking Paystack" is a question the timeline answers and
 * the rules screen, which only ever shows the current state, cannot.
 */
const CATEGORIES: RuleCategory[] = ['ordering', 'mock', 'assertion', 'fixture'];

function asCategory(value: unknown): RuleCategory | null {
  return CATEGORIES.find((c) => c === value) ?? null;
}

/**
 * A field the developer typed, bounded and trimmed. The column is VARCHAR(255) and
 * a 60kB name is a mistake or an attack; either way the answer is the same.
 */
function text(formData: FormData, key: string, max: number): string {
  return String(formData.get(key) ?? '')
    .trim()
    .slice(0, max);
}

export type RuleFormState = { error: string } | null;

/**
 * Returns a message rather than throwing, because the editor is a modal with the
 * developer's typing still in it -- an exception would replace the box with an
 * error page and take the text with it.
 */
export async function saveRuleAction(
  _previous: RuleFormState,
  formData: FormData,
): Promise<RuleFormState> {
  const name = text(formData, 'name', 255);
  const detail = text(formData, 'detail', 2000);
  const category = asCategory(formData.get('category'));

  if (!name) return { error: 'Give the rule a name.' };
  if (!detail) return { error: 'Say what the rule is.' };
  if (!category) return { error: 'Pick a category.' };

  const scope = await requireScope();

  // The whole line goes in as `description`. When the editor grows structured
  // fields per category, they land beside it and `ruleDetail` renders both.
  const config: RuleConfig = { description: detail };
  const publicId = text(formData, 'publicId', 64);

  const ip = await clientIp();

  if (publicId) {
    const row = await updateRule(scope.projectId, publicId, { name, category, config });
    if (!row) return { error: 'That rule no longer exists.' };
    await record({
      userId: scope.userId,
      action: 'testing_rule.updated',
      entityType: 'testing_rules',
      entityId: row.id,
      values: { name: row.name, category: row.category },
      ip,
    });
  } else {
    const row = await createRule({ projectId: scope.projectId, name, category, config });
    await record({
      userId: scope.userId,
      action: 'testing_rule.created',
      entityType: 'testing_rules',
      entityId: row.id,
      values: { name: row.name, category: row.category },
      ip,
    });
  }

  revalidatePath('/dashboard/rules');
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/settings/activity');

  // The editor is an overlay on whichever page opened it, so success means going
  // back to that page with the box closed. `closeHref` comes from the browser, so
  // it is only followed when it is a path this origin can serve.
  redirect(safePath(text(formData, 'closeHref', 2000)) ?? '/dashboard/rules');
}

export async function toggleRuleAction(formData: FormData): Promise<void> {
  const publicId = text(formData, 'publicId', 64);
  if (!publicId) return;

  const scope = await requireScope();
  const row = await toggleRule(scope.projectId, publicId);

  // `isActive` is read back off the returned row rather than assumed, so the entry
  // says what the rule became -- the flip happens in the UPDATE, and two tabs racing
  // means the value this request sent is not necessarily the one that landed.
  if (row) {
    await record({
      userId: scope.userId,
      action: 'testing_rule.updated',
      entityType: 'testing_rules',
      entityId: row.id,
      values: { name: row.name, isActive: row.isActive },
      ip: await clientIp(),
    });
  }

  // A rule going off changes what the next draft is handed, and the overview
  // counts active rules, so both pages are stale as of now. So is the timeline: it
  // gained an entry a moment ago, and a cached copy of it would not show the change
  // the developer just made.
  revalidatePath('/dashboard/rules');
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/settings/activity');
}

export async function deleteRuleAction(formData: FormData): Promise<void> {
  const publicId = text(formData, 'publicId', 64);
  if (!publicId) return;

  const scope = await requireScope();
  const row = await deleteRule(scope.projectId, publicId);

  if (row) {
    await record({
      userId: scope.userId,
      action: 'testing_rule.deleted',
      entityType: 'testing_rules',
      entityId: row.id,
      // The row is gone, so this is the only surviving copy of what it said. Keeping
      // the config as well as the name means the timeline can answer what was lost,
      // not just that something was.
      values: { name: row.name, category: row.category, config: row.ruleConfig },
      ip: await clientIp(),
    });
  }

  revalidatePath('/dashboard/rules');
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/settings/activity');
}
