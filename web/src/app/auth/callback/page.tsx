import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthFrame } from '@/components/app/auth-frame';
import { Icon } from '@/components/ui/icon';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export const metadata: Metadata = {
  title: 'Signing you in — GritQA',
  robots: { index: false },
};

const FAILURES: Record<string, { title: string; body: string }> = {
  access_denied: {
    title: 'Permission was not granted',
    body: 'You closed the consent screen or declined it. GritQA only asks for your name, email, and avatar — nothing that touches your code.',
  },
  invalid_state: {
    title: 'That sign-in link expired',
    body: 'Sign-in attempts are only good for a few minutes. Start again and it should go straight through.',
  },
};

const GENERIC = {
  title: 'We could not finish signing you in',
  body: 'The provider handed us back something we did not expect. Trying again usually clears it.',
};

const HANDOFF = [
  'Checked who you are with the provider',
  'Matched you to your beta invite',
  'Loading your projects',
];

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; error?: string }>;
}) {
  const { provider, error } = await searchParams;
  const id = provider === 'gitlab' ? 'gitlab' : 'github';
  const name = id === 'gitlab' ? 'GitLab' : 'GitHub';

  if (error) {
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

  return (
    <AuthFrame>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-rule-dark bg-surface-dark text-ink-inverse">
          <Icon name={id} size={17} />
        </span>
        <span className="text-ink-subtle">
          <Icon name="arrowRight" size={15} />
        </span>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-rule bg-app text-ink">
          <Icon name="panel" size={17} />
        </span>
      </div>

      <h1 className="mt-4 text-[17px] font-semibold tracking-[-0.02em] text-ink">
        Signing you in with {name}
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
        This takes a second. Keep the tab open.
      </p>

      <div className="mt-5 h-[3px] overflow-hidden rounded-full bg-app-active">
        <div className="animate-handoff h-full w-full rounded-full bg-punch-red" />
      </div>

      <ul className="mt-4 flex flex-col gap-2">
        {HANDOFF.map((line, i) => (
          <li
            key={line}
            className={cn(
              'flex items-center gap-2 text-[12.5px]',
              i === HANDOFF.length - 1 ? 'text-ink' : 'text-ink-muted',
            )}
          >
            {i === HANDOFF.length - 1 ? (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inset-0 animate-ping rounded-full bg-punch-red opacity-60" />
                <span className="relative h-2 w-2 rounded-full bg-punch-red" />
              </span>
            ) : (
              <Icon name="check" size={13} className="shrink-0 text-pass" />
            )}
            {line}
          </li>
        ))}
      </ul>

      <div className="mt-5 border-t border-rule-soft pt-4">
        <p className="text-[12.5px] leading-snug text-ink-muted">
          <span className="font-medium text-ink">Beta note.</span> Real sign-in lands with the API.
          Until then, pick where you want to go.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link href="/dashboard" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
            Go to the dashboard
            <Icon name="arrowRight" size={14} />
          </Link>
          <Link
            href="/onboarding"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            Set up the CLI first
          </Link>
        </div>
      </div>
    </AuthFrame>
  );
}
