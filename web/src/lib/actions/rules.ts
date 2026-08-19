'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { safePath } from '@/lib/after-auth';
import { requireScope } from '@/lib/db/scope';
import { createRule, deleteRule, toggleRule, updateRule } from '@/lib/db/rules';
import type { RuleConfig } from '@/lib/db/rules';
import type { RuleCategory } from '@/lib/mock/types';

/**
 * Writing rules down. Every action re-derives the project from the session rather
 * than accepting one, so a form cannot name a project the developer does not own --
 * the client is trusted for what the rule says, never for whose it is.
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

  if (publicId) {
    const row = await updateRule(scope.projectId, publicId, { name, category, config });
    if (!row) return { error: 'That rule no longer exists.' };
  } else {
    await createRule({ projectId: scope.projectId, name, category, config });
  }

  revalidatePath('/dashboard/rules');
  revalidatePath('/dashboard');

  // The editor is an overlay on whichever page opened it, so success means going
  // back to that page with the box closed. `closeHref` comes from the browser, so
  // it is only followed when it is a path this origin can serve.
  redirect(safePath(text(formData, 'closeHref', 2000)) ?? '/dashboard/rules');
}

export async function toggleRuleAction(formData: FormData): Promise<void> {
  const publicId = text(formData, 'publicId', 64);
  if (!publicId) return;

  const scope = await requireScope();
  await toggleRule(scope.projectId, publicId);

  // A rule going off changes what the next draft is handed, and the overview
  // counts active rules, so both pages are stale as of now.
  revalidatePath('/dashboard/rules');
  revalidatePath('/dashboard');
}

export async function deleteRuleAction(formData: FormData): Promise<void> {
  const publicId = text(formData, 'publicId', 64);
  if (!publicId) return;

  const scope = await requireScope();
  await deleteRule(scope.projectId, publicId);

  revalidatePath('/dashboard/rules');
  revalidatePath('/dashboard');
}
