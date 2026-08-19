import { plansAwaitingReview } from './data';
import type { PlanStepSpec, TestPlan, TestPlanDetail } from './types';
import { at } from './when';

const BASE_URL = 'http://localhost:8080';

const SEED = {
  testEmail: 'qa+run@gritqa.dev',
  testPassword: 'grit-Qa-2f81',
  testCurrency: 'NGN',
};

function signIn(overrides?: Partial<PlanStepSpec>): PlanStepSpec {
  return {
    id: 's1',
    name: 'Sign in as the test user',
    description: 'Every later step carries this token, so nothing runs unauthenticated.',
    dependsOn: [],
    request: {
      method: 'POST',
      url: '/auth/login',
      headers: { 'Content-Type': 'application/json' },
      body: { email: '{{testEmail}}', password: '{{testPassword}}' },
    },
    extract: [
      { name: 'authToken', path: '$.data.token', source: 'body' },
      { name: 'userId', path: '$.data.user.id', source: 'body' },
    ],
    assertions: [
      { type: 'status', operator: 'equals', target: 'status', expected: 200 },
      { type: 'bodyField', operator: 'exists', target: 'data.token' },
    ],
    onFailure: 'abort',
    ...overrides,
  };
}

const AUTH = { Authorization: 'Bearer {{authToken}}', 'Content-Type': 'application/json' };

const CHECKOUT_TAX: PlanStepSpec[] = [
  signIn(),
  {
    id: 's2',
    name: 'Quote a cart that spans two tax bands',
    description: 'A book at the reduced band and a laptop at the standard band.',
    dependsOn: ['s1'],
    request: {
      method: 'POST',
      url: '/checkout/quote',
      headers: AUTH,
      body: {
        currency: '{{testCurrency}}',
        lines: [
          { sku: 'BOOK-01', qty: 2, unit_amount: 4500 },
          { sku: 'LAPTOP-01', qty: 1, unit_amount: 890000 },
        ],
      },
    },
    extract: [
      { name: 'quoteId', path: '$.data.quote_id', source: 'body' },
      { name: 'taxTotal', path: '$.data.tax_total', source: 'body' },
    ],
    assertions: [
      { type: 'status', operator: 'equals', target: 'status', expected: 200 },
      { type: 'bodyField', operator: 'equals', target: 'data.tax_total', expected: 66750 },
      { type: 'bodyField', operator: 'exists', target: 'data.lines' },
    ],
    onFailure: 'abort',
  },
  {
    id: 's3',
    name: 'Open a checkout from that quote',
    description: 'The checkout should carry the quoted tax forward untouched.',
    dependsOn: ['s2'],
    request: {
      method: 'POST',
      url: '/checkout',
      headers: AUTH,
      body: { quote_id: '{{quoteId}}', customer_id: '{{userId}}' },
    },
    extract: [{ name: 'checkoutId', path: '$.data.id', source: 'body' }],
    assertions: [
      { type: 'status', operator: 'equals', target: 'status', expected: 201 },
      { type: 'bodyField', operator: 'equals', target: 'data.status', expected: 'open' },
    ],
    onFailure: 'abort',
  },
  {
    id: 's4',
    name: 'Apply tax for the Lagos region',
    description: 'The step the push actually changed — band lookup is now per line.',
    dependsOn: ['s3'],
    request: {
      method: 'POST',
      url: '/checkout/{{checkoutId}}/tax',
      headers: AUTH,
      body: { region: 'NG-LA' },
    },
    extract: [],
    assertions: [
      { type: 'status', operator: 'equals', target: 'status', expected: 200 },
      { type: 'bodyField', operator: 'equals', target: 'data.tax_total', expected: '{{taxTotal}}' },
      { type: 'responseTime', operator: 'lt', target: 'responseTime', expected: 2000 },
    ],
    onFailure: 'abort',
    retry: { maxAttempts: 2, delayMs: 250 },
  },
  {
    id: 's5',
    name: 'Read the checkout back',
    description: 'Proves the tax was stored, not just returned once.',
    dependsOn: ['s4'],
    request: { method: 'GET', url: '/checkout/{{checkoutId}}', headers: AUTH },
    extract: [],
    assertions: [
      { type: 'status', operator: 'equals', target: 'status', expected: 200 },
      { type: 'bodyField', operator: 'equals', target: 'data.tax_total', expected: '{{taxTotal}}' },
    ],
    onFailure: 'continue',
  },
];

