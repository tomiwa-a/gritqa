import type {
  CoverageFile,
  Project,
  TestExecution,
  TestPlan,
  TestingRule,
  User,
} from './types';

export const user: User = {
  publicId: 'usr_01j9',
  name: 'Tomiwa',
  email: 'tomiwa@gritqa.dev',
  avatarUrl: null,
  provider: 'github',
  hasAiKey: true,
};

export const projects: Project[] = [
  {
    publicId: 'prj_01j9a',
    name: 'payments-api',
    repoUrl: 'github.com/tomiwa/payments-api',
    localPath: '~/code/payments-api',
    defaultBranch: 'main',
    status: 'active',
    lastIndexedLabel: '4m ago',
    fileCount: 34,
    endpointCount: 91,
  },
  {
    publicId: 'prj_01j9b',
    name: 'auth-service',
    repoUrl: 'github.com/tomiwa/auth-service',
    localPath: '~/code/auth-service',
    defaultBranch: 'main',
    status: 'active',
    lastIndexedLabel: '2d ago',
    fileCount: 18,
    endpointCount: 24,
  },
  {
    publicId: 'prj_01j9c',
    name: 'orders-api',
    repoUrl: 'github.com/tomiwa/orders-api',
    localPath: '~/code/orders-api',
    defaultBranch: 'main',
    status: 'active',
    lastIndexedLabel: '6d ago',
    fileCount: 27,
    endpointCount: 41,
  },
  {
    publicId: 'prj_01j9d',
    name: 'notifications',
    repoUrl: 'github.com/tomiwa/notifications',
    localPath: '~/code/notifications',
    defaultBranch: 'develop',
    status: 'active',
    lastIndexedLabel: null,
    fileCount: 0,
    endpointCount: 0,
  },
  {
    publicId: 'prj_01j9e',
    name: 'web-bff',
    repoUrl: 'github.com/tomiwa/web-bff',
    localPath: '~/code/web-bff',
    defaultBranch: 'main',
    status: 'active',
    lastIndexedLabel: '3w ago',
    fileCount: 12,
    endpointCount: 16,
  },
  {
    publicId: 'prj_01j9f',
    name: 'admin-api',
    repoUrl: 'github.com/tomiwa/admin-api',
    localPath: '~/code/admin-api',
    defaultBranch: 'main',
    status: 'archived',
    lastIndexedLabel: '4mo ago',
    fileCount: 9,
    endpointCount: 11,
  },
];

export const currentProject = projects[0];

export const plansAwaitingReview: TestPlan[] = [
  {
    publicId: 'tp_01k1',
    name: 'Checkout applies the right tax rate',
    description: 'Quote, checkout, then pay with tax on a mixed cart.',
    status: 'draft',
    version: 1,
    triggerSource: 'git_push',
    createdLabel: '2h ago',
    stepCount: 5,
    assertionCount: 12,
    endpointCount: 3,
    lastRun: null,
  },
  {
    publicId: 'tp_01k2',
    name: 'Refund a partially shipped order',
    description: 'Refund only the unshipped lines and check the ledger.',
    status: 'draft',
    version: 2,
    triggerSource: 'git_push',
    createdLabel: '3h ago',
    stepCount: 4,
    assertionCount: 9,
    endpointCount: 2,
    lastRun: { status: 'failed', passed: 3, total: 4, label: 'v1, yesterday' },
  },
  {
    publicId: 'tp_01k3',
    name: 'Subscription resumes after a pause',
    description: 'Pause, wait a cycle, resume, and confirm billing restarts.',
    status: 'draft',
    version: 1,
    triggerSource: 'git_push',
    createdLabel: '5h ago',
    stepCount: 6,
    assertionCount: 14,
    endpointCount: 3,
    lastRun: null,
  },
  {
    publicId: 'tp_01k4',
    name: 'Duplicate sign-up is rejected',
    description: 'Register twice with the same email and expect a 409.',
    status: 'draft',
    version: 1,
    triggerSource: 'manual',
    createdLabel: 'Yesterday',
    stepCount: 3,
    assertionCount: 7,
    endpointCount: 2,
    lastRun: null,
  },
  {
    publicId: 'tp_01k5',
    name: 'Payout retry after a failed transfer',
    description: 'Force a transfer failure, retry, and check for one payout.',
    status: 'draft',
    version: 1,
    triggerSource: 'git_push',
    createdLabel: 'Yesterday',
    stepCount: 5,
    assertionCount: 11,
    endpointCount: 2,
    lastRun: null,
  },
  {
    publicId: 'tp_01k6',
    name: 'Webhook replay is idempotent',
    description: 'Replay the same provider event and expect no double credit.',
    status: 'draft',
    version: 3,
    triggerSource: 'manual',
    createdLabel: '2d ago',
    stepCount: 4,
    assertionCount: 10,
    endpointCount: 2,
    lastRun: { status: 'passed', passed: 4, total: 4, label: 'v2, 3d ago' },
  },
  {
    publicId: 'tp_01k7',
    name: 'Card set as default survives re-auth',
    description: 'Add a card, make it default, sign out and back in.',
    status: 'draft',
    version: 1,
    triggerSource: 'git_push',
    createdLabel: '2d ago',
    stepCount: 5,
    assertionCount: 13,
    endpointCount: 3,
    lastRun: null,
  },
];

