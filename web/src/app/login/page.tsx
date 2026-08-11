import type { Metadata } from 'next';
import Link from 'next/link';
import { Container } from '@/components/ui/container';
import { Wordmark } from '@/components/ui/wordmark';
import { Display, Lead } from '@/components/ui/typography';
import { ButtonLink } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export const metadata: Metadata = {
  title: 'Sign in — GritQA',
  description: 'The GritQA dashboard is in private beta.',
  robots: { index: false },
};

/* The dashboard is real but not open yet. This page says so rather than
   pretending to be a login form that cannot log anyone in. */

export default function LoginPage() {
  return (
    <main id="main" className="flex min-h-screen flex-col">
      <div className="border-b border-rule">
        <Container>
          <div className="flex h-16 items-center">
            <Wordmark />
          </div>
        </Container>
      </div>

      <div className="flex flex-1 items-center py-20">
        <Container width="prose">
          <Badge variant="review" size="sm">
            Private beta
          </Badge>

          <Display as="h1" size="md" className="mt-6">
            The dashboard isn’t open to everyone yet.
          </Display>

          <Lead className="mt-5">
            This is where you review the tests GritQA drafts, set your team’s
            rules, and look back at every run. It goes out to a small group of
            backend teams first — leave an email and we will send you access.
          </Lead>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <ButtonLink href="/#waitlist" variant="accent" size="lg" trailing>
              Get early access
            </ButtonLink>
            <ButtonLink href="/" variant="secondary" size="lg">
              Back to the site
            </ButtonLink>
          </div>

          <p className="mt-10 border-t border-rule pt-6 text-[13.5px] text-ink-muted">
            Already in the beta? Sign-in links go out with your invite. If you
            cannot find yours,{' '}
            <Link
              href="mailto:hello@gritqa.dev"
              className="font-medium text-ink underline decoration-rule-strong underline-offset-2 transition-colors hover:decoration-ink"
            >
              email us
            </Link>
            .
          </p>
        </Container>
      </div>
    </main>
  );
}
