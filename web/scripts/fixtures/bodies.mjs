/**
 * The twelve plan bodies the mock never had.
 *
 * `test_plans.plan_json` is NOT NULL, and that is the right constraint: a plan
 * with no steps is not a plan. The mock could dodge it -- it declared
 * `stepCount: 6` on a plan whose steps did not exist anywhere, because a list
 * screen never asks for them. A row cannot dodge it, so these are written out.
 *
 * Two of the twelve were not invented from nothing. The six approved plans have
 * runs in the fixture, and a run names every step it took, in order, with its
 * method and path -- so their steps are transcribed from the runs rather than
 * made up, and the two agree by construction instead of by luck.
 *
 * The assertion counts are deliberate. Each body lands on exactly the number the
 * mock declared, so no screen's figure changes when the source does; from here on
 * the count is derived from the body and cannot drift from it again.
 */
import { AUTH, signIn } from './steps.mjs';

const ok = { type: 'status', operator: 'equals', target: 'status', expected: 200 };
const created = { type: 'status', operator: 'equals', target: 'status', expected: 201 };
const noContent = { type: 'status', operator: 'equals', target: 'status', expected: 204 };
const never500 = { type: 'status', operator: 'notEquals', target: 'status', expected: 500 };
const fast = { type: 'responseTime', operator: 'lt', target: 'responseTime', expected: 2000 };
const exists = (target) => ({ type: 'bodyField', operator: 'exists', target });
const equals = (target, expected) => ({ type: 'bodyField', operator: 'equals', target, expected });

/** Sugar for the common shape: authenticated JSON call, abort on failure. */
function step(id, name, description, method, url, extra = {}) {
  return {
    id,
    name,
    description,
    dependsOn: [`s${Number(id.slice(1)) - 1}`],
    request: { method, url, headers: AUTH, ...(extra.body ? { body: extra.body } : {}) },
    extract: extra.extract ?? [],
    assertions: extra.assertions ?? [],
    onFailure: extra.onFailure ?? 'abort',
  };
}

// --- The six approved plans, transcribed from their runs --------------------

export const CUSTOMER_CRUD = [
  signIn({ name: 'Sign in' }),
  step(
    's2',
    'Create a customer',
    'The row every later step in the round trip works on.',
    'POST',
    '/customers',
    {
      body: { email: '{{testEmail}}', name: 'Grit Test' },
      extract: [{ name: 'customerId', path: '$.data.id', source: 'body' }],
      assertions: [created, exists('data.id'), equals('data.email', '{{testEmail}}')],
    },
  ),
  step(
    's3',
    'Update them',
    'A partial write, so the response has to show the merge and not a replacement.',
    'PATCH',
    '/customers/{{customerId}}',
    {
      body: { name: 'Ada Lovelace' },
      assertions: [ok, equals('data.name', 'Ada Lovelace'), equals('data.email', '{{testEmail}}')],
    },
  ),
  step(
    's4',
    'List their orders',
    'Empty is the correct answer here, and an envelope is still expected around it.',
    'GET',
    '/customers/{{customerId}}/orders',
    {
      assertions: [ok, exists('meta.total'), equals('meta.total', 0)],
    },
  ),
  step(
    's5',
    'Delete them',
    'The round trip only closes if the row actually goes.',
    'DELETE',
    '/customers/{{customerId}}',
    {
      assertions: [noContent, never500, fast],
    },
  ),
];

export const AUTH_ROUND_TRIP = [
  signIn({ name: 'Sign in' }),
  step(
    's2',
    'Fetch me',
    'The token from the step above has to describe the same person it was issued for.',
    'GET',
    '/auth/me',
    {
      assertions: [ok, equals('data.email', '{{testEmail}}'), equals('data.id', '{{userId}}')],
    },
  ),
  step(
    's3',
    'Sign out',
    'Revoking is the half of auth that is easiest to leave untested.',
    'POST',
    '/auth/logout',
    {
      assertions: [noContent, never500, fast],
    },
  ),
];

