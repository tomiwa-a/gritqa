import { cookies } from 'next/headers';

/**
 * The session is a signed cookie, not a row.
 *
 * There is no `sessions` table because there is nothing a table would add here:
 * the cookie carries a user's public id and the project they are looking at, both
 * of which are re-checked against the database on every read anyway. A signature
 * makes the cookie unforgeable; a table would only let us revoke one, and the
 * revocation story for a 30-day cookie is the same either way -- rotate
 * `SESSION_SECRET` and everyone signs in again.
 *
 * HMAC via Web Crypto rather than `node:crypto` so the same code verifies in a
 * route handler, a server component, and middleware, which do not all run on the
 * same runtime.
 */
export const SESSION_COOKIE = 'gritqa_session';

const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const CLI_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

export type Audience = 'web' | 'cli';

export type Session = {
  /**
   * Who the token is for. A browser cookie and a CLI credential are signed with
   * the same secret, so without this a CLI token pasted into a cookie jar would
   * verify perfectly -- and a CLI credential lives in a file on disk for months,
   * which is a very different exposure from an httpOnly cookie. Each verifier
   * demands its own audience.
   */
  aud: Audience;
  /** `users.public_id`. Never the BIGINT -- that does not leave the server. */
  uid: string;
  /** `projects.public_id` for the project in the switcher, if one is chosen. */
  pid: string | null;
  /** Issued and expires, seconds since epoch. */
  iat: number;
  exp: number;
};

let cachedKey: Promise<CryptoKey> | null = null;

function signingKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is not set. Generate one with: openssl rand -base64 48');
  }
  cachedKey ??= crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return cachedKey;
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Returns `Uint8Array<ArrayBuffer>` rather than the plain `Uint8Array` that
 * `Uint8Array.from` infers. The looser type is backed by `ArrayBufferLike`, which
 * admits `SharedArrayBuffer`, and Web Crypto will not accept one -- a key could be
 * mutated by another thread mid-verify.
 */
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** `<payload>.<signature>`, both base64url. */
export async function signSession(session: Session): Promise<string> {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(session)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${toBase64Url(signature)}`;
}

/**
 * Returns null for every kind of bad cookie -- wrong signature, malformed,
 * expired -- because the caller does the same thing in all three cases, and
 * distinguishing them for the client would tell an attacker which part of a forged
 * cookie to fix next.
 */
export async function verifySession(
  token: string | undefined,
  audience: Audience = 'web',
): Promise<Session | null> {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      'HMAC',
      await signingKey(),
      fromBase64Url(signature),
      new TextEncoder().encode(payload),
    );
  } catch {
    return null;
  }
  if (!ok) return null;

  try {
    const session = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as Session;
    if (typeof session.uid !== 'string' || typeof session.exp !== 'number') return null;
    if (session.aud !== audience) return null;
    if (session.exp * 1000 < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function newSession(uid: string, pid: string | null = null): Session {
  const now = Math.floor(Date.now() / 1000);
  return { aud: 'web', uid, pid, iat: now, exp: now + MAX_AGE_SECONDS };
}

/**
 * The credential the CLI writes to `os.UserConfigDir()/gritqa/credentials`.
 *
 * Longer-lived than a browser session because a developer re-approving their
 * terminal every month is friction with no security gain -- the file is already
 * only readable by them, and the flow that mints it required a human to approve a
 * code they read off their own screen. Revocation is `SESSION_SECRET` rotation,
 * same as the web session.
 */
export function newCliToken(uid: string, pid: string | null): Session {
  const now = Math.floor(Date.now() / 1000);
  return { aud: 'cli', uid, pid, iat: now, exp: now + CLI_MAX_AGE_SECONDS };
}

/** Reads the `Authorization: Bearer` a CLI request carries. */
export async function verifyCliToken(header: string | null): Promise<Session | null> {
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  return verifySession(token, 'cli');
}

/** The session on the current request, or null when nobody is signed in. */
export async function readSession(): Promise<Session | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    // Lax rather than Strict: the OAuth callback is a cross-site navigation back
    // from the provider, and Strict would withhold the cookie on exactly that hop.
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  };
}

/** Route handlers and server actions only -- a render cannot set a cookie. */
export async function writeSession(session: Session): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(session), sessionCookieOptions());
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
}
