import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects, users } from '@/lib/db/schema';
import type { OAuthProfile } from '@/lib/oauth';
import type { Provider } from '@/lib/model';
import type { ProjectRow, UserRow } from '@/lib/db/schema';

/**
 * Sign-in is an upsert on `(provider, provider_id)`, not on email.
 *
 * Matching on email would be a vulnerability rather than a convenience: an
 * attacker who controls an address on one provider could land in the account of
 * whoever holds it on another. The provider's own id is the stable identity, so
 * name, avatar and email are refreshed onto whatever row that pair already names.
 */
export async function upsertUserFromProfile(
  provider: Provider,
  profile: OAuthProfile,
): Promise<UserRow> {
  const [row] = await db
    .insert(users)
    .values({
      provider,
      providerId: profile.providerId,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    })
    .onConflictDoUpdate({
      target: [users.provider, users.providerId],
      set: { email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl },
    })
    .returning();

  return row;
}

export async function findUserByPublicId(publicId: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.publicId, publicId)).limit(1);
  return row ?? null;
}

export async function listProjectsForUser(userId: number): Promise<ProjectRow[]> {
  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(projects.createdAt, projects.id);
}

/**
 * A project id from a cookie is still user input, so it is only honoured when it
 * belongs to the signed-in user. Falls back to their first project rather than
 * failing -- a stale switcher selection is not an error state.
 */
export async function resolveProjectForUser(
  userId: number,
  publicId: string | null,
): Promise<ProjectRow | null> {
  if (publicId) {
    const [owned] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.publicId, publicId), eq(projects.userId, userId)))
      .limit(1);
    if (owned) return owned;
  }
  const [first] = await listProjectsForUser(userId);
  return first ?? null;
}

/**
 * Sets or clears the stored model key. Takes ciphertext, never a key.
 *
 * The encryption happens in the action above this, which means a reader of this
 * file cannot find a path where a plaintext key reaches a column -- there isn't
 * one to find. `null` clears, and clearing is a normal thing to want: it is how a
 * developer revokes drafting.
 */
export async function setAiKey(userId: number, ciphertext: string | null): Promise<void> {
  await db.update(users).set({ aiApiKey: ciphertext }).where(eq(users.id, userId));
}
