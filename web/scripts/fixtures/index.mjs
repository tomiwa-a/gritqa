/**
 * The codebase index: one row per file, shaped like a tree-sitter pass over a Go API.
 *
 * This is the surface every coverage square is drawn from, so it has to be the whole
 * API rather than a sample of it. The mock kept two lists that could not both be
 * true -- six indexed files under `internal/http/`, and a separate coverage source
 * of thirteen files under `routes/` -- which meant `/auth/login` was defined twice,
 * in two directories, in one project. There is one layout here, and coverage reads
 * it.
 *
 * `dependencies` names files that are also in this list. A dangling edge would make
 * the dependency view lie about reach, and reach is the thing it exists to answer.
 */
const routes = [
  [
    'auth.go',
    ['Login', 'Register', 'Refresh', 'Revoke', 'Me', 'ForgotPassword', 'ResetPassword'],
    ['internal/token/sign.go'],
    [
      'POST /auth/login',
      'POST /auth/register',
      'POST /auth/refresh',
      'POST /auth/revoke',
      'POST /auth/logout',
      'GET /auth/me',
      'POST /auth/forgot-password',
      'POST /auth/reset-password',
    ],
  ],
  [
    'checkout.go',
    ['QuoteHandler', 'CheckoutHandler', 'TaxHandler', 'PayHandler', 'SummaryHandler'],
    ['internal/tax/rate.go', 'internal/store/orders.go'],
    [
      'POST /checkout',
      'GET /checkout/:id',
      'POST /checkout/:id/pay',
      'POST /checkout/:id/cancel',
      'POST /checkout/:id/tax',
      'GET /checkout/:id/summary',
      'POST /checkout/quote',
      'POST /checkout/validate',
    ],
  ],
  [
    'orders.go',
    ['ListOrders', 'CreateOrder', 'GetOrder', 'UpdateOrder', 'CancelOrder', 'ConfirmOrder'],
    ['internal/store/orders.go'],
    [
      'GET /orders',
      'POST /orders',
      'GET /orders/:id',
      'PATCH /orders/:id',
      'DELETE /orders/:id',
      'POST /orders/:id/confirm',
      'POST /orders/:id/cancel',
      'GET /orders/:id/items',
      'POST /orders/:id/items',
    ],
  ],
  [
    'refunds.go',
    ['CreateRefund', 'ListRefunds', 'GetRefund', 'ApproveRefund', 'RejectRefund'],
    ['internal/store/refunds.go', 'internal/tax/rate.go'],
    [
      'POST /refunds',
      'GET /refunds',
      'GET /refunds/:id',
      'POST /refunds/:id/approve',
      'POST /refunds/:id/reject',
      'GET /refunds/:id/receipt',
    ],
  ],
  [
    'customers.go',
    ['ListCustomers', 'CreateCustomer', 'GetCustomer', 'UpdateCustomer', 'DeleteCustomer', 'Cards'],
    ['internal/store/customers.go'],
    [
      'GET /customers',
      'POST /customers',
      'GET /customers/:id',
      'PATCH /customers/:id',
      'DELETE /customers/:id',
      'GET /customers/:id/orders',
      'GET /customers/:id/cards',
      'POST /customers/:id/cards',
      'PUT /customers/:id/cards/:cardId',
      'POST /customers/import',
    ],
  ],
  [
    'subscriptions.go',
    ['ListSubscriptions', 'CreateSubscription', 'GetSubscription', 'Pause', 'Resume', 'Cancel'],
    ['internal/store/customers.go', 'internal/tax/rate.go'],
    [
      'GET /subscriptions',
      'POST /subscriptions',
      'GET /subscriptions/:id',
      'PATCH /subscriptions/:id',
      'POST /subscriptions/:id/pause',
      'POST /subscriptions/:id/resume',
      'DELETE /subscriptions/:id',
    ],
  ],
  [
    'invoices.go',
    ['ListInvoices', 'CreateInvoice', 'GetInvoice', 'SendInvoice', 'RenderPDF', 'VoidInvoice'],
    ['internal/store/orders.go', 'internal/tax/rate.go'],
    [
      'GET /invoices',
      'POST /invoices',
      'GET /invoices/:id',
      'POST /invoices/:id/send',
      'GET /invoices/:id/pdf',
      'POST /invoices/:id/void',
      'GET /invoices/:id/lines',
    ],
  ],
  [
    'payouts.go',
    ['ListPayouts', 'CreatePayout', 'GetPayout', 'RetryPayout', 'Ledger'],
    ['internal/store/orders.go'],
    [
      'GET /payouts',
      'POST /payouts',
      'GET /payouts/:id',
      'POST /payouts/:id/retry',
      'GET /payouts/:id/ledger',
      'POST /payouts/:id/cancel',
    ],
  ],
  [
    'webhooks.go',
    ['Paystack', 'Stripe', 'Replay', 'Log'],
    ['internal/store/orders.go', 'internal/token/sign.go'],
    [
      'POST /webhooks/paystack',
      'POST /webhooks/stripe',
      'POST /webhooks/replay',
      'GET /webhooks/log',
    ],
  ],
  [
    'products.go',
    ['ListProducts', 'CreateProduct', 'GetProduct', 'UpdateProduct', 'Prices', 'Archive'],
    [],
    [
      'GET /products',
      'POST /products',
      'GET /products/:id',
      'PATCH /products/:id',
      'DELETE /products/:id',
      'GET /products/:id/prices',
      'POST /products/:id/prices',
      'POST /products/:id/archive',
      'GET /products/search',
      'POST /products/bulk',
    ],
  ],
  [
    'reports.go',
    ['Revenue', 'Churn', 'MRR', 'Export', 'FailedPayments', 'Disputes'],
    ['internal/store/orders.go', 'internal/store/customers.go'],
    [
      'GET /reports/revenue',
      'GET /reports/churn',
      'GET /reports/mrr',
      'POST /reports/export',
      'GET /reports/failed-payments',
      'GET /reports/disputes',
    ],
  ],
  [
    'admin.go',
    ['ListUsers', 'CreateUser', 'UpdateUser', 'Audit', 'Flags', 'Health'],
    ['internal/token/sign.go'],
    [
      'GET /admin/users',
      'POST /admin/users',
      'PATCH /admin/users/:id',
      'GET /admin/audit',
      'POST /admin/flags',
      'GET /admin/flags',
      'DELETE /admin/flags/:id',
      'GET /admin/health',
    ],
  ],
  ['health.go', ['Health', 'Ready', 'Version'], [], ['GET /health', 'GET /ready', 'GET /version']],
];

