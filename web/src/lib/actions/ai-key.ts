'use server';

import { revalidatePath } from 'next/cache';
import { clientIp } from '@/lib/client-ip';
import { encryptSecret } from '@/lib/crypto';
import { record } from '@/lib/db/audit';
import { findUserByPublicId, setAiKey } from '@/lib/db/auth';
import { readSession } from '@/lib/session';
import type { UserRow } from '@/lib/db/schema';

/**
 * The two writes behind the model-key field.
 *
 * A key is the one value in this app that is worth more to an attacker than
 * everything else in the database put together -- it bills to someone else's
 * account. So it is handled here and nowhere else: encrypted before the query
 * layer sees it, never returned, never revalidated into a payload, and never
 * passed to anything that could log it. The error strings below are deliberately
 * about the *shape* of what was pasted and never quote it back.
 *
 * Both writes are audited, and the audit row carries no part of the key -- not a
 * prefix, not a length. That a key changed is what the timeline needs; the value is
 * the thing this file exists to keep out of everything, the log included.
 */
export type KeyFormState = { error: string } | { ok: true } | null;

/** Providers differ, so this checks for a pasted key rather than a known format. */
function problemWith(key: string): string | null {
  if (!key) return 'Paste a key first.';
  if (key.length < 8) return 'That is too short to be a provider key.';
  if (key.length > 500) return 'That is too long to be a provider key.';
  // A key with a space in it is almost always a whole command line, or a label
  // that came along with the copy. Saving it would fail later, at the provider,
  // where the reason would be much harder to see.
  if (/\s/.test(key)) return 'That looks like more than a key — paste just the key itself.';
  return null;
}

/** The row, not just the id: whether a key was already there decides the wording. */
async function currentUser(): Promise<UserRow | null> {
  const session = await readSession();
  if (!session) return null;
  return findUserByPublicId(session.uid);
}

export async function saveAiKeyAction(
  _previous: KeyFormState,
  formData: FormData,
): Promise<KeyFormState> {
  const raw = formData.get('key');
  const key = typeof raw === 'string' ? raw.trim() : '';

  const problem = problemWith(key);
  if (problem) return { error: problem };

  const user = await currentUser();
  if (!user) return { error: 'Your session has expired. Sign in and try again.' };

  await setAiKey(user.id, encryptSecret(key));
  await record({
    userId: user.id,
    action: 'user.ai_key.updated',
    entityType: 'users',
    entityId: user.id,
    values: { replaced: Boolean(user.aiApiKey) },
    ip: await clientIp(),
  });
  revalidatePath('/dashboard/settings/ai');
  revalidatePath('/dashboard/setup');
  revalidatePath('/dashboard/settings/activity');
  return { ok: true };
}

export async function removeAiKeyAction(): Promise<void> {
  const user = await currentUser();
  if (!user) return;

  await setAiKey(user.id, null);
  await record({
    userId: user.id,
    action: 'user.ai_key.removed',
    entityType: 'users',
    entityId: user.id,
    ip: await clientIp(),
  });
  revalidatePath('/dashboard/settings/ai');
  revalidatePath('/dashboard/setup');
  revalidatePath('/dashboard/settings/activity');
}
