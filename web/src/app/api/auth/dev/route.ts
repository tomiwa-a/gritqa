import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { listProjectsForUser } from '@/lib/db/auth';
import { clientIp } from '@/lib/client-ip';
import { record } from '@/lib/db/audit';
import { newSession, writeSession } from '@/lib/session';
import { safePath } from '@/lib/after-auth';

/**
 * Signs in as the seeded local developer without an OAuth app.
 *
 * Registering OAuth apps is the one part of W2 that cannot be done from here, and
 * without this route the dashboard would be unreachable until someone does it.
 * That is a bad trade for local work, so this exists -- behind two locks, both of
 * which have to be open:
 *
 *   1. NODE_ENV must not be production. A production build has no code path here.
 *   2. GRITQA_DEV_LOGIN must be set, so a development server does not grow a
 *      back door just by existing.
 *
 * It mints a session for whichever user the seed created. It cannot create a user
 * and it cannot choose one, so it grants nothing that `npm run db:seed` did not
 * already put in the database.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production' || !process.env.GRITQA_DEV_LOGIN) {
    redirect('/login');
  }

  const [user] = await db.select().from(users).orderBy(users.id).limit(1);
  if (!user) redirect('/login?error=no_seeded_user');

  const projects = await listProjectsForUser(user.id);
  await writeSession(newSession(user.publicId, projects[0]?.publicId ?? null));

  // Audited like any other sign-in, and named for what it is. A back door that leaves
  // the same entry as GitHub would be the one part of this route worth objecting to.
  await record({
    userId: user.id,
    action: 'user.login',
    entityType: 'users',
    entityId: user.id,
    values: { provider: 'the local dev route' },
    ip: await clientIp(),
  });

  // No provider hop, so there is no cookie to read the destination back out of --
  // it is still on the URL the login page linked to.
  const after = safePath(request.nextUrl.searchParams.get('next'));
  redirect(after ?? (projects.length ? '/dashboard' : '/onboarding'));
}
