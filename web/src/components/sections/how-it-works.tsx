import { Section } from '@/components/ui/section';
import { SectionHead, Prose } from '@/components/ui/typography';
import { Crosshair } from '@/components/ui/crosshair';
import { ButtonLink } from '@/components/ui/button';
import { cn } from '@/lib/cn';

type Step = {
  index: string;
  title: string;
  body: string;
  /** The one beat that needs a person is called out, not hidden. */
  needsYou?: boolean;
};

const STEPS: Step[] = [
  {
    index: '01',
    title: 'You ship a change',
    body: 'Work the way you already work. Add an endpoint, change a model, fix a bug — no extra step, no annotations, nothing to remember.',
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
        'group relative border-t pt-6 transition-colors duration-200 ease-out',
        step.needsYou
          ? 'border-punch-red'
          : 'border-rule-dark hover:border-ink-subtle',
      )}
    >
      <Crosshair at="tl" size="sm" tone="dark" />

      <div className="flex items-baseline justify-between gap-4">
        <span className="nums font-mono text-[11px] tracking-[0.16em] text-punch-red">
          {step.index}
        </span>
        <span
          className={cn(
            'text-[12px]',
            step.needsYou ? 'font-semibold text-punch-red' : 'text-term-dim',
          )}
        >
          {step.needsYou ? 'Needs you' : 'Automatic'}
        </span>
      </div>

      <h3 className="mt-5 font-heading text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-inverse">
        {step.title}
      </h3>

      <Prose tone="dark" className="mt-3">
        {step.body}
      </Prose>
    </article>
  );
}

/* Two places you work, one workflow. This is the strip that stops the
   product reading as a command-line tool with nothing behind it. */
const SURFACES = [
  {
    where: 'In your terminal',
    what: 'One command. It reads your project, drafts what changed, and runs whatever you have approved.',
    detail: 'Runs locally. Your code stays on your machine.',
  },
  {
    where: 'In your browser',
    what: 'Your review queue, the plans themselves, your team’s rules, and every run you have ever done.',
    detail: 'Where you approve, edit and look things up.',
  },
];

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

      {/* Step band — a hairline above each cell, the same device the cards use. */}
      <div className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:mt-16 lg:grid-cols-3">
        {STEPS.map((s) => (
          <StepCell key={s.index} step={s} />
        ))}
      </div>

      {/* Two surfaces, one workflow. */}
      <div className="mt-14 rounded-lg border border-rule-dark bg-surface-dark-raised">
        <div className="flex items-center gap-3 border-b border-rule-dark px-6 py-4 sm:px-8">
          <h3 className="text-[13px] font-semibold text-ink-inverse">
            Two places you work, kept in sync
          </h3>
          <span className="ml-auto text-[12px] text-term-dim">
            The command line and the dashboard are the same product
          </span>
        </div>

        <dl className="grid gap-x-10 gap-y-8 px-6 py-7 sm:grid-cols-2 sm:px-8">
          {SURFACES.map((s) => (
            <div key={s.where}>
              <dt className="text-[14px] font-semibold text-ink-inverse">{s.where}</dt>
              <dd className="mt-2 max-w-[38ch] text-[13.5px] leading-[1.65] text-term-dim">
                {s.what}
                <span className="mt-2 block text-ink-subtle">{s.detail}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
