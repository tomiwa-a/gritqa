import { cache } from 'react';
import { redirect } from 'next/navigation';
import { findUserByPublicId } from '@/lib/db/auth';
import { decryptSecret, maskKey } from '@/lib/crypto';
import { readSession } from '@/lib/session';
import type { UserRow } from '@/lib/db/schema';
import type { User } from '@/lib/mock/types';

/**
 * The signed-in developer, read from the `users` row the session cookie names.
 *
 * `cache` is React's per-request memo, not a cache across requests. Eight callers
 * ask for the user while rendering one page, and without it that is eight round
 * trips for one row.
 */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const session = await readSession();
  if (!session) return null;

  // The cookie is signed, so `uid` is ours -- but the row it names can have been
  // deleted since, which is a signed-out state rather than an error.
  const row = await findUserByPublicId(session.uid);
  return row ? toUser(row) : null;
});

/**
 * Keeps the shape every screen already expects: `getUser()` returns a user, not a
 * maybe-user. There is no page behind the session gate that can render without
 * one, so the alternative to a redirect is 29 call sites each handling null the
 * same way.
 */
export async function getUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

/**
 * The masked tail is the only form of a model key that reaches a page, and a key
 * that will not decrypt is reported as no key at all -- which is what it is. That
 * happens when `AI_KEY_SECRET` has been rotated, and the honest consequence is
 * that the developer re-enters it.
 */
function toUser(row: UserRow): User {
  const key = row.aiApiKey ? decryptSecret(row.aiApiKey) : null;
  return {
    publicId: row.publicId,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatarUrl,
    provider: row.provider,
    hasAiKey: key !== null,
    aiKeyMasked: key ? maskKey(key) : null,
  };
}