/** Files with no routes of their own. Reach passes through them. */
const internals = [
  ['internal/tax/rate.go', ['RateFor', 'Jurisdiction', 'applyCompound'], ['internal/tax/band.go']],
  // Added by the push the checkout-tax plan was drafted for, and indexed after it.
  ['internal/tax/band.go', ['Band', 'BandFor', 'vatFor'], []],
  ['internal/store/orders.go', ['Insert', 'ByID', 'Cancel', 'Confirm'], []],
  ['internal/store/refunds.go', ['Insert', 'ByID', 'Approve'], ['internal/store/orders.go']],
  ['internal/store/customers.go', ['Insert', 'ByID', 'Update', 'Cards'], []],
  ['internal/token/sign.go', ['Sign', 'Verify', 'rotate'], []],
];

const parse = (signature) => {
  const [method, path] = signature.split(' ');
  return { method, path };
};

export const INDEX = [
  ...routes.map(([name, symbols, dependencies, endpoints]) => ({
    filePath: `internal/http/${name}`,
    language: 'go',
    symbols,
    dependencies,
    endpoints: endpoints.map(parse),
  })),
  ...internals.map(([filePath, symbols, dependencies]) => ({
    filePath,
    language: 'go',
    symbols,
    dependencies,
    endpoints: [],
  })),
];
