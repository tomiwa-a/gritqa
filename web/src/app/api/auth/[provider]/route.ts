import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { authorizeUrlFor, isProvider } from '@/lib/oauth';
import { rememberAfterAuth, safePath } from '@/lib/after-auth';

/**
 * Step one: send the developer to the provider.
 *
 * The `state` parameter is the CSRF defence for the whole flow, and it only works
 * because it is stored somewhere the attacker cannot write. A random value goes
 * into a short-lived httpOnly cookie and into the URL; the callback requires them
 * to match, so a callback the developer did not initiate has no matching cookie
 * and is refused as `invalid_state`.
 */
export const dynamic = 'force-dynamic';

export const STATE_COOKIE = 'gritqa_oauth_state';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  if (!isProvider(provider)) redirect('/login');

  // Someone approving a device landed on /login from a URL their terminal printed.
  // Losing that is not fatal, but it is rude, so it rides along in its own cookie.
  await rememberAfterAuth(safePath(request.nextUrl.searchParams.get('next')));

  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set(STATE_COOKIE, `${provider}:${state}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Minutes, not days. A sign-in that takes longer than this has been abandoned,
    // and the callback page already says attempts are only good for a few minutes.
    maxAge: 60 * 10,
  });

  try {
    redirect(authorizeUrlFor(provider, state));
  } catch (error) {
    // `redirect` throws to unwind, so only a genuine config failure lands here.
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    redirect(`/auth/callback?provider=${provider}&error=provider_not_configured`);
  }
}
