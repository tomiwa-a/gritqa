import { Section } from '@/components/ui/section';
import { SectionHead, Prose, Display } from '@/components/ui/typography';
import { Crosshair } from '@/components/ui/crosshair';
import { ButtonLink } from '@/components/ui/button';
import { Terminal, type TermLine } from '@/components/ui/terminal';
import { AppFrame } from '@/components/ui/app-frame';
import { SplitSurface } from '@/components/ui/split-surface';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

type Step = {
  index: string;
  title: string;
  body: string;
  needsYou?: boolean;
};

const STEPS: Step[] = [
  {
    index: '01',
    title: 'You ship a change',
    body: 'Work the way you already work. Add an endpoint, change a model, fix a bug — no extra step, nothing to remember.',
  },
  {
    index: '02',
    title: 'It notices what moved',
    body: 'GritQA compares your project against the last time it looked and works out which behaviour your change could have broken.',
  },
  {
    index: '03',
    title: 'It drafts the tests',
    body: 'You get a realistic sequence of requests for what changed, with the values threaded through — or you write the plan yourself.',
  },
  {
    index: '04',
    title: 'You review and approve',
    body: 'The draft waits for you. Approve it, edit an assertion, or reject it. Nothing runs against anything until you say yes.',
    needsYou: true,
  },
  {
    index: '05',
    title: 'It runs for real',
    body: 'Approved tests run on your machine against a real database that exists only for the run, with paid services swapped for stand-ins.',
  },
  {
    index: '06',
    title: 'You get the result',
    body: 'Pass or fail in your terminal, and the full history in your dashboard — what ran, what broke, and what it was before.',
  },
];

function StepCell({ step }: { step: Step }) {
  return (
    <article
      className={cn(
        'group relative flex flex-col',
        step.needsYou
          ? 'rounded-lg border border-punch-red/45 bg-surface-dark-raised p-5 sm:p-6'
          : 'border-t border-rule-dark pt-6 transition-colors duration-200 ease-out hover:border-ink-subtle',
      )}
    >
      {!step.needsYou && <Crosshair at="tl" size="sm" tone="dark" />}

      <div className="flex items-center gap-3">
        <span className="nums text-[13px] font-semibold text-punch-red">{step.index}</span>
        {step.needsYou && (
          <Badge variant="fail" size="sm" className="ml-auto">
            This one is yours
          </Badge>
        )}
      </div>

      <h3 className="mt-4 font-heading text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-inverse">
        {step.title}
      </h3>

      <Prose tone="dark" className="mt-2.5">
        {step.body}
      </Prose>
    </article>
  );
}

const CLI: TermLine[] = [
  { kind: 'cmd', text: 'gritqa' },
  { kind: 'ok', text: '2 plans drafted for what changed', meta: '6.2s' },
  { kind: 'info', text: 'waiting for your review' },
  { kind: 'blank' },
  { kind: 'ok', text: 'refund flow approved — running', meta: 'now' },
  { kind: 'tree', text: 'create order', status: 'pass', meta: '71ms' },
  { kind: 'tree', text: 'refund it', status: 'pass', last: true, meta: '96ms' },
];

const QUEUE = [
  { name: 'Checkout with tax applied', status: 'review' as const, label: 'Review' },
  { name: 'Refund a paid order', status: 'approved' as const, label: 'Approved' },
  { name: 'Sign-up rejects a duplicate', status: 'running' as const, label: 'Running' },
];

function DashboardMock() {
  return (
    <figure>
      <AppFrame url="app.gritqa.dev/review" meta="3 plans">
        <ul className="divide-y divide-rule-dark" aria-hidden>
          {QUEUE.map((q) => (
            <li key={q.name} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-inverse">
                {q.name}
              </span>
              <Badge variant={q.status} size="sm">
                {q.label}
              </Badge>
            </li>
          ))}
        </ul>
        <div
          aria-hidden
          className="flex items-center gap-2 border-t border-rule-dark px-4 py-3"
        >
          <span className="rounded-md bg-punch-red px-2.5 py-1 text-[12px] font-medium text-ink-inverse">
            Approve
          </span>
          <span className="rounded-md border border-rule-dark px-2.5 py-1 text-[12px] text-ink-dim">
            Edit
          </span>
          <span className="rounded-md border border-rule-dark px-2.5 py-1 text-[12px] text-ink-dim">
            Reject
          </span>
        </div>
      </AppFrame>
      <figcaption className="sr-only">
        The GritQA dashboard at app.gritqa.dev/review, showing three test plans —
        one waiting for review, one approved, one currently running — each of which
        can be approved, edited or rejected.
      </figcaption>
    </figure>
  );
}

export function HowItWorks() {
  return (
    <Section id="how-it-works" tone="dark" space="md" grid frame>
      <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end">
        <SectionHead
          index="02"
          eyebrow="How it works"
          title="Six steps. One of them is yours."
          lead="No onboarding flow, no SDK to import, no traffic to record first. You write code and sign off on tests; GritQA does everything in between."
          tone="dark"
          className="max-w-2xl"
        />

        <ButtonLink href="#waitlist" variant="ghostDark" size="md" trailing className="shrink-0">
          Get early access
        </ButtonLink>
      </div>

      <div className="mt-12 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:mt-16 lg:grid-cols-3">
        {STEPS.map((s) => (
          <StepCell key={s.index} step={s} />
        ))}
      </div>

      <div className="mt-16 border-t border-rule-dark pt-12 lg:mt-20">
        <div className="max-w-2xl">
          <Display as="h3" size="sm" tone="dark">
            The command line and the dashboard are the same product.
          </Display>
          <Prose tone="dark" className="mt-3">
            Run it where your code lives, review it where you can actually read it.
            Approve a plan in the browser and the next run picks it up — you never
            copy anything between the two.
          </Prose>
        </div>

        <SplitSurface
          className="mt-10"
          leftLabel="On your machine"
          rightLabel="In your browser"
          left={
            <Terminal
              lines={CLI}
              meta="~/api"
              stagger={70}
              caption="The terminal shows two plans drafted for what changed and waiting for review, then the refund flow — which the developer already approved — running its two steps successfully."
            />
          }
          right={<DashboardMock />}
        />
      </div>
    </Section>
  );
}
