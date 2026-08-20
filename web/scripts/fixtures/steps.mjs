/**
 * The three plan bodies that were authored by hand, lifted out of the mock they were
 * written in. They are the only steps in the fixture a person wrote line by line; the
 * rest are generated around them.
 *
 * Plain JS rather than TypeScript because `node scripts/seed.mjs` has no
 * compiler in front of it. The types are still enforced -- on the way out, by
 * `PlanStepSpec` where the data layer reads these rows back.
 */
export const SEED = {
  testEmail: 'qa+run@gritqa.dev',
  testPassword: 'grit-Qa-2f81',
  testCurrency: 'NGN',
};

export function signIn(overrides) {
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

export const AUTH = { Authorization: 'Bearer {{authToken}}', 'Content-Type': 'application/json' };

export const CHECKOUT_TAX = [
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

export const PARTIAL_REFUND = [
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

export const WEBHOOK_REPLAY = [
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
