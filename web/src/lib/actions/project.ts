'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { findUserByPublicId, listProjectsForUser } from '@/lib/db/auth';
import { readSession, writeSession } from '@/lib/session';

/**
 * Switching project, which the switcher has never been able to do. Every row in the
 * menu was `onClick={() => setOpen(false)}`, so the list rendered, the check mark sat
 * against the right project, and picking another one closed the menu and changed
 * nothing -- there was no action behind it to call.
 *
 * The choice lives on the signed session cookie, so switching means re-signing it.
 * The id is checked against the projects this developer owns rather than trusted.
 * Reads already fall back to the first project when `pid` names something unowned,
 * so a forged id could never widen what it sees; what it could do is look like a
 * switch that silently landed on the wrong project.
 *
 * It ends on /dashboard rather than where you were standing, because most of what
 * you can be looking at belongs to the project you just left: `getPlanDetail` scopes
 * by project id, so a plan URL survives the switch only as a 404.
 */
export async function switchProjectAction(formData: FormData): Promise<void> {
  const wanted = String(formData.get('project') ?? '').trim();

  const session = await readSession();
  if (!session) redirect('/login');
  if (!wanted || wanted === session.pid) redirect('/dashboard');

  const user = await findUserByPublicId(session.uid);
  if (!user) redirect('/login');

  const owned = await listProjectsForUser(user.id);
  if (!owned.some((project) => project.publicId === wanted)) redirect('/dashboard');

  await writeSession({ ...session, pid: wanted });
  // The switcher and every count in the shell come from the dashboard layout, which
  // is cached per path -- without this the new project's name appears and the page
  // under it is still the old project's.
  revalidatePath('/dashboard', 'layout');
  redirect('/dashboard');
}
