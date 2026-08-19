import type { Metadata } from 'next';
import Link from 'next/link';
import { Wordmark } from '@/components/ui/wordmark';
import { Icon } from '@/components/ui/icon';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Crosshair } from '@/components/ui/crosshair';
import { buttonVariants } from '@/components/ui/button';
import { getPlansAwaitingReview } from '@/lib/data';
import { safePath, withNext } from '@/lib/after-auth';
import { cn } from '@/lib/cn';

export const metadata: Metadata = {
  title: 'Sign in — GritQA',
  description: 'Sign in to review the tests GritQA drafts for your backend.',
  robots: { index: false },
};

const PROVIDERS = [
  { id: 'github' as const, label: 'Continue with GitHub', variant: 'primary' as const },
  { id: 'gitlab' as const, label: 'Continue with GitLab', variant: 'secondary' as const },
];

/**
 * The only failure that can land back here rather than on `/auth/callback`, because
 * it happens before a provider is ever involved.
 */
const SIGN_IN_ERRORS: Record<string, string> = {
  no_seeded_user: 'The local database has no user in it yet. Run npm run db:seed and try again.',
};

const ASSURANCES = [
  'We read your name, email, and avatar. Nothing else.',
  'GritQA never pushes, opens pull requests, or writes to your repositories.',
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: nextParam, error } = await searchParams;
  // Someone sent here from a device-approval URL should come back to it, so the
  // destination rides through the provider hop rather than being dropped.
  const next = safePath(nextParam);
  const failure = error ? SIGN_IN_ERRORS[error] : undefined;
  const devLogin = process.env.NODE_ENV !== 'production' && Boolean(process.env.GRITQA_DEV_LOGIN);

  const plansAwaitingReview = await getPlansAwaitingReview();
  const preview = plansAwaitingReview.slice(0, 3);
  return (
    <main id="main" className="flex min-h-screen flex-col lg:flex-row">
      <div className="flex w-full flex-col bg-app-panel px-6 py-8 lg:w-[492px] lg:shrink-0 lg:border-r lg:border-rule lg:px-12 lg:py-10">
        <Wordmark />

        <div className="flex flex-1 flex-col justify-center py-10 lg:py-0">
          <Badge variant="review" size="sm">
            Private beta
          </Badge>

          <h1 className="mt-5 text-[27px] leading-tight font-semibold tracking-[-0.025em] text-ink">
            Sign in to GritQA
          </h1>
          <p className="mt-2.5 text-[14px] leading-relaxed text-ink-muted">
            Your review queue, your run history, and the rules your team agreed on are behind here.
          </p>

          {failure && (
            <p className="mt-6 flex items-start gap-2 rounded-lg border border-fail/25 bg-fail-soft p-3 text-[12.5px] leading-snug text-ink">
              <Icon name="alert" size={13} className="mt-[3px] shrink-0 text-fail" />
              {failure}
            </p>
          )}

          <div className="mt-7 flex flex-col gap-2.5">
            {PROVIDERS.map((provider) => (
              // A plain anchor, not Link: the target is a route handler that mints a
              // single-use state cookie, and a prefetch would spend it before the click.
              <a
                key={provider.id}
                href={withNext(`/api/auth/${provider.id}`, next)}
                className={cn(
                  buttonVariants({ variant: provider.variant, size: 'md' }),
                  'w-full justify-start gap-3 px-4',
                )}
              >
                <Icon name={provider.id} size={17} />
                {provider.label}
              </a>
            ))}
          </div>

          <ul className="mt-6 flex flex-col gap-2 border-t border-rule-soft pt-5">
            {ASSURANCES.map((line) => (
              <li
                key={line}
                className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-muted"
              >
                <Icon name="check" size={13} className="mt-[3px] shrink-0 text-pass" />
                {line}
              </li>
            ))}
          </ul>

          <p className="mt-5 rounded-lg border border-rule bg-app p-3 text-[12.5px] leading-snug text-ink-muted">
            <span className="font-medium text-ink">Not in the beta yet?</span> Access is going out
            to a small group of backend teams first.{' '}
            <Link
              href="/#waitlist"
              className="font-medium text-ink underline decoration-rule-strong underline-offset-2 transition-colors duration-150 hover:decoration-ink"
            >
              Ask for an invite
            </Link>
            .
          </p>

          {devLogin && (
            <div className="mt-4 rounded-lg border border-dashed border-rule-strong bg-app p-3">
              <p className="text-[12.5px] leading-snug text-ink-muted">
                <span className="font-medium text-ink">Local development.</span> Sign in as the
                seeded developer, without registering an OAuth app.
              </p>
              <a
                href={withNext('/api/auth/dev', next)}
                className={cn(buttonVariants({ variant: 'secondary', size: 'xs' }), 'mt-2.5')}
              >
                <Icon name="terminal" size={13} />
                Sign in as the local developer
              </a>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-ink-subtle">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 transition-colors duration-150 hover:text-ink"
          >
            <Icon name="arrowRight" size={13} className="rotate-180" />
            Back to the site
          </Link>
          <Link
            href="mailto:support@gritqa.dev"
            className="transition-colors duration-150 hover:text-ink"
          >
            Trouble signing in?
          </Link>
        </div>
      </div>

      <div className="relative hidden flex-1 items-center justify-center overflow-hidden bg-app bg-grid p-12 lg:flex">
        <div className="relative w-full max-w-[440px]">
          <Crosshair at="tl" />
          <Crosshair at="tr" />
          <Crosshair at="bl" />
          <Crosshair at="br" />

          <div className="overflow-hidden rounded-xl border border-rule bg-app-panel shadow-panel">
            <header className="flex items-center gap-2.5 border-b border-rule-soft px-4 py-3">
              <Icon name="queue" size={15} className="text-ink-subtle" />
              <span className="text-[13px] font-medium text-ink">Review queue</span>
              <Badge variant="count" size="xs" className="ml-auto nums">
                {plansAwaitingReview.length}
              </Badge>
            </header>

            <ul className="divide-y divide-rule-soft">
              {preview.map((plan) => (
                <li key={plan.publicId} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink">{plan.name}</p>
                      <p className="nums mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-subtle">
                        <StatusDot tone="review" />
                        {plan.stepCount} steps · {plan.assertionCount} assertions ·{' '}
                        {plan.createdLabel}
                      </p>
                    </div>
                    <span
                      className={cn(
                        buttonVariants({ variant: 'secondary', size: 'xs' }),
                        'pointer-events-none',
                      )}
                    >
                      Review
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <footer className="border-t border-rule-soft bg-app px-4 py-2.5 text-[11.5px] text-ink-subtle">
              Drafted from what changed on <span className="font-mono text-ink-muted">main</span> —
              waiting on a human.
            </footer>
          </div>

          <p className="mt-5 max-w-[38ch] text-[13px] leading-relaxed text-ink-muted">
            GritQA writes the plan. You decide whether it ever runs.
          </p>
        </div>
      </div>
    </main>
  );
}
