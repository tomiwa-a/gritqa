import type { Provider } from '@/lib/mock/types';

/**
 * Hand-rolled OAuth, one provider config and one normalizer each.
 *
 * The whole flow is two redirects and two fetches, and writing it out means the
 * session format, the cookie flags and the failure codes are ours rather than a
 * library's. The failure codes matter in particular: `src/app/auth/callback`
 * already renders exactly `access_denied` and `invalid_state`, so those are the
 * two a handler is allowed to produce, and anything else falls to that page's
 * generic branch.
 *
 * Scopes are read-only identity on both providers. GritQA never asks for
 * repository access -- the CLI reads the code locally, and the login screen
 * promises as much.
 */
export type OAuthProfile = {
  providerId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
};

type ProviderConfig = {
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  clientIdVar: string;
  clientSecretVar: string;
  fetchProfile: (accessToken: string) => Promise<OAuthProfile>;
};

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  github: {
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    clientIdVar: 'GITHUB_CLIENT_ID',
    clientSecretVar: 'GITHUB_CLIENT_SECRET',
    async fetchProfile(accessToken) {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'gritqa',
      };

      const user = (await fetchJson('https://api.github.com/user', headers)) as {
        id: number;
        login: string;
        name: string | null;
        email: string | null;
        avatar_url: string | null;
      };

      // A GitHub account with a private primary email returns null above, so the
      // email comes from the dedicated endpoint. Prefer the verified primary --
      // an unverified address is not proof of anything.
      let email = user.email;
      if (!email) {
        const emails = (await fetchJson('https://api.github.com/user/emails', headers)) as {
          email: string;
          primary: boolean;
          verified: boolean;
        }[];
        email =
          emails.find((e) => e.primary && e.verified)?.email ??
          emails.find((e) => e.verified)?.email ??
          null;
      }
      if (!email) throw new OAuthError('no_email');

      return {
        providerId: String(user.id),
        email,
        name: user.name?.trim() || user.login,
        avatarUrl: user.avatar_url ?? null,
      };
    },
  },

  gitlab: {
    label: 'GitLab',
    authorizeUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    scope: 'read_user',
    clientIdVar: 'GITLAB_CLIENT_ID',
    clientSecretVar: 'GITLAB_CLIENT_SECRET',
    async fetchProfile(accessToken) {
      const user = (await fetchJson('https://gitlab.com/api/v4/user', {
        Authorization: `Bearer ${accessToken}`,
      })) as {
        id: number;
        username: string;
        name: string | null;
        email: string | null;
        avatar_url: string | null;
      };
      if (!user.email) throw new OAuthError('no_email');

      return {
        providerId: String(user.id),
        email: user.email,
        name: user.name?.trim() || user.username,
        avatarUrl: user.avatar_url ?? null,
      };
    },
  },
};

/**
 * Carries the code the callback page will render. `access_denied` and
 * `invalid_state` are the two it has copy for; anything else lands on its generic
 * branch, which is the honest outcome for a provider misbehaving in a way we did
 * not anticipate.
 */
export class OAuthError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OAuthError';
  }
}

export function isProvider(value: string | undefined): value is Provider {
  return value === 'github' || value === 'gitlab';
}

export function appOrigin(): string {
  return process.env.APP_ORIGIN ?? 'http://localhost:3000';
}

export function redirectUri(provider: Provider): string {
  return `${appOrigin()}/api/auth/${provider}/callback`;
}

/** Null when the provider has not been registered yet, which is a setup state. */
export function credentialsFor(provider: Provider): { id: string; secret: string } | null {
  const config = PROVIDERS[provider];
  const id = process.env[config.clientIdVar];
  const secret = process.env[config.clientSecretVar];
  return id && secret ? { id, secret } : null;
}

export function authorizeUrlFor(provider: Provider, state: string): string {
  const config = PROVIDERS[provider];
  const credentials = credentialsFor(provider);
  if (!credentials) throw new OAuthError('provider_not_configured');

  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', credentials.id);
  url.searchParams.set('redirect_uri', redirectUri(provider));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCode(provider: Provider, code: string): Promise<string> {
  const config = PROVIDERS[provider];
  const credentials = credentialsFor(provider);
  if (!credentials) throw new OAuthError('provider_not_configured');

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: credentials.id,
      client_secret: credentials.secret,
      code,
      redirect_uri: redirectUri(provider),
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  });

  if (!response.ok) throw new OAuthError('token_exchange_failed');

  const body = (await response.json()) as { access_token?: string; error?: string };
  // GitHub answers 200 with an error body rather than a 4xx, so the status alone
  // is not the check.
  if (body.error === 'access_denied') throw new OAuthError('access_denied');
  if (!body.access_token) throw new OAuthError('token_exchange_failed');
  return body.access_token;
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers, cache: 'no-store' });
  if (!response.ok) throw new OAuthError('profile_fetch_failed');
  return response.json();
}