const PARTIAL_REFUND: PlanStepSpec[] = [
  signIn(),
  {
    id: 's2',
    name: 'Create an order with one line already shipped',
    description: 'Two lines in, one marked shipped, so a partial refund has something to skip.',
    dependsOn: ['s1'],
    request: {
      method: 'POST',
      url: '/orders',
      headers: AUTH,
      body: {
        customer_id: '{{userId}}',
        currency: '{{testCurrency}}',
        lines: [
          { sku: 'MUG-01', qty: 1, unit_amount: 4500, shipped: true },
          { sku: 'MUG-02', qty: 1, unit_amount: 4500, shipped: false },
        ],
      },
    },
    extract: [{ name: 'orderId', path: '$.data.id', source: 'body' }],
    assertions: [
      { type: 'status', operator: 'equals', target: 'status', expected: 201 },
      { type: 'bodyField', operator: 'equals', target: 'data.refundable_amount', expected: 4500 },
    ],
    onFailure: 'abort',
  },
  {
    id: 's3',
    name: 'Refund the unshipped line only',
    description: 'The shipped line must be left alone — this is where v1 came apart.',
    dependsOn: ['s2'],
    request: {
      method: 'POST',
      url: '/refunds',
      headers: AUTH,
      body: { order_id: '{{orderId}}', scope: 'unshipped', reason: 'customer_changed_mind' },
    },
    extract: [{ name: 'refundId', path: '$.data.id', source: 'body' }],
    assertions: [
      { type: 'status', operator: 'equals', target: 'status', expected: 201 },
      { type: 'bodyField', operator: 'equals', target: 'data.amount', expected: 4500 },
      { type: 'bodyField', operator: 'equals', target: 'data.lines_refunded', expected: 1 },
    ],
    onFailure: 'abort',
  },
  {
    id: 's4',
    name: 'Check the refund reads back the same',
    description: 'One ledger entry, for the unshipped line, and nothing more.',
    dependsOn: ['s3'],
    request: { method: 'GET', url: '/refunds/{{refundId}}', headers: AUTH },
    extract: [],
    assertions: [
      { type: 'status', operator: 'equals', target: 'status', expected: 200 },
      { type: 'bodyField', operator: 'equals', target: 'data.ledger_entries', expected: 1 },
    ],
    onFailure: 'continue',
  },
];

const WEBHOOK_REPLAY: PlanStepSpec[] = [
  signIn(),
  {
    id: 's2',
    name: 'Deliver the provider event once',
    description: 'The first delivery should credit the wallet and record an entry.',
    dependsOn: ['s1'],
    request: {
      method: 'POST',
      url: '/webhooks/paystack',
      headers: { ...AUTH, 'X-Paystack-Signature': '{{providerSignature}}' },
      body: {
        event: 'charge.success',
        data: { reference: '{{providerEventId}}', amount: 50000, currency: '{{testCurrency}}' },
      },
    },
    extract: [{ name: 'creditedAmount', path: '$.data.credited', source: 'body' }],
    assertions: [
      { type: 'status', operator: 'equals', target: 'status', expected: 200 },
      { type: 'bodyField', operator: 'equals', target: 'data.credited', expected: 50000 },
      { type: 'bodyField', operator: 'equals', target: 'data.duplicate', expected: false },
    ],
    onFailure: 'abort',
  },
  {
    id: 's3',
    name: 'Deliver the very same event again',
    description: 'Byte-for-byte the same body. Nothing should move the second time.',
    dependsOn: ['s2'],
    request: {
      method: 'POST',
      url: '/webhooks/paystack',
      headers: { ...AUTH, 'X-Paystack-Signature': '{{providerSignature}}' },
      body: {
        event: 'charge.success',
        data: { reference: '{{providerEventId}}', amount: 50000, currency: '{{testCurrency}}' },
      },
    },
    extract: [],
    assertions: [
      { type: 'status', operator: 'equals', target: 'status', expected: 200 },
      { type: 'bodyField', operator: 'equals', target: 'data.duplicate', expected: true },
      { type: 'bodyField', operator: 'equals', target: 'data.credited', expected: 0 },
    ],
    onFailure: 'abort',
    retry: { maxAttempts: 1, delayMs: 0 },
  },
  {
    id: 's4',
    name: 'Read the webhook log for that reference',
    description: 'One entry, not two — the log is the thing an auditor would read.',
    dependsOn: ['s3'],
    request: {
      method: 'GET',
      url: '/webhooks/log',
      headers: AUTH,
      query: { reference: '{{providerEventId}}' },
    },
    extract: [],
    assertions: [
      { type: 'status', operator: 'equals', target: 'status', expected: 200 },
      { type: 'bodyField', operator: 'equals', target: 'meta.total', expected: 1 },
    ],
    onFailure: 'continue',
  },
];

function summary(publicId: string): TestPlan {
  const found = plansAwaitingReview.find((p) => p.publicId === publicId);
  if (!found) throw new Error(`No plan summary for ${publicId}`);
  return found;
}

/* Only three plans carry step-level detail. A list does not need it, and
   inventing it for all fifteen would make the mock less honest, not more. */