export const recentRuns: TestExecution[] = [
  {
    publicId: 'ex_01m1',
    planName: 'Charge a checkout with a mocked provider',
    status: 'failed',
    durationMs: 4100,
    startedLabel: '12m ago',
    steps: [
      { stepName: 'Sign in', status: 'passed', method: 'POST', path: '/auth/login', responseStatus: 200, responseTimeMs: 84 },
      { stepName: 'Quote the cart', status: 'passed', method: 'POST', path: '/checkout/quote', responseStatus: 200, responseTimeMs: 132 },
      { stepName: 'Open checkout', status: 'passed', method: 'POST', path: '/checkout', responseStatus: 201, responseTimeMs: 148 },
      { stepName: 'Apply tax', status: 'failed', method: 'POST', path: '/checkout/:id/tax', responseStatus: 500, responseTimeMs: 2210 },
      { stepName: 'Pay', status: 'skipped', method: 'POST', path: '/checkout/:id/pay', responseStatus: null, responseTimeMs: null },
    ],
  },
  {
    publicId: 'ex_01m2',
    planName: 'Create and confirm an order',
    status: 'passed',
    durationMs: 2900,
    startedLabel: '26m ago',
    steps: [
      { stepName: 'Sign in', status: 'passed', method: 'POST', path: '/auth/login', responseStatus: 200, responseTimeMs: 79 },
      { stepName: 'Create an order', status: 'passed', method: 'POST', path: '/orders', responseStatus: 201, responseTimeMs: 141 },
      { stepName: 'Add a line item', status: 'passed', method: 'POST', path: '/orders/:id/items', responseStatus: 201, responseTimeMs: 96 },
      { stepName: 'Confirm it', status: 'passed', method: 'POST', path: '/orders/:id/confirm', responseStatus: 200, responseTimeMs: 173 },
    ],
  },
  {
    publicId: 'ex_01m3',
    planName: 'Refund a paid order',
    status: 'running',
    durationMs: null,
    startedLabel: 'Just now',
    steps: [
      { stepName: 'Sign in', status: 'passed', method: 'POST', path: '/auth/login', responseStatus: 200, responseTimeMs: 81 },
      { stepName: 'Create a paid order', status: 'passed', method: 'POST', path: '/orders', responseStatus: 201, responseTimeMs: 152 },
      { stepName: 'Refund it', status: 'pending', method: 'POST', path: '/refunds', responseStatus: null, responseTimeMs: null },
      { stepName: 'Check the ledger', status: 'pending', method: 'GET', path: '/refunds/:id', responseStatus: null, responseTimeMs: null },
    ],
  },
  {
    publicId: 'ex_01m4',
    planName: 'Sign in and fetch the current user',
    status: 'passed',
    durationMs: 1400,
    startedLabel: '1h ago',
    steps: [
      { stepName: 'Sign in', status: 'passed', method: 'POST', path: '/auth/login', responseStatus: 200, responseTimeMs: 77 },
      { stepName: 'Fetch me', status: 'passed', method: 'GET', path: '/auth/me', responseStatus: 200, responseTimeMs: 41 },
      { stepName: 'Sign out', status: 'passed', method: 'POST', path: '/auth/logout', responseStatus: 204, responseTimeMs: 38 },
    ],
  },
  {
    publicId: 'ex_01m5',
    planName: 'Customer CRUD round trip',
    status: 'passed',
    durationMs: 5200,
    startedLabel: '2h ago',
    steps: [
      { stepName: 'Sign in', status: 'passed', method: 'POST', path: '/auth/login', responseStatus: 200, responseTimeMs: 80 },
      { stepName: 'Create a customer', status: 'passed', method: 'POST', path: '/customers', responseStatus: 201, responseTimeMs: 128 },
      { stepName: 'Update them', status: 'passed', method: 'PATCH', path: '/customers/:id', responseStatus: 200, responseTimeMs: 117 },
      { stepName: 'List their orders', status: 'passed', method: 'GET', path: '/customers/:id/orders', responseStatus: 200, responseTimeMs: 64 },
      { stepName: 'Delete them', status: 'passed', method: 'DELETE', path: '/customers/:id', responseStatus: 204, responseTimeMs: 92 },
    ],
  },
  {
    publicId: 'ex_01m6',
    planName: 'Subscription lifecycle',
    status: 'failed',
    durationMs: 3600,
    startedLabel: '3h ago',
    steps: [
      { stepName: 'Sign in', status: 'passed', method: 'POST', path: '/auth/login', responseStatus: 200, responseTimeMs: 83 },
      { stepName: 'Start a subscription', status: 'passed', method: 'POST', path: '/subscriptions', responseStatus: 201, responseTimeMs: 164 },
      { stepName: 'Pause it', status: 'passed', method: 'POST', path: '/subscriptions/:id/pause', responseStatus: 200, responseTimeMs: 109 },
      { stepName: 'Cancel it', status: 'failed', method: 'DELETE', path: '/subscriptions/:id', responseStatus: 409, responseTimeMs: 231 },
    ],
  },
];

