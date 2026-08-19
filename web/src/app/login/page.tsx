import type { Metadata } from 'next';
import Link from 'next/link';
import { Wordmark } from '@/components/ui/wordmark';
import { Icon } from '@/components/ui/icon';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Crosshair } from '@/components/ui/crosshair';
import { buttonVariants } from '@/components/ui/button';
import { getPlansAwaitingReview } from '@/lib/data';
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

const ASSURANCES = [
  'We read your name, email, and avatar. Nothing else.',
  'GritQA never pushes, opens pull requests, or writes to your repositories.',
];

export default async function LoginPage() {
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

          <div className="mt-7 flex flex-col gap-2.5">
            {PROVIDERS.map((provider) => (
              <Link
                key={provider.id}
                href={`/auth/callback?provider=${provider.id}`}
                className={cn(
                  buttonVariants({ variant: provider.variant, size: 'md' }),
                  'w-full justify-start gap-3 px-4',
                )}
              >
                <Icon name={provider.id} size={17} />
                {provider.label}
              </Link>
            ))}
          </div>

          <ul className="mt-6 flex flex-col gap-2 border-t border-rule-soft pt-5">
            {ASSURANCES.map((line) => (
              <li key={line} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-muted">
                <Icon name="check" size={13} className="mt-[3px] shrink-0 text-pass" />
                {line}
              </li>
            ))}
          </ul>

          <p className="mt-5 rounded-lg border border-rule bg-app p-3 text-[12.5px] leading-snug text-ink-muted">
            <span className="font-medium text-ink">Not in the beta yet?</span> Access is going out to
            a small group of backend teams first.{' '}
            <Link
              href="/#waitlist"
              className="font-medium text-ink underline decoration-rule-strong underline-offset-2 transition-colors duration-150 hover:decoration-ink"
            >
              Ask for an invite
            </Link>
            .
          </p>
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
                    <span className={cn(buttonVariants({ variant: 'secondary', size: 'xs' }), 'pointer-events-none')}>
                      Review
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <footer className="border-t border-rule-soft bg-app px-4 py-2.5 text-[11.5px] text-ink-subtle">
              Drafted from what changed on{' '}
              <span className="font-mono text-ink-muted">main</span> — waiting on a human.
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
