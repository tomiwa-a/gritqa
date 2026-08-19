'use server';

import { revalidatePath } from 'next/cache';
import { encryptSecret } from '@/lib/crypto';
import { findUserByPublicId, setAiKey } from '@/lib/db/auth';
import { readSession } from '@/lib/session';

/**
 * The two writes behind the model-key field.
 *
 * A key is the one value in this app that is worth more to an attacker than
 * everything else in the database put together -- it bills to someone else's
 * account. So it is handled here and nowhere else: encrypted before the query
 * layer sees it, never returned, never revalidated into a payload, and never
 * passed to anything that could log it. The error strings below are deliberately
 * about the *shape* of what was pasted and never quote it back.
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

async function currentUserId(): Promise<number | null> {
  const session = await readSession();
  if (!session) return null;
  const user = await findUserByPublicId(session.uid);
  return user?.id ?? null;
}

export async function saveAiKeyAction(
  _previous: KeyFormState,
  formData: FormData,
): Promise<KeyFormState> {
  const raw = formData.get('key');
  const key = typeof raw === 'string' ? raw.trim() : '';

  const problem = problemWith(key);
  if (problem) return { error: problem };

  const userId = await currentUserId();
  if (!userId) return { error: 'Your session has expired. Sign in and try again.' };

  await setAiKey(userId, encryptSecret(key));
  revalidatePath('/dashboard/settings/ai');
  revalidatePath('/dashboard/setup');
  return { ok: true };
}

export async function removeAiKeyAction(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;

  await setAiKey(userId, null);
  revalidatePath('/dashboard/settings/ai');
  revalidatePath('/dashboard/setup');
}