export const planPassRates = [
  { name: 'Customer CRUD round trip', series: 1, rate: 99, runs: 31, direction: 'up' as const, delta: '+1' },
  { name: 'Sign in and fetch the current user', series: 2, rate: 98, runs: 44, direction: 'flat' as const, delta: '0' },
  { name: 'Create and confirm an order', series: 3, rate: 96, runs: 28, direction: 'up' as const, delta: '+4' },
  { name: 'Charge a checkout with a mocked provider', series: 4, rate: 91, runs: 22, direction: 'down' as const, delta: '−6' },
  { name: 'Refund a paid order', series: 5, rate: 88, runs: 17, direction: 'down' as const, delta: '−2' },
];

export const runStrip = [
  'ppppp', 'pppp', 'ppppp', 'ppppf', 'pppppp', 'ppppp', 'pppp', 'ppppp',
  'pppfs', 'pppppp', 'ppppp', 'pppp', 'ppppp', 'pppppp', 'ppppf', 'ppppp',
  'pppp', 'pppppp', 'ppppp', 'pppfs', 'ppppp', 'pppppp', 'pppp', 'ppppp',
  'ppppp', 'ppppf', 'pppppp', 'ppppp', 'pppp', 'ppppf',
] as const;

export const runStripStats = (() => {
  const cells = runStrip.join('');
  const total = cells.length;
  const failed = [...cells].filter((c) => c === 'f').length;
  const skipped = [...cells].filter((c) => c === 's').length;
  const passed = total - failed - skipped;
  return {
    total,
    passed,
    failed,
    skipped,
    passRate: ((passed / total) * 100).toFixed(1),
  };
})();