export const planDetails: TestPlanDetail[] = [
  {
    ...summary('tp_01k1'),
    baseUrl: BASE_URL,
    variables: SEED,
    steps: CHECKOUT_TAX,
    diffContext: {
      branch: 'main',
      commit: 'a91f3c2',
      message: 'tax: split VAT by product band',
      additions: 148,
      deletions: 22,
      files: [
        { path: 'handlers/tax.go', additions: 71, deletions: 9 },
        { path: 'models/tax_band.go', additions: 43, deletions: 7 },
        { path: 'routes/checkout.go', additions: 34, deletions: 6 },
      ],
    },
    previousFailure: null,
    revisions: [
      {
        version: 1,
        whenLabel: '2h ago',
        createdAt: at('2h ago'),
        author: 'ai',
        summary: 'Drafted from the push to main. Five steps, twelve checks.',
        changes: [],
      },
    ],
  },
  {
    ...summary('tp_01k2'),
    baseUrl: BASE_URL,
    variables: SEED,
    steps: PARTIAL_REFUND,
    diffContext: {
      branch: 'main',
      commit: '7d2e04b',
      message: 'refunds: only unshipped lines are refundable',
      additions: 148,
      deletions: 59,
      files: [
        { path: 'services/refund.go', additions: 96, deletions: 41 },
        { path: 'routes/refunds.go', additions: 52, deletions: 18 },
      ],
    },
    previousFailure: {
      version: 1,
      stepId: 's3',
      whenLabel: 'Yesterday',
      observedAt: at('Yesterday'),
      expected: 'data.amount equals 4500',
      actual: '9000',
      verdict: 'undecided',
    },
    revisions: [
      {
        version: 1,
        whenLabel: 'Yesterday',
        createdAt: at('Yesterday'),
        author: 'ai',
        summary: 'Drafted from the first push. Refunded the whole order.',
        changes: [],
      },
      {
        version: 2,
        whenLabel: '3h ago',
        createdAt: at('3h ago'),
        author: 'ai',
        summary:
          'Redrafted after a second push to the same handler, and narrowed the refund to the unshipped line.',
        changes: [
          {
            kind: 'value_changed',
            stepName: 'Refund the unshipped line only',
            detail: 'Refund scope',
            from: 'all',
            to: 'unshipped',
          },
          {
            kind: 'value_changed',
            stepName: 'Refund the unshipped line only',
            detail: 'Expected refund amount',
            from: '9000',
            to: '4500',
          },
          {
            kind: 'assertion_added',
            stepName: 'Refund the unshipped line only',
            detail: 'data.lines_refunded equals 1',
          },
          {
            kind: 'assertion_added',
            stepName: 'Create an order with one line already shipped',
            detail: 'data.refundable_amount equals 4500',
          },
        ],
      },
    ],
  },
  {
    ...summary('tp_01k6'),
    baseUrl: BASE_URL,
    variables: {
      ...SEED,
      providerEventId: 'evt_paystack_8842',
      providerSignature: 'sha512=stub-signed-by-mock',
    },
    steps: WEBHOOK_REPLAY,
    diffContext: null,
    previousFailure: null,
    revisions: [
      {
        version: 1,
        whenLabel: '5d ago',
        createdAt: at('5d ago'),
        author: 'you',
        instruction:
          'Cover the paystack webhook — replaying the same event should not credit the wallet twice.',
        summary: 'Drafted three steps: sign in, deliver the event, deliver it again.',
        changes: [],
      },
      {
        version: 2,
        whenLabel: '4d ago',
        createdAt: at('4d ago'),
        author: 'you',
        instruction: 'The second delivery should be asserted as a duplicate, not just a 200.',
        summary: 'Added the duplicate flag and a zero-credit check to the replay step.',
        changes: [
          {
            kind: 'assertion_added',
            stepName: 'Deliver the very same event again',
            detail: 'data.duplicate equals true',
          },
          {
            kind: 'assertion_added',
            stepName: 'Deliver the very same event again',
            detail: 'data.credited equals 0',
          },
        ],
      },
      {
        version: 3,
        whenLabel: '2d ago',
        createdAt: at('2d ago'),
        author: 'you',
        instruction: 'Check the webhook log too, so we know only one entry was written.',
        summary: 'Added a fourth step that reads the log and asserts a single entry.',
        changes: [
          {
            kind: 'step_added',
            stepName: 'Read the webhook log for that reference',
            detail: 'GET /webhooks/log, filtered to the event reference',
          },
          {
            kind: 'assertion_added',
            stepName: 'Read the webhook log for that reference',
            detail: 'meta.total equals 1',
          },
          {
            kind: 'value_changed',
            stepName: 'Deliver the very same event again',
            detail: 'Retry policy',
            from: '2 attempts',
            to: '1 attempt',
          },
        ],
      },
    ],
  },
];

export function planDetailFor(publicId: string): TestPlanDetail | undefined {
  return planDetails.find((p) => p.publicId === publicId);
}
