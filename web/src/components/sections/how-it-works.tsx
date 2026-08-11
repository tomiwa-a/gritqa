import { Section } from '@/components/ui/section';
import { SectionHead, Prose } from '@/components/ui/typography';
import { Crosshair } from '@/components/ui/crosshair';
import { ButtonLink } from '@/components/ui/button';

type Step = {
  index: string;
  title: string;
  body: string;
  note: string;
};

const STEPS: Step[] = [
  {
    index: '01',
    title: 'Run it in your repo',
    body: 'Drop the binary in your path and run it from the root of your service. It detects the language, the router, and the entry point on its own.',
    note: 'no config file',
  },
  {
    index: '02',
    title: 'It reads and plans',
    body: 'Routes are resolved to handlers, request shapes come from your own types, and the dependency order falls out of the call graph.',
    note: 'static analysis',
  },
  {
    index: '03',
    title: 'It runs and reports',
    body: 'Each flow executes against your server over real HTTP. Failures arrive with the assertion, the response body, and the source line.',
    note: 'real requests',
  },
  {
    index: '04',
    title: 'You commit the plan',
    body: 'The generated YAML lands in .gritqa/ as a file you review, edit and version. From then on it is your suite, not ours.',
    note: 'yours to keep',
  },
];

function StepCell({ step }: { step: Step }) {
  return (
    <article className="group relative border-t border-rule-dark pt-6 transition-colors duration-200 ease-out hover:border-ink-subtle">
      <Crosshair at="tl" size="sm" tone="dark" />

      <div className="flex items-baseline justify-between gap-4">
        <span className="nums font-mono text-[11px] tracking-[0.16em] text-punch-red">
          {step.index}
        </span>
        <span className="font-mono text-[10px] tracking-[0.16em] text-term-dim uppercase">
          {step.note}
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

export function HowItWorks() {
  return (
    <Section id="how-it-works" tone="dark" space="md" grid frame>
      <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end">
        <SectionHead
          index="03"
          eyebrow="How it works"
          title="Four steps, and you only type one of them."
          lead="There is no onboarding flow, no SDK to import, and no traffic to record first. The whole surface is a single command you run where your code already lives."
          tone="dark"
          className="max-w-2xl"
        />

        <ButtonLink href="/docs" variant="ghostDark" size="md" trailing className="shrink-0">
          Read the docs
        </ButtonLink>
      </div>

      {/* Step band — a hairline above each cell, the same device the cards use. */}
      <div className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:mt-16 lg:grid-cols-4">
        {STEPS.map((s) => (
          <StepCell key={s.index} step={s} />
        ))}
      </div>

      {/* The command itself, stated plainly. */}
      <div className="mt-12 flex flex-col gap-5 rounded-lg border border-rule-dark bg-surface-dark-raised px-6 py-6 sm:flex-row sm:items-center sm:gap-8 sm:px-8">
        <p className="shrink-0 font-mono text-[15px] text-ink-inverse">
          <span aria-hidden className="mr-2.5 text-punch-red">
            $
          </span>
          gritqa
        </p>
        <span aria-hidden className="hidden h-8 w-px shrink-0 bg-rule-dark sm:block" />
        <p className="text-[13.5px] leading-[1.6] text-term-dim">
          That is the entire command surface. No <code className="font-mono text-ink-inverse">init</code>,
          no <code className="font-mono text-ink-inverse">generate</code>, no{' '}
          <code className="font-mono text-ink-inverse">run</code> — the tool works out which of those
          you needed and does it.
        </p>
      </div>
    </Section>
  );
}