export const period = {
  runs: 142,
  runsPrevious: 118,
  passRatePrevious: '91.0',
  medianRun: '3.2s',
  medianRunPrevious: '3.6s',
  endpointsCoveredPrevious: 63,
};

export const rules: TestingRule[] = [
  { publicId: 'tr_1', name: 'Authentication first', category: 'ordering', isActive: true, detail: 'priority 1 — test authentication before other endpoints' },
  { publicId: 'tr_2', name: 'Create before read', category: 'ordering', isActive: true, detail: 'priority 2 — never assert on a list before seeding it' },
  { publicId: 'tr_3', name: 'Cleanup runs last', category: 'ordering', isActive: true, detail: 'priority 9 — deletes go at the end of a plan' },
  { publicId: 'tr_4', name: 'Paystack charge', category: 'mock', isActive: true, detail: 'target paystack — 200, status success, amount 10000' },
  { publicId: 'tr_5', name: 'Paystack verify', category: 'mock', isActive: true, detail: 'target paystack — /transaction/verify returns success' },
  { publicId: 'tr_6', name: 'Stripe webhook', category: 'mock', isActive: true, detail: 'target stripe — signed event, 200' },
  { publicId: 'tr_7', name: 'Outbound mail', category: 'mock', isActive: true, detail: 'target sendgrid — 202, no delivery' },
  { publicId: 'tr_8', name: 'Object storage', category: 'mock', isActive: false, detail: 'target s3 — 200, fake object key' },
  { publicId: 'tr_9', name: 'Response under 2s', category: 'assertion', isActive: true, detail: 'responseTime lt 2000 on every step' },
  { publicId: 'tr_10', name: 'Never a 500', category: 'assertion', isActive: true, detail: 'status notEquals 500 on every step' },
  { publicId: 'tr_11', name: 'JSON content type', category: 'assertion', isActive: true, detail: 'header content-type contains application/json' },
  { publicId: 'tr_12', name: 'No stack traces', category: 'assertion', isActive: true, detail: 'bodyField error notContains goroutine' },
  { publicId: 'tr_13', name: 'Auth header required', category: 'assertion', isActive: true, detail: 'unauthenticated calls assert status equals 401' },
  { publicId: 'tr_14', name: 'Pagination envelope', category: 'assertion', isActive: false, detail: 'bodyField meta.total exists on list endpoints' },
  { publicId: 'tr_15', name: 'Test email', category: 'fixture', isActive: true, detail: 'testEmail — qa+run@gritqa.dev' },
  { publicId: 'tr_16', name: 'Test password', category: 'fixture', isActive: true, detail: 'testPassword — generated per run' },
  { publicId: 'tr_17', name: 'Test amount', category: 'fixture', isActive: true, detail: 'testAmount — 50000 minor units' },
  { publicId: 'tr_18', name: 'Test currency', category: 'fixture', isActive: true, detail: 'testCurrency — NGN' },
];