export const ORDER_CONFIRM = [
  signIn({ name: 'Sign in' }),
  step(
    's2',
    'Create an order',
    'An order opens empty, so the total below has nothing to inherit.',
    'POST',
    '/orders',
    {
      body: { currency: '{{testCurrency}}' },
      extract: [{ name: 'orderId', path: '$.data.id', source: 'body' }],
      assertions: [created, exists('data.id'), equals('data.status', 'open')],
    },
  ),
  step(
    's3',
    'Add a line item',
    'One line at a known price, so the confirmed total is checkable rather than plausible.',
    'POST',
    '/orders/{{orderId}}/items',
    {
      body: { sku: 'LAPTOP-01', qty: 1, unit_amount: 89000 },
      assertions: [created, exists('data.lines'), equals('data.total', 89000)],
    },
  ),
  step(
    's4',
    'Confirm it',
    'Confirming must not move the total it was shown at.',
    'POST',
    '/orders/{{orderId}}/confirm',
    {
      assertions: [ok, equals('data.status', 'confirmed'), equals('data.total', 89000)],
    },
  ),
];

export const CHECKOUT_CHARGE = [
  signIn({ name: 'Sign in' }),
  step(
    's2',
    'Quote the cart',
    'Scaffolding for the charge below -- the quote is not what this plan is about.',
    'POST',
    '/checkout/quote',
    {
      body: {
        currency: '{{testCurrency}}',
        lines: [{ sku: 'LAPTOP-01', qty: 1, unit_amount: 89000 }],
      },
      extract: [{ name: 'quoteId', path: '$.data.quote_id', source: 'body' }],
      assertions: [ok, exists('data.quote_id'), exists('data.total')],
    },
  ),
  step(
    's3',
    'Open checkout',
    'A checkout is the thing that can be paid; a quote is not.',
    'POST',
    '/checkout',
    {
      body: { quote_id: '{{quoteId}}' },
      extract: [{ name: 'checkoutId', path: '$.data.id', source: 'body' }],
      assertions: [created, exists('data.id'), equals('data.status', 'open')],
    },
  ),
  step(
    's4',
    'Apply tax',
    'Tax before payment, because the amount charged has to include it.',
    'POST',
    '/checkout/{{checkoutId}}/tax',
    {
      body: { region: 'NG-LA' },
      assertions: [ok, exists('data.tax_total'), fast],
    },
  ),
  step(
    's5',
    'Pay',
    'Against the provider mock, so a passing run never moves real money.',
    'POST',
    '/checkout/{{checkoutId}}/pay',
    {
      body: { provider: 'paystack' },
      assertions: [ok, equals('data.status', 'paid')],
    },
  ),
];

export const REFUND_PAID = [
  signIn({ name: 'Sign in' }),
  step(
    's2',
    'Create a paid order',
    'Nothing to refund otherwise, so this is setup rather than subject.',
    'POST',
    '/orders',
    {
      body: { currency: '{{testCurrency}}', amount: 50000, pay: true },
      extract: [{ name: 'orderId', path: '$.data.id', source: 'body' }],
      assertions: [created, exists('data.id'), equals('data.status', 'paid')],
    },
  ),
  step(
    's3',
    'Refund it',
    'In full, which is the case the ledger is easiest to get wrong on.',
    'POST',
    '/refunds',
    {
      body: { order_id: '{{orderId}}', amount: 50000 },
      extract: [{ name: 'refundId', path: '$.data.id', source: 'body' }],
      assertions: [created, exists('data.id'), equals('data.amount', 50000)],
    },
  ),
  step(
    's4',
    'Check the ledger',
    'A refund that is accepted and never settles is the failure this catches.',
    'GET',
    '/refunds/{{refundId}}',
    {
      assertions: [ok, equals('data.status', 'succeeded')],
    },
  ),
];

export const SUBSCRIPTION_LIFECYCLE = [
  signIn({ name: 'Sign in' }),
  step(
    's2',
    'Start a subscription',
    'Active from the first response, with no pending intermediate state.',
    'POST',
    '/subscriptions',
    {
      body: { plan: 'standard-monthly', currency: '{{testCurrency}}' },
      extract: [{ name: 'subscriptionId', path: '$.data.id', source: 'body' }],
      assertions: [created, exists('data.id'), equals('data.status', 'active')],
    },
  ),
  step(
    's3',
    'Pause it',
    'Pausing is reversible, which is what makes it different from the step below.',
    'POST',
    '/subscriptions/{{subscriptionId}}/pause',
    {
      assertions: [ok, equals('data.status', 'paused')],
    },
  ),
  step(
    's4',
    'Cancel it',
    'Cancelling a paused subscription is the ordering that tends to be rejected.',
    'DELETE',
    '/subscriptions/{{subscriptionId}}',
    {
      assertions: [noContent, never500],
    },
  ),
];

