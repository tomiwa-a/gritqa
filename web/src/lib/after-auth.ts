import { cookies } from 'next/headers';

/**
 * Where to land once sign-in finishes.
 *
 * The device flow is what forces this to exist. The CLI prints a verification URL
 * and the person who opens it may not be signed in yet -- so without somewhere to
 * keep the destination they sign in, arrive at the dashboard, and the code they
 * came to approve is nowhere in sight.
 *
 * The stored value is only ever a path on this origin. A `next` pointing anywhere
 * else would turn sign-in into an open redirect: a link that looks like ours, lands
 * on someone else's, and gets there carrying the trust of having just
 * authenticated.
 */
export const AFTER_AUTH_COOKIE = 'gritqa_after_auth';

/** Returns the value only if it is a path this origin can serve, else null. */
export function safePath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/')) return null;
  // `//host` and `/\host` are both read as protocol-relative by some browsers, so
  // neither of them is a path, whatever it looks like.
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}

/** Appends `?next=` to a sign-in URL, when there is a destination worth keeping. */
export function withNext(url: string, next: string | null): string {
  return next ? `${url}?next=${encodeURIComponent(next)}` : url;
}

export async function rememberAfterAuth(next: string | null): Promise<void> {
  const jar = await cookies();
  if (!next) {
    // Clear a destination left behind by an abandoned attempt, so a plain sign-in
    // does not silently inherit it.
    jar.set(AFTER_AUTH_COOKIE, '', { path: '/', maxAge: 0 });
    return;
  }
  jar.set(AFTER_AUTH_COOKIE, next, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 10,
  });
}

/** Reads the destination and clears it. Single-use, like the state it travels with. */
export async function takeAfterAuth(): Promise<string | null> {
  const jar = await cookies();
  const value = safePath(jar.get(AFTER_AUTH_COOKIE)?.value);
  jar.set(AFTER_AUTH_COOKIE, '', { path: '/', maxAge: 0 });
  return value;
}
