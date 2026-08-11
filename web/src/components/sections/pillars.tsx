import { Section } from '@/components/ui/section';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { Terminal, type TermLine } from '@/components/ui/terminal';
import { PlanViewer, type PlanStep } from '@/components/ui/plan-viewer';
import { Card, SpecList } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SectionHead, Prose } from '@/components/ui/typography';

/* ── Panel shell ──────────────────────────────────────────────
   Every pillar reads the same way: a narrow explanation column
   against the thing it produces. */

function Panel({
  title,
  body,
  specs,
  children,
}: {
  title: string;
  body: string;
  specs: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-x-10 gap-y-10 pt-10 lg:grid-cols-12 lg:pt-14">
      <div className="animate-line flex flex-col gap-6 opacity-0 lg:col-span-4">
        <div className="flex flex-col gap-3">
          <h3 className="font-heading text-[1.375rem] font-semibold tracking-[-0.02em] text-ink">
            {title}
          </h3>
          <Prose>{body}</Prose>
        </div>
        <SpecList items={specs} className="border-t border-rule pt-5" />
      </div>

      <div className="animate-line opacity-0 [animation-delay:100ms] lg:col-span-8">
        {children}
      </div>
    </div>
  );
}

/* ── 01 Knows your code ───────────────────────────────────── */

const READ: TermLine[] = [
  { kind: 'cmd', text: 'gritqa' },
  { kind: 'info', text: 'reading ~/api — 214 files' },
  { kind: 'blank' },
  { kind: 'out', text: 'what it found' },
  { kind: 'tree', text: '34 endpoints' },
  { kind: 'tree', text: '12 database models' },
  { kind: 'tree', text: 'how signing in works' },
  { kind: 'tree', text: 'which endpoints need a logged-in user', last: true },
  { kind: 'blank' },
  { kind: 'ok', text: 'mapped your project', meta: '2.3s' },
  { kind: 'info', text: 'from here on it only re-reads what you change' },
];

/* ── 02 Drafts the tests ──────────────────────────────────── */

const DRAFT: PlanStep[] = [
  {
    id: 'session',
    name: 'sign in',
    method: 'POST',
    path: '/v1/sessions',
    extract: [{ name: 'token', from: 'body.access_token' }],
    assert: ['status == 201'],
    status: 'draft',
  },
  {
    id: 'cart',
    name: 'open cart',
    method: 'POST',
    path: '/v1/carts',
    uses: ['token'],
    extract: [{ name: 'cartId', from: 'body.id' }],
    assert: ['status == 201'],
    status: 'draft',
  },
  {
    id: 'items',
    name: 'add an item',
    method: 'PATCH',
    path: '/v1/carts/{{cartId}}/items',
    uses: ['cartId'],
    assert: ['status == 200', 'body.items[0].qty == 2'],
    status: 'draft',
  },
  {
    id: 'checkout',
    name: 'check out',
    method: 'POST',
    path: '/v1/checkout',
    uses: ['cartId'],
    assert: ['status == 201', 'body.total == 4998'],
    status: 'draft',
  },
];

/* ── 03 You approve ───────────────────────────────────────────
   A still of the review queue. Step 2 replaces this with the real
   dashboard component; the copy it carries is already true.       */

const QUEUE: {
  name: string;
  detail: string;
  author: string;
  status: 'review' | 'approved' | 'running';
  label: string;
}[] = [
  {
    name: 'Checkout with tax applied',
    detail: '4 steps · drafted 2 minutes ago',
    author: 'Drafted by GritQA',
    status: 'review',
    label: 'Waiting for you',
  },
  {
    name: 'Refund a paid order',
    detail: '5 steps · drafted 2 minutes ago',
    author: 'Drafted by GritQA',
    status: 'review',
    label: 'Waiting for you',
  },
  {
    name: 'Sign-up rejects a duplicate email',
    detail: '3 steps · you wrote this one',
    author: 'Written by you',
    status: 'approved',
    label: 'Approved',
  },
];