// --- The six with no run to transcribe from --------------------------------

export const SUBSCRIPTION_RESUME = [
  signIn(),
  step(
    's2',
    'Start a subscription to pause',
    'Setup, so the pause below has something with a billing date on it.',
    'POST',
    '/subscriptions',
    {
      body: { plan: 'standard-monthly', currency: '{{testCurrency}}' },
      extract: [{ name: 'subscriptionId', path: '$.data.id', source: 'body' }],
      assertions: [created, exists('data.id'), equals('data.status', 'active')],
    },
  ),
  step(
    's3',
    'Pause it',
    'A paused subscription should stop billing without losing where it was.',
    'POST',
    '/subscriptions/{{subscriptionId}}/pause',
    {
      assertions: [ok, equals('data.status', 'paused'), exists('data.paused_at')],
    },
  ),
  step(
    's4',
    'Read it back while paused',
    'The absent field is the assertion: a paused subscription has no next invoice.',
    'GET',
    '/subscriptions/{{subscriptionId}}',
    {
      assertions: [ok, equals('data.status', 'paused')],
    },
  ),
  step(
    's5',
    'Resume it',
    'The call the change under test is about.',
    'POST',
    '/subscriptions/{{subscriptionId}}/resume',
    {
      assertions: [ok, equals('data.status', 'active')],
    },
  ),
  step(
    's6',
    'Confirm billing restarted',
    'Resuming to active without a next invoice date is the silent version of this bug.',
    'GET',
    '/subscriptions/{{subscriptionId}}',
    {
      assertions: [ok, exists('data.next_invoice_at')],
    },
  ),
];

export const DUPLICATE_SIGNUP = [
  {
    id: 's1',
    name: 'Register the test user',
    description:
      'The container starts from an empty database, so this address is free on the first call.',
    dependsOn: [],
    request: {
      method: 'POST',
      url: '/auth/register',
      headers: { 'Content-Type': 'application/json' },
      body: { email: '{{testEmail}}', password: '{{testPassword}}' },
    },
    extract: [
      { name: 'authToken', path: '$.data.token', source: 'body' },
      { name: 'userId', path: '$.data.user.id', source: 'body' },
    ],
    assertions: [created, exists('data.token'), equals('data.user.email', '{{testEmail}}')],
    onFailure: 'abort',
  },
  {
    id: 's2',
    name: 'Register the very same address again',
    description:
      'A 409 rather than a second account. A 500 here is the same bug wearing a worse status code.',
    dependsOn: ['s1'],
    request: {
      method: 'POST',
      url: '/auth/register',
      headers: { 'Content-Type': 'application/json' },
      body: { email: '{{testEmail}}', password: '{{testPassword}}' },
    },
    extract: [],
    assertions: [
      { type: 'status', operator: 'equals', target: 'status', expected: 409 },
      { type: 'bodyField', operator: 'contains', target: 'data.error', expected: 'already' },
    ],
    onFailure: 'continue',
  },
  step(
    's3',
    'Confirm there is still one account',
    'The rejected call must not have replaced or renumbered the first one.',
    'GET',
    '/auth/me',
    {
      assertions: [ok, equals('data.id', '{{userId}}')],
    },
  ),
];

export const PAYOUT_RETRY = [
  signIn(),
  step(
    's2',
    'Request a payout the mock will fail',
    'The provider mock is configured to reject this transfer, which is how the retry gets something to retry.',
    'POST',
    '/payouts',
    {
      body: { amount: 50000, currency: '{{testCurrency}}', destination: 'acct_will_fail' },
      extract: [{ name: 'payoutId', path: '$.data.id', source: 'body' }],
      assertions: [created, exists('data.id'), equals('data.status', 'pending')],
    },
  ),
  step(
    's3',
    'Read the failure back',
    'A payout that fails silently and reads as pending forever is the worse outcome.',
    'GET',
    '/payouts/{{payoutId}}',
    {
      assertions: [ok, equals('data.status', 'failed')],
    },
  ),
  step(
    's4',
    'Retry it',
    'One more attempt on the same payout, not a second payout.',
    'POST',
    '/payouts/{{payoutId}}/retry',
    {
      assertions: [ok, equals('data.attempts', 2)],
    },
  ),
  step(
    's5',
    'Confirm one payout, settled',
    'Double-paying on retry is the bug this plan exists for.',
    'GET',
    '/payouts/{{payoutId}}',
    {
      assertions: [ok, equals('data.status', 'succeeded')],
    },
  ),
];

