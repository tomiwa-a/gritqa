/**
 * The fifteen plans the dashboard was designed against, as rows rather than as a
 * list of declared numbers.
 *
 * Times are minutes-ago, not labels. The mock wrote `'3w ago'` and derived an
 * instant from it against a frozen anchor; a row has to go the other way, and
 * `agoLabel` in `src/lib/when.ts` is what turns the column back into words. Two
 * consequences worth knowing before reading a diff of the screens:
 *
 *   - `agoLabel` switches to months at thirty days, so the three plans the mock
 *     labelled `5w/6w/7w ago` now read `1mo ago`. The interval is unchanged and
 *     the sort order with it -- the vocabulary simply does not have those weeks.
 *   - `Just now` is true for a minute. The running execution reads `1m ago`
 *     shortly after a seed, which is what a real running execution would do.
 *
 * `covers` lives in `plan_json` beside the steps, and is route patterns
 * (`/checkout/:id/tax`) rather than the concrete URLs the steps call
 * (`/checkout/{{checkoutId}}/tax`). Those are two different facts: one names an
 * endpoint in the index, the other is a request. Deriving either from the other
 * would be guessing at where a path variable came from.
 */
import { CHECKOUT_TAX, PARTIAL_REFUND, SEED, WEBHOOK_REPLAY } from './steps.mjs';
import {
  ADMIN_FLAG,
  AUTH_ROUND_TRIP,
  CHECKOUT_CHARGE,
  CUSTOMER_CRUD,
  DEFAULT_CARD,
  DUPLICATE_SIGNUP,
  INVOICE_PDF,
  ORDER_CONFIRM,
  PAYOUT_RETRY,
  REFUND_PAID,
  SUBSCRIPTION_LIFECYCLE,
  SUBSCRIPTION_RESUME,
} from './bodies.mjs';

export const BASE_URL = 'http://localhost:8080';

export const HOUR = 60;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
export const MONTH = 30 * DAY;

const e = (method, path) => ({ method, path });

/**
 * Fifteen rows. `key` is a fixture handle used to point runs at plans inside this
 * folder; it is not stored. `public_id` is a UUIDv7 the database mints, so the
 * mock's `tp_01k6` does not survive -- and should not, since it was never an id
 * anything could have issued.
 */
