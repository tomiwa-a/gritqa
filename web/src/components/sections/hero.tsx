import { Section } from '@/components/ui/section';
import { Terminal, type TermLine } from '@/components/ui/terminal';
import { Display, Accent, Eyebrow, Lead } from '@/components/ui/typography';
import { ButtonLink } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/badge';

const RUN: TermLine[] = [
  { kind: 'cmd', text: 'gritqa' },
  { kind: 'info', text: 'watching ~/api on branch main' },
  { kind: 'ok', text: 'read your project — 214 files', meta: '1.1s' },
  { kind: 'blank' },
  { kind: 'out', text: 'changed since your last run' },
  { kind: 'tree', text: 'checkout handler   applies tax' },
  { kind: 'tree', text: 'refund handler     new endpoint' },
  { kind: 'tree', text: 'order model        two new fields', last: true },
  { kind: 'blank' },
  { kind: 'ok', text: 'drafted 2 test plans for what changed', meta: '6.2s' },
  { kind: 'info', text: 'waiting for your review · app.gritqa.dev/review' },
  { kind: 'out', text: 'nothing runs until you approve it.' },
];

const PROMISES = [
  {
    label: 'You stay in control',
    body: 'Every test is a draft until you approve it. Edit it, reject it, or ask for a different one.',
  },
  {
    label: 'Real databases, not mocks',
    body: 'Tests run against a throwaway database that spins up for the run and disappears after.',
  },
  {
    label: 'Your code stays yours',
    body: 'Everything runs on your machine. Your source never gets uploaded anywhere.',
  },
];

export function Hero() {
  return (
    <Section space="lg" frame>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Eyebrow className="animate-line opacity-0">
          Backend testing, handled
        </Eyebrow>

        <p className="animate-line flex items-center gap-2 text-[13px] text-ink-muted opacity-0 [animation-delay:80ms]">
          <StatusDot tone="live" pulse label="Private beta open" />
          Private beta
        </p>
      </div>

      <Display
        as="h1"
        size="xl"
        className="animate-line mt-8 max-w-[18ch] opacity-0 [animation-delay:120ms]"
      >
        Your backend gets tested. You just <Accent>approve</Accent> it.
      </Display>

      <div className="mt-14 grid gap-x-10 gap-y-12 lg:mt-20 lg:grid-cols-12">
        <div className="animate-line flex flex-col gap-8 opacity-0 [animation-delay:220ms] lg:col-span-5">
          <Lead>
            Push a change and the tests for it are already waiting in your
            review queue. Approve them, edit them, or write your own — then
            they run against a real database instead of a mock. QA stops being
            the thing you get to last.
          </Lead>

          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href="#waitlist" variant="accent" size="lg" trailing>
              Get early access
            </ButtonLink>
            <ButtonLink href="#how-it-works" variant="secondary" size="lg">
              See how it works
            </ButtonLink>
          </div>

          <p className="border-t border-rule pt-6 text-[13.5px] leading-[1.6] text-ink-muted">
            Works with the backend you already have. Nothing to instrument, no
            traffic to record, no test framework to learn.
          </p>
        </div>

        <div className="animate-line opacity-0 [animation-delay:300ms] lg:col-span-7">
          <Terminal
            lines={RUN}
            meta="~/api · main"
            stagger={90}
            stats={[
              { label: 'Files read', value: '214' },
              { label: 'Changed', value: '3' },
              { label: 'Plans drafted', value: '2' },
              { label: 'Status', value: 'in review' },
            ]}
            caption="GritQA running in an API project. It reads 214 files, spots three that changed since the last run — the checkout handler, a new refund endpoint and two new fields on the order model — drafts two test plans for them, and then waits for the developer to review and approve those plans before anything runs."
          />
        </div>
      </div>

      <dl className="mt-16 grid gap-x-8 gap-y-8 border-t border-rule pt-8 sm:grid-cols-3 lg:mt-24">
        {PROMISES.map((p) => (
          <div key={p.label}>
            <dt className="text-[14px] font-semibold text-ink">{p.label}</dt>
            <dd className="mt-2 max-w-[34ch] text-[13.5px] leading-[1.65] text-ink-muted">
              {p.body}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
