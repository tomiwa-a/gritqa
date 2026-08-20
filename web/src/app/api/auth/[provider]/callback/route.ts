import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { STATE_COOKIE } from '../route';
import { OAuthError, PROVIDERS, exchangeCode, isProvider } from '@/lib/oauth';
import { listProjectsForUser, upsertUserFromProfile } from '@/lib/db/auth';
import { clientIp } from '@/lib/client-ip';
import { record } from '@/lib/db/audit';
import { newSession, writeSession } from '@/lib/session';
import { takeAfterAuth } from '@/lib/after-auth';

/**
 * Step two: the provider sends the developer back here with a code.
 *
 * Everything that can go wrong ends as a redirect to `/auth/callback`, which is a
 * page that already knows how to explain `access_denied` and `invalid_state`. This
 * handler renders nothing -- by the time a human sees anything, they are either
 * signed in or on that page.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  if (!isProvider(provider)) redirect('/login');

  const destination = await handle(request, provider);
  redirect(destination);
}

async function handle(request: NextRequest, provider: keyof typeof PROVIDERS): Promise<string> {
  const failure = (code: string) => `/auth/callback?provider=${provider}&error=${code}`;

  const params = request.nextUrl.searchParams;
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  // Single-use: whatever happens below, this state cannot be replayed.
  jar.set(STATE_COOKIE, '', { path: '/', maxAge: 0 });
  const after = await takeAfterAuth();

  // The developer declined on the consent screen. Both providers report it the
  // same way, and it is not an error so much as an answer.
  if (params.get('error') === 'access_denied') return failure('access_denied');
  if (params.get('error')) return failure('provider_error');

  const state = params.get('state');
  const code = params.get('code');
  if (!state || !code) return failure('invalid_state');
  if (expected !== `${provider}:${state}`) return failure('invalid_state');

  try {
    const accessToken = await exchangeCode(provider, code);
    const profile = await PROVIDERS[provider].fetchProfile(accessToken);
    const user = await upsertUserFromProfile(provider, profile);
    const projects = await listProjectsForUser(user.id);

    await writeSession(newSession(user.publicId, projects[0]?.publicId ?? null));

    // The first entry in most timelines, and the one an unfamiliar address is most
    // worth seeing on. Nothing depends on it landing -- `record` swallows its own
    // failures, because a developer who has just signed in has signed in.
    await record({
      userId: user.id,
      action: 'user.login',
      entityType: 'users',
      entityId: user.id,
      values: { provider: PROVIDERS[provider].label },
      ip: await clientIp(),
    });

    // A developer with no project has nothing for the dashboard to show, and the
    // thing they need next is the CLI. Send them where the work is -- unless they
    // arrived on the way to somewhere specific, like a device code to approve.
    if (after) return after;
    return projects.length ? '/dashboard' : '/onboarding';
  } catch (error) {
    if (error instanceof OAuthError) return failure(error.code);
    console.error('[auth] callback failed', error);
    return failure('server_error');
  }
}
