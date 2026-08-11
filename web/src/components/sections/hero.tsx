import { Section } from '@/components/ui/section';
import { Terminal, type TermLine } from '@/components/ui/terminal';
import { Display, Accent, Eyebrow, Lead } from '@/components/ui/typography';
import { ButtonLink } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/badge';

/* The run the product is actually selling: one command, a discovered flow,
   and a real failure it surfaced. */
const RUN: TermLine[] = [
  { kind: 'cmd', text: 'gritqa' },
  { kind: 'info', text: 'go 1.23 · chi · 34 routes discovered' },
  { kind: 'ok', text: 'inferred 5 flows from the handler call graph', meta: '1.4s' },
  { kind: 'blank' },
  { kind: 'tree', text: 'POST   /v1/sessions', status: 'pass', meta: '84ms' },
  { kind: 'tree', text: 'POST   /v1/carts', status: 'pass', meta: '61ms' },
  { kind: 'tree', text: 'PATCH  /v1/carts/{id}/items', status: 'pass', meta: '73ms' },
  { kind: 'tree', text: 'POST   /v1/checkout', status: 'fail', meta: '212ms' },
  { kind: 'tree', text: 'GET    /v1/orders/{id}', status: 'skip', last: true, meta: 'blocked' },
  { kind: 'blank' },
  { kind: 'fail', text: 'checkout · expected 201, got 500 (nil tax_rate on cart)' },
];

const STACKS = ['Go', 'chi', 'Gin', 'Echo', 'Express', 'Fastify', 'NestJS'];

export function Hero() {
  return (
    <Section space="lg" frame>
      {/* ── Masthead ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Eyebrow index="01" className="animate-line opacity-0">
          Backend integration testing
        </Eyebrow>

        <p className="animate-line flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-ink-subtle uppercase opacity-0 [animation-delay:80ms]">
          <StatusDot tone="live" pulse label="Private beta open" />
          Private beta
        </p>
      </div>

      <Display
        as="h1"
        size="xl"
        className="animate-line mt-8 max-w-[17ch] opacity-0 [animation-delay:120ms]"
      >
        Point it at your repo. Get a <Accent>real</Accent> test suite.
      </Display>

      {/* ── Body: pitch left, proof right ────────────────────── */}
      <div className="mt-14 grid gap-x-10 gap-y-12 lg:mt-20 lg:grid-cols-12">
        <div className="animate-line flex flex-col gap-8 opacity-0 [animation-delay:220ms] lg:col-span-5">
          <Lead>
            GritQA reads your routers, handlers, and models — then writes chained
            integration tests with real request bodies, extracted variables, and
            assertions that hold. No fixtures to maintain. No YAML to hand-write.
          </Lead>

          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href="#waitlist" variant="accent" size="lg" trailing>
              Join the waitlist
            </ButtonLink>
            <ButtonLink href="#how-it-works" variant="secondary" size="lg">
              See how it works
            </ButtonLink>
          </div>

          {/* Spec-sheet annotation rather than a marketing sub-line. */}
          <dl className="grid max-w-sm grid-cols-2 gap-x-6 gap-y-4 border-t border-rule pt-6">
            <div>
              <dt className="font-mono text-[10.5px] tracking-[0.16em] text-ink-subtle uppercase">
                Setup
              </dt>
              <dd className="mt-1.5 text-[13.5px] text-ink-muted">
                One command, zero config
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10.5px] tracking-[0.16em] text-ink-subtle uppercase">
                Output
              </dt>
              <dd className="mt-1.5 text-[13.5px] text-ink-muted">
                Plain YAML you own
              </dd>
            </div>
          </dl>
        </div>

        <div className="animate-line opacity-0 [animation-delay:300ms] lg:col-span-7">
          <Terminal
            lines={RUN}
            meta="~/api · main"
            stagger={90}
            stats={[
              { label: 'Flows', value: '5' },
              { label: 'Assertions', value: '41' },
              { label: 'Failed', value: '1', tone: 'fail' },
              { label: 'Wall', value: '3.9s' },
            ]}
            caption="Running gritqa in an API repository. It discovers 34 routes, infers five request flows, runs them in order, and reports one failure: the checkout endpoint returned 500 instead of 201 because the cart had no tax rate."
          />
        </div>
      </div>

      {/* ── Stack rail ───────────────────────────────────────── */}
      <div className="mt-16 flex flex-col gap-4 border-t border-rule pt-6 sm:flex-row sm:items-center sm:gap-8 lg:mt-24">
        <p className="shrink-0 font-mono text-[10.5px] tracking-[0.18em] text-ink-subtle uppercase">
          Reads
        </p>
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 sm:gap-x-8">
          {STACKS.map((s) => (
            <li key={s} className="font-mono text-[13px] text-ink-muted">
              {s}
            </li>
          ))}
          <li className="font-mono text-[13px] text-ink-subtle">+ JS/TS</li>
        </ul>
      </div>
    </Section>
  );
}