function ReviewMock() {
  return (
    <figure>
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-rule bg-surface-sunken px-4 py-3">
          <span className="text-[13px] font-semibold text-ink">Review queue</span>
          <Badge variant="review" size="sm" className="ml-auto">
            2 waiting
          </Badge>
        </div>

        <ul className="divide-y divide-rule" aria-hidden>
          {QUEUE.map((item) => (
            <li key={item.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-ink">{item.name}</p>
                <p className="mt-1 text-[12.5px] text-ink-subtle">{item.detail}</p>
              </div>
              <span className="text-[12px] text-ink-muted">{item.author}</span>
              <Badge variant={item.status} size="sm">
                {item.label}
              </Badge>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-surface-sunken px-4 py-3" aria-hidden>
          <span className="rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-medium text-ink-inverse">
            Approve
          </span>
          <span className="rounded-md border border-rule-strong bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-muted">
            Edit the plan
          </span>
          <span className="rounded-md border border-rule-strong bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-muted">
            Reject
          </span>
          <span className="ml-auto text-[12px] text-ink-subtle">
            Nothing runs until you approve it
          </span>
        </div>
      </Card>
      <figcaption className="sr-only">
        The review queue in the GritQA dashboard. Two drafted test plans — one for
        checkout with tax applied, one for refunding a paid order — are waiting for
        the developer. A third, written by the developer themselves, is already
        approved. Each plan can be approved, edited or rejected, and nothing runs
        until it is approved.
      </figcaption>
    </figure>
  );
}

/* ── 04 Real database ─────────────────────────────────────── */

const RUN: TermLine[] = [
  { kind: 'cmd', text: 'gritqa' },
  { kind: 'info', text: 'checkout with tax applied · approved by you' },
  { kind: 'blank' },
  { kind: 'ok', text: 'started a fresh database for this run', meta: '2.1s' },
  { kind: 'ok', text: 'applied your migrations', meta: '340ms' },
  { kind: 'ok', text: 'payment calls pointed at a local stand-in' },
  { kind: 'blank' },
  { kind: 'tree', text: 'sign in', status: 'pass', meta: '84ms' },
  { kind: 'tree', text: 'open cart', status: 'pass', meta: '61ms' },
  { kind: 'tree', text: 'add an item', status: 'pass', meta: '73ms' },
  { kind: 'tree', text: 'check out', status: 'fail', last: true, meta: '212ms' },
  { kind: 'blank' },
  { kind: 'fail', text: 'expected 201, got 500 — the cart had no tax rate' },
  { kind: 'ok', text: 'database destroyed, nothing left behind', meta: '0.4s' },
];

/* ── 05 Your rules ────────────────────────────────────────── */

const RULES: { kind: string; rule: string; note: string }[] = [
  {
    kind: 'Order',
    rule: 'Always test signing in before anything else.',
    note: 'Applies to every plan',
  },
  {
    kind: 'Stand-ins',
    rule: 'Never call the payment provider for real.',
    note: 'Payments',
  },
  {
    kind: 'Assertions',
    rule: 'Every response has to come back in under two seconds.',
    note: 'Added to every step',
  },
  {
    kind: 'Test data',
    rule: 'Sign in as ada@example.com with the password in my environment.',
    note: 'Shared across plans',
  },
];

function RulesMock() {
  return (
    <figure>
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-rule bg-surface-sunken px-4 py-3">
          <span className="text-[13px] font-semibold text-ink">Your rules</span>
          <span className="ml-auto text-[12px] text-ink-subtle">4 active</span>
        </div>

        <dl className="divide-y divide-rule" aria-hidden>
          {RULES.map((r) => (
            <div key={r.kind} className="px-4 py-4">
              <dt className="flex items-center gap-3">
                <span className="text-[12.5px] font-semibold text-punch-red">{r.kind}</span>
                <span className="text-[12px] text-ink-subtle">{r.note}</span>
              </dt>
              <dd className="mt-1.5 text-[14px] leading-[1.5] text-ink">{r.rule}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <figcaption className="sr-only">
        Four rules a team has set. One orders every plan so that signing in is
        tested first. One forbids calling the real payment provider. One requires
        every response in under two seconds. One sets the account the tests sign in
        as. Every plan GritQA drafts follows all four.
      </figcaption>
    </figure>
  );
}

/* ── Tabs ─────────────────────────────────────────────────── */

const TABS: TabItem[] = [
  {
    id: 'knows',
    index: '01',
    label: 'Knows your code',
    panel: (
      <Panel
        title="It starts by learning the backend you already built"
        body="Point GritQA at your project and it works out what your API does — the endpoints, the data behind them, and which of them need a signed-in user. There is nothing to describe, annotate or keep in sync."
        specs={[
          'Reads the code you already wrote, not a spec you forgot to update',
          'After the first run it only looks at what you changed',
          'Anything it is unsure about it asks you about instead of guessing',
        ]}
      >
        <Terminal
          lines={READ}
          meta="first run"
          stagger={70}
          caption="GritQA reading a project for the first time. It goes through 214 files and reports what it found: 34 endpoints, 12 database models, how signing in works, and which endpoints need a logged-in user. After this run it only re-reads the files that change."
        />
      </Panel>
    ),
  },
  {
    id: 'drafts',
    index: '02',
    label: 'Drafts the tests',
    panel: (
      <Panel
        title="Tests get written for you — or by you, whichever you prefer"
        body="Most of the time GritQA drafts them: a realistic sequence of requests where each one feeds the next, with the ids and tokens threaded through. You can also write a plan yourself, or just describe what you want covered in plain English and let it draft that."
        specs={[
          'Requests run in an order that makes sense, not one at a time',
          'Real values from real responses, not fixtures you have to maintain',
          'Ask for what is missing in plain language: “also cover the refund path”',
        ]}
      >
        <PlanViewer name="Checkout with tax applied" steps={DRAFT} duration="draft" />
      </Panel>
    ),
  },
  {
    id: 'approve',
    index: '03',
    label: 'You approve',
    panel: (
      <Panel
        title="Nothing runs until a person says so"
        body="Every drafted plan lands in a review queue instead of your test suite. You read it, change what you want, approve it or throw it away. This is the step the whole product is built around — you are the one who decides what counts as correct."
        specs={[
          'Approve, edit or reject — a plan does nothing while it waits',
          'Change an assertion, drop a step, or rewrite it entirely',
          'Every decision is recorded, so you can see who approved what',
        ]}
      >
        <ReviewMock />
      </Panel>
    ),
  },
  {
    id: 'database',
    index: '04',
    label: 'Real database',
    panel: (
      <Panel
        title="A real database that appears for the run and disappears after"
        body="Approved tests run on your machine against an actual database with your actual migrations — not a mocked-out stand-in that passes when your app would not. When the run ends it is thrown away, so tests never leave anything behind."
        specs={[
          'Your real migrations, so the tests hit the schema you ship',
          'Payment providers and other paid services get a local stand-in',
          'Every run starts clean and destroys itself when it finishes',
        ]}
      >
        <Terminal
          lines={RUN}
          meta="approved run"
          stagger={70}
          stats={[
            { label: 'Passed', value: '3', tone: 'pass' },
            { label: 'Failed', value: '1', tone: 'fail' },
            { label: 'Wall', value: '3.2s' },
          ]}
          caption="An approved plan running. GritQA starts a fresh database, applies the project's migrations, points payment calls at a local stand-in, then runs four steps. Three pass; checking out fails because the cart had no tax rate. The database is destroyed afterwards."
        />
      </Panel>
    ),
  },
  {
    id: 'rules',
    index: '05',
    label: 'Your rules',
    panel: (
      <Panel
        title="Teach it how your team tests, once"
        body="Write down the things you would otherwise repeat in every review — test sign-in first, never touch the real payment provider, keep responses under two seconds, use this account. Every plan it drafts from then on already follows them."
        specs={[
          'Rules apply to every future draft, not just the next one',
          'Set them per project, so each service can test its own way',
          'Change a rule and the next draft picks it up',
        ]}
      >
        <RulesMock />
      </Panel>
    ),
  },
];

export function Pillars() {
  return (
    <Section id="product" tone="sunken" space="md" divide frame>
      <SectionHead
        index="01"
        eyebrow="What you get"
        title="A testing process that runs itself, and still answers to you."
        lead="GritQA does the part everyone puts off — writing the tests, standing up a database, keeping it all current. You keep the part that needs judgement."
        className="max-w-2xl"
      />

      <Tabs items={TABS} label="What GritQA does" className="mt-14 lg:mt-16" />
    </Section>
  );
}
