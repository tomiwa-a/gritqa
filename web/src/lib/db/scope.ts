import { cache } from 'react';
import { readSession } from '@/lib/session';
import { findUserByPublicId, resolveProjectForUser } from '@/lib/db/auth';

/**
 * The two numeric ids every project-scoped read and write needs.
 *
 * The read model speaks in `public_id`, because that is what a URL can carry, but
 * foreign keys are BIGINTs -- so something has to turn one into the other, and it
 * should be one thing rather than a resolution repeated in every query module.
 *
 * Both halves are re-checked rather than trusted. `uid` comes from a signed
 * cookie, but the row it names can have been deleted since; `pid` is honoured only
 * when it belongs to that user, so a stale or edited switcher selection falls back
 * to their own first project instead of reaching someone else's.
 *
 * This is the boundary that stands in for row-level security while the app
 * connects to Postgres as the owner of its tables -- an owner is exempt from RLS
 * policies unless the table is FORCE'd, so a policy written today would not be
 * doing the work it appears to. Every scoped query goes through here, which makes
 * the eventual `current_setting('app.user_id')` version a change in one file.
 */
export type Scope = { userId: number; projectId: number; projectPublicId: string };

export const currentScope = cache(async (): Promise<Scope | null> => {
  const session = await readSession();
  if (!session) return null;

  const user = await findUserByPublicId(session.uid);
  if (!user) return null;

  const project = await resolveProjectForUser(user.id, session.pid);
  if (!project) return null;

  return { userId: user.id, projectId: project.id, projectPublicId: project.publicId };
});

/**
 * For writes, where there is no sensible empty answer: a caller that has reached
 * a mutation without a session and a project is a bug in the caller, not a state
 * to render.
 */
export async function requireScope(): Promise<Scope> {
  const scope = await currentScope();
  if (!scope) throw new Error('no signed-in developer with a project');
  return scope;
}