const COVERAGE_SOURCE: [string, string[]][] = [
  ['routes/auth.go', [
    'POST /auth/login|a', 'POST /auth/register|a', 'POST /auth/refresh|a', 'POST /auth/logout|a',
    'GET /auth/me|a', 'POST /auth/forgot-password|d', 'POST /auth/reset-password|n',
  ]],
  ['routes/checkout.go', [
    'POST /checkout|a', 'GET /checkout/:id|a', 'POST /checkout/:id/pay|f', 'POST /checkout/:id/cancel|a',
    'POST /checkout/:id/tax|f', 'GET /checkout/:id/summary|d', 'POST /checkout/quote|a', 'POST /checkout/validate|a',
  ]],
  ['routes/orders.go', [
    'GET /orders|a', 'POST /orders|a', 'GET /orders/:id|a', 'PATCH /orders/:id|a', 'DELETE /orders/:id|a',
    'POST /orders/:id/confirm|a', 'POST /orders/:id/cancel|a', 'GET /orders/:id/items|a', 'POST /orders/:id/items|d',
  ]],
  ['routes/refunds.go', [
    'POST /refunds|a', 'GET /refunds|a', 'GET /refunds/:id|a', 'POST /refunds/:id/approve|a',
    'POST /refunds/:id/reject|d', 'GET /refunds/:id/receipt|n',
  ]],
  ['routes/customers.go', [
    'GET /customers|a', 'POST /customers|a', 'GET /customers/:id|a', 'PATCH /customers/:id|a',
    'DELETE /customers/:id|a', 'GET /customers/:id/orders|a', 'GET /customers/:id/cards|a',
    'POST /customers/:id/cards|a', 'PUT /customers/:id/cards/:cardId|a', 'POST /customers/import|d',
  ]],
  ['routes/subscriptions.go', [
    'GET /subscriptions|a', 'POST /subscriptions|a', 'GET /subscriptions/:id|a', 'PATCH /subscriptions/:id|a',
    'POST /subscriptions/:id/pause|a', 'POST /subscriptions/:id/resume|d', 'DELETE /subscriptions/:id|f',
  ]],
  ['routes/invoices.go', [
    'GET /invoices|a', 'POST /invoices|a', 'GET /invoices/:id|a', 'POST /invoices/:id/send|a',
    'GET /invoices/:id/pdf|n', 'POST /invoices/:id/void|a', 'GET /invoices/:id/lines|a',
  ]],
  ['routes/payouts.go', [
    'GET /payouts|a', 'POST /payouts|a', 'GET /payouts/:id|a', 'POST /payouts/:id/retry|d',
    'GET /payouts/:id/ledger|n', 'POST /payouts/:id/cancel|a',
  ]],
  ['routes/webhooks.go', [
    'POST /webhooks/paystack|a', 'POST /webhooks/stripe|a', 'POST /webhooks/replay|d', 'GET /webhooks/log|a',
  ]],
  ['routes/products.go', [
    'GET /products|a', 'POST /products|a', 'GET /products/:id|a', 'PATCH /products/:id|a',
    'DELETE /products/:id|a', 'GET /products/:id/prices|a', 'POST /products/:id/prices|a',
    'POST /products/:id/archive|n', 'GET /products/search|a', 'POST /products/bulk|d',
  ]],
  ['routes/reports.go', [
    'GET /reports/revenue|a', 'GET /reports/churn|a', 'GET /reports/mrr|a', 'POST /reports/export|d',
    'GET /reports/failed-payments|a', 'GET /reports/disputes|n',
  ]],
  ['routes/admin.go', [
    'GET /admin/users|a', 'POST /admin/users|a', 'PATCH /admin/users/:id|a', 'GET /admin/audit|a',
    'POST /admin/flags|a', 'GET /admin/flags|a', 'DELETE /admin/flags/:id|f', 'GET /admin/health|a',
  ]],
  ['routes/health.go', ['GET /health|a', 'GET /ready|a', 'GET /version|n']],
];

const STATE = { a: 'approved', d: 'draft', f: 'failing', n: 'none' } as const;

export const coverage: CoverageFile[] = COVERAGE_SOURCE.map(([file, entries]) => ({
  file,
  endpoints: entries.map((entry) => {
    const [signature, key] = entry.split('|');
    const [method, path] = signature.split(' ');
    return {
      method: method as CoverageFile['endpoints'][number]['method'],
      path,
      state: STATE[key as keyof typeof STATE],
    };
  }),
}));

export const coverageTotals = coverage
  .flatMap((f) => f.endpoints)
  .reduce(
    (acc, e) => ({ ...acc, [e.state]: acc[e.state] + 1, total: acc.total + 1 }),
    { approved: 0, draft: 0, failing: 0, none: 0, total: 0 },
  );