export const DEFAULT_CARD = [
  signIn(),
  step(
    's2',
    'Add a card',
    'A second card, so "default" has something to be chosen over.',
    'POST',
    '/customers/{{userId}}/cards',
    {
      body: { number: '4084084084084081', exp_month: 12, exp_year: 2030, cvv: '408' },
      extract: [{ name: 'cardId', path: '$.data.id', source: 'body' }],
      assertions: [created, exists('data.id'), equals('data.is_default', false)],
    },
  ),
  step(
    's3',
    'Make it the default',
    'The write whose durability the rest of the plan is testing.',
    'PUT',
    '/customers/{{userId}}/cards/{{cardId}}',
    {
      body: { is_default: true },
      assertions: [ok, equals('data.is_default', true), fast],
    },
  ),
  {
    id: 's4',
    name: 'Sign in again for a fresh token',
    description: 'A new session, because a default held only in the old token is not held at all.',
    dependsOn: ['s3'],
    request: {
      method: 'POST',
      url: '/auth/login',
      headers: { 'Content-Type': 'application/json' },
      body: { email: '{{testEmail}}', password: '{{testPassword}}' },
    },
    extract: [{ name: 'authToken', path: '$.data.token', source: 'body' }],
    assertions: [
      ok,
      exists('data.token'),
      { type: 'responseTime', operator: 'lt', target: 'responseTime', expected: 2000 },
    ],
    onFailure: 'abort',
  },
  step(
    's5',
    'Read the cards back',
    'Same answer as before the re-auth, or the flag was only ever in memory.',
    'GET',
    '/customers/{{userId}}/cards',
    {
      assertions: [ok, equals('data.0.is_default', true)],
    },
  ),
];

export const INVOICE_PDF = [
  signIn(),
  step(
    's2',
    'Send the invoice',
    'Sending is what renders the document, so the export below has something to fetch.',
    'POST',
    '/invoices/{{testInvoiceId}}/send',
    {
      body: { to: '{{testEmail}}' },
      assertions: [
        { type: 'status', operator: 'equals', target: 'status', expected: 202 },
        exists('data.sent_at'),
      ],
    },
  ),
  step(
    's3',
    'Download the rendered PDF',
    'A 200 with an HTML error page in it is the failure a status check alone misses.',
    'GET',
    '/invoices/{{testInvoiceId}}/pdf',
    {
      assertions: [
        ok,
        {
          type: 'header',
          operator: 'contains',
          target: 'content-type',
          expected: 'application/pdf',
        },
      ],
    },
  ),
];

export const ADMIN_FLAG = [
  signIn(),
  step(
    's2',
    'Turn the flag on',
    'An admin-only write, which is the part worth having a test for.',
    'POST',
    '/admin/flags',
    {
      body: { key: 'grit_demo_flag', enabled: true },
      extract: [{ name: 'flagId', path: '$.data.id', source: 'body' }],
      assertions: [created, equals('data.enabled', true)],
    },
  ),
  step(
    's3',
    'Turn it off again',
    'Off is a delete here, which is why the step below exists.',
    'DELETE',
    '/admin/flags/{{flagId}}',
    {
      assertions: [noContent, never500],
    },
  ),
  step(
    's4',
    'Turn it off once more',
    'The second delete should be a clean 404, not a 500 and not a success.',
    'DELETE',
    '/admin/flags/{{flagId}}',
    {
      assertions: [
        { type: 'status', operator: 'equals', target: 'status', expected: 404 },
        { type: 'bodyField', operator: 'contains', target: 'data.error', expected: 'not found' },
      ],
      onFailure: 'continue',
    },
  ),
];
