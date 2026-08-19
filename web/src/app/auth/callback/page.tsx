import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/app/auth-frame';
import { Icon } from '@/components/ui/icon';
import { buttonVariants } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Sign-in problem — GritQA',
  robots: { index: false },
};

/**
 * Every code here is one `/api/auth/[provider]/callback` can redirect with, and the
 * job of each entry is to say what happened in words a person can act on. None of
 * them name the provider -- the button already does that.
 */
const FAILURES: Record<string, { title: string; body: string }> = {
  access_denied: {
    title: 'Permission was not granted',
    body: 'You closed the consent screen or declined it. GritQA only asks for your name, email, and avatar — nothing that touches your code.',
  },
  invalid_state: {
    title: 'That sign-in link expired',
    body: 'Sign-in attempts are only good for a few minutes. Start again and it should go straight through.',
  },
  provider_error: {
    title: 'The sign-in was refused',
    body: 'Your provider turned the request down without saying why. If it keeps happening, GritQA’s access may have been revoked on their side.',
  },
  provider_not_configured: {
    title: 'That sign-in method is not set up yet',
    body: 'This server has no app registered with that provider, so there was nothing to hand you off to. Nothing on your side caused it.',
  },
  token_exchange_failed: {
    title: 'The handoff did not complete',
    body: 'Your provider confirmed who you are, but the final exchange between them and us failed. Trying again usually clears it.',
  },
  profile_fetch_failed: {
    title: 'We could not read your profile',
    body: 'Your provider signed you in but would not tell us your name and email, so there was nothing to make an account from.',
  },
  no_email: {
    title: 'We need an email address',
    body: 'Your provider did not give us one. Add a verified email to that account, or make an existing one public, and sign in again.',
  },
  server_error: {
    title: 'Something broke on our side',
    body: 'This one is ours, not yours. It has been logged — try again, and email us if it sticks.',
  },
};

const GENERIC = {
  title: 'We could not finish signing you in',
  body: 'The provider handed us back something we did not expect. Trying again usually clears it.',
};

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; error?: string }>;
}) {
  const { provider, error } = await searchParams;
  const id = provider === 'gitlab' ? 'gitlab' : 'github';
  const name = id === 'gitlab' ? 'GitLab' : 'GitHub';

  // Success never reaches this page. The route handler signs the developer in and
  // redirects to the dashboard itself, so anyone arriving here without an error
  // followed a stale link and belongs wherever they were trying to go.
  if (!error) redirect('/dashboard');

  const failure = FAILURES[error] ?? GENERIC;

  return (
    <AuthFrame>
      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-fail/25 bg-fail-soft text-fail">
        <Icon name="alert" size={17} />
      </span>

      <h1 className="mt-4 text-[17px] font-semibold tracking-[-0.02em] text-ink">
        {failure.title}
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{failure.body}</p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link href="/login" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
          Try {name} again
        </Link>
        <Link
          href="mailto:support@gritqa.dev"
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          Email support
        </Link>
      </div>

      <p className="mt-5 border-t border-rule-soft pt-4 font-mono text-[11.5px] text-ink-subtle">
        {id} · {error}
      </p>
    </AuthFrame>
  );
}