export const PLANS = [
  {
    key: 'checkout_tax',
    name: 'Checkout applies the right tax rate',
    description: 'Quote, checkout, then pay with tax on a mixed cart.',
    status: 'draft',
    version: 1,
    trigger: 'git_push',
    createdAgo: 2 * HOUR,
    variables: SEED,
    covers: [
      e('POST', '/checkout/quote'),
      e('POST', '/checkout'),
      e('POST', '/checkout/:id/tax'),
      e('GET', '/checkout/:id'),
    ],
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
    revisions: [
      {
        version: 1,
        agoMinutes: 2 * HOUR,
        author: 'agent',
        summary: 'Drafted from the push to main. Five steps, twelve checks.',
        changes: [],
      },
    ],
  },

  {
    key: 'partial_refund',
    name: 'Refund a partially shipped order',
    description: 'Refund only the unshipped lines and check the ledger.',
    status: 'draft',
    version: 2,
    trigger: 'git_push',
    createdAgo: 3 * HOUR,
    variables: SEED,
    covers: [e('POST', '/orders'), e('POST', '/refunds'), e('GET', '/refunds/:id')],
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
    revisions: [
      {
        version: 1,
        agoMinutes: DAY,
        author: 'agent',
        summary: 'Drafted from the first push. Refunded the whole order.',
        changes: [],
      },
      {
        version: 2,
        agoMinutes: 3 * HOUR,
        author: 'agent',
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
    key: 'subscription_resume',
    name: 'Subscription resumes after a pause',
    description: 'Pause, wait a cycle, resume, and confirm billing restarts.',
    status: 'draft',
    version: 1,
    trigger: 'git_push',
    createdAgo: 5 * HOUR,
    variables: SEED,
    covers: [
      e('POST', '/subscriptions'),
      e('POST', '/subscriptions/:id/pause'),
      e('POST', '/subscriptions/:id/resume'),
    ],
    steps: SUBSCRIPTION_RESUME,
  },

  {
    key: 'duplicate_signup',
    name: 'Duplicate sign-up is rejected',
    description: 'Register twice with the same email and expect a 409.',
    status: 'draft',
    version: 1,
    trigger: 'manual',
    createdAgo: DAY,
    variables: SEED,
    covers: [e('POST', '/auth/register'), e('GET', '/auth/me')],
    steps: DUPLICATE_SIGNUP,
  },

  {
    key: 'payout_retry',
    name: 'Payout retry after a failed transfer',
    description: 'Force a transfer failure, retry, and check for one payout.',
    status: 'draft',
    version: 1,
    trigger: 'git_push',
    createdAgo: DAY,
    variables: SEED,
    covers: [e('POST', '/payouts'), e('POST', '/payouts/:id/retry'), e('GET', '/payouts/:id')],
    steps: PAYOUT_RETRY,
  },

  {
    key: 'webhook_replay',
    name: 'Webhook replay is idempotent',
    description: 'Replay the same provider event and expect no double credit.',
    status: 'draft',
    version: 3,
    trigger: 'manual',
    createdAgo: 2 * DAY,
    variables: {
      ...SEED,
      providerEventId: 'evt_paystack_8842',
      providerSignature: 'sha512=stub-signed-by-mock',
    },
    covers: [e('POST', '/webhooks/paystack'), e('GET', '/webhooks/log')],
    steps: WEBHOOK_REPLAY,
    revisions: [
      {
        version: 1,
        agoMinutes: 5 * DAY,
        author: 'human',
        instruction:
          'Cover the paystack webhook — replaying the same event should not credit the wallet twice.',
        summary: 'Drafted three steps: sign in, deliver the event, deliver it again.',
        changes: [],
      },
      {
        version: 2,
        agoMinutes: 4 * DAY,
        author: 'human',
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
        agoMinutes: 2 * DAY,
        author: 'human',
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

  {
    key: 'default_card',
    name: 'Card set as default survives re-auth',
    description: 'Add a card, make it default, sign out and back in.',
    status: 'draft',
    version: 1,
    trigger: 'git_push',
    createdAgo: 2 * DAY,
    variables: SEED,
    covers: [
      e('POST', '/customers/:id/cards'),
      e('PUT', '/customers/:id/cards/:cardId'),
      e('GET', '/customers/:id/cards'),
    ],
    steps: DEFAULT_CARD,
  },

  {
    key: 'customer_crud',
    name: 'Customer CRUD round trip',
    description: 'Create a customer, edit them, read their orders, remove them.',
    status: 'approved',
    version: 2,
    trigger: 'git_push',
    createdAgo: 3 * WEEK,
    variables: SEED,
    covers: [
      e('POST', '/customers'),
      e('PATCH', '/customers/:id'),
      e('GET', '/customers/:id/orders'),
      e('DELETE', '/customers/:id'),
    ],
    steps: CUSTOMER_CRUD,
  },

  {
    key: 'auth_round_trip',
    name: 'Sign in and fetch the current user',
    description: 'The shortest path through auth, run before everything else.',
    status: 'approved',
    version: 1,
    trigger: 'manual',
    createdAgo: 2 * MONTH,
    variables: SEED,
    covers: [e('POST', '/auth/login'), e('GET', '/auth/me'), e('POST', '/auth/logout')],
    steps: AUTH_ROUND_TRIP,
  },

  {
    key: 'order_confirm',
    name: 'Create and confirm an order',
    description: 'Open an order, add a line, confirm it, check the total.',
    status: 'approved',
    version: 3,
    trigger: 'git_push',
    createdAgo: 5 * WEEK,
    variables: SEED,
    covers: [
      e('POST', '/orders'),
      e('POST', '/orders/:id/items'),
      e('POST', '/orders/:id/confirm'),
    ],
    steps: ORDER_CONFIRM,
  },

  {
    key: 'checkout_charge',
    name: 'Charge a checkout with a mocked provider',
    description: 'Pay a checkout against the provider mock and read the receipt.',
    status: 'approved',
    version: 4,
    trigger: 'git_push',
    createdAgo: 6 * WEEK,
    variables: SEED,
    covers: [
      e('POST', '/checkout'),
      e('POST', '/checkout/:id/tax'),
      e('POST', '/checkout/:id/pay'),
    ],
    steps: CHECKOUT_CHARGE,
  },

  {
    key: 'refund_paid',
    name: 'Refund a paid order',
    description: 'Refund in full and confirm the ledger balances.',
    status: 'approved',
    version: 2,
    trigger: 'manual',
    createdAgo: 7 * WEEK,
    variables: SEED,
    covers: [e('POST', '/refunds'), e('GET', '/refunds/:id')],
    steps: REFUND_PAID,
  },

  {
    key: 'subscription_lifecycle',
    name: 'Subscription lifecycle',
    description: 'Start, pause, and cancel a subscription in one pass.',
    status: 'approved',
    version: 2,
    trigger: 'git_push',
    createdAgo: 2 * MONTH,
    variables: SEED,
    covers: [
      e('POST', '/subscriptions'),
      e('POST', '/subscriptions/:id/pause'),
      e('DELETE', '/subscriptions/:id'),
    ],
    steps: SUBSCRIPTION_LIFECYCLE,
  },

  {
    key: 'invoice_pdf',
    name: 'Invoice PDF export',
    description: 'Send an invoice and download the rendered PDF.',
    status: 'archived',
    version: 1,
    trigger: 'manual',
    createdAgo: 4 * MONTH,
    variables: { ...SEED, testInvoiceId: 'inv_2026_0417' },
    covers: [e('POST', '/invoices/:id/send'), e('GET', '/invoices/:id/pdf')],
    steps: INVOICE_PDF,
  },

  {
    key: 'admin_flag',
    name: 'Admin flag toggle',
    description: 'Turn a feature flag on and off as an admin.',
    status: 'archived',
    version: 2,
    trigger: 'manual',
    createdAgo: 4 * MONTH,
    variables: SEED,
    covers: [e('POST', '/admin/flags'), e('DELETE', '/admin/flags/:id')],
    steps: ADMIN_FLAG,
  },
];

const WORD = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
];

const spell = (n) => WORD[n] ?? String(n);

/**
 * A revision row per version, for the plans that were never given a history.
 *
 * The first line is derived from the body rather than written -- "Five steps,
 * twelve checks" is a count, and a count should be counted. The later lines say
 * only what a redraft is; the sentence a developer typed is what
 * `plan_revisions.instruction` is for, and there was never one to record here, so
 * these are the agent's own turns and the column stays null.
 */
function generatedRevisions(plan) {
  const steps = plan.steps.length;
  const checks = plan.steps.reduce((n, s) => n + s.assertions.length, 0);
  const opened =
    plan.trigger === 'git_push'
      ? `Drafted from the push to main. ${spell(steps)} steps, ${spell(checks)} checks.`
      : `Drafted on request. ${spell(steps)} steps, ${spell(checks)} checks.`;

  const later = [
    'Redrafted after a second push to the same handlers.',
    'Redrafted again after the handler moved once more.',
    'Redrafted after a fourth push, with the step order left alone.',
  ];

  return Array.from({ length: plan.version }, (_, i) => ({
    version: i + 1,
    // Spaced a day apart, ending at the plan's own timestamp: the latest
    // revision is when the plan last changed, which is what `updated_at` means.
    agoMinutes: plan.createdAgo + (plan.version - 1 - i) * DAY,
    author: 'agent',
    summary: i === 0 ? opened : (later[i - 1] ?? 'Redrafted.'),
    changes: [],
  }));
}

export function revisionsFor(plan) {
  return plan.revisions ?? generatedRevisions(plan);
}
