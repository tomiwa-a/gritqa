import type {
  AuditEntry,
  CoverageFile,
  CoverageState,
  ExecutionStatus,
  PlanDiffContext,
  Project,
  RunHistoryEntry,
  StepStatus,
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
  aiKeyMasked: 'sk-••••••••••••4f2a',
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
    covers: [
      { method: 'POST', path: '/checkout/quote' },
      { method: 'POST', path: '/checkout' },
      { method: 'POST', path: '/checkout/:id/tax' },
      { method: 'GET', path: '/checkout/:id' },
    ],
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
    covers: [
      { method: 'POST', path: '/orders' },
      { method: 'POST', path: '/refunds' },
      { method: 'GET', path: '/refunds/:id' },
    ],
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
    covers: [
      { method: 'POST', path: '/subscriptions' },
      { method: 'POST', path: '/subscriptions/:id/pause' },
      { method: 'POST', path: '/subscriptions/:id/resume' },
    ],
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
    covers: [
      { method: 'POST', path: '/auth/register' },
      { method: 'GET', path: '/auth/me' },
    ],
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
    covers: [
      { method: 'POST', path: '/payouts' },
      { method: 'POST', path: '/payouts/:id/retry' },
      { method: 'GET', path: '/payouts/:id' },
    ],
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
    covers: [
      { method: 'POST', path: '/webhooks/paystack' },
      { method: 'GET', path: '/webhooks/log' },
    ],
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
    covers: [
      { method: 'POST', path: '/customers/:id/cards' },
      { method: 'PUT', path: '/customers/:id/cards/:cardId' },
      { method: 'GET', path: '/customers/:id/cards' },
    ],
    lastRun: null,
  },
];

/** Plans that have been through the gate — the library the queue feeds. */
export const settledPlans: TestPlan[] = [
  {
    publicId: 'tp_01j1',
    name: 'Customer CRUD round trip',
    description: 'Create a customer, edit them, read their orders, remove them.',
    status: 'approved',
    version: 2,
    triggerSource: 'git_push',
    createdLabel: '3w ago',
    stepCount: 5,
    assertionCount: 14,
    covers: [
      { method: 'POST', path: '/customers' },
      { method: 'PATCH', path: '/customers/:id' },
      { method: 'GET', path: '/customers/:id/orders' },
      { method: 'DELETE', path: '/customers/:id' },
    ],
    lastRun: { status: 'passed', passed: 5, total: 5, label: '2h ago' },
  },
  {
    publicId: 'tp_01j2',
    name: 'Sign in and fetch the current user',
    description: 'The shortest path through auth, run before everything else.',
    status: 'approved',
    version: 1,
    triggerSource: 'manual',
    createdLabel: '2mo ago',
    stepCount: 3,
    assertionCount: 8,
    covers: [
      { method: 'POST', path: '/auth/login' },
      { method: 'GET', path: '/auth/me' },
      { method: 'POST', path: '/auth/logout' },
    ],
    lastRun: { status: 'passed', passed: 3, total: 3, label: '1h ago' },
  },
  {
    publicId: 'tp_01j3',
    name: 'Create and confirm an order',
    description: 'Open an order, add a line, confirm it, check the total.',
    status: 'approved',
    version: 3,
    triggerSource: 'git_push',
    createdLabel: '5w ago',
    stepCount: 4,
    assertionCount: 11,
    covers: [
      { method: 'POST', path: '/orders' },
      { method: 'POST', path: '/orders/:id/items' },
      { method: 'POST', path: '/orders/:id/confirm' },
    ],
    lastRun: { status: 'passed', passed: 4, total: 4, label: '26m ago' },
  },
  {
    publicId: 'tp_01j4',
    name: 'Charge a checkout with a mocked provider',
    description: 'Pay a checkout against the provider mock and read the receipt.',
    status: 'approved',
    version: 4,
    triggerSource: 'git_push',
    createdLabel: '6w ago',
    stepCount: 5,
    assertionCount: 13,
    covers: [
      { method: 'POST', path: '/checkout' },
      { method: 'POST', path: '/checkout/:id/tax' },
      { method: 'POST', path: '/checkout/:id/pay' },
    ],
    lastRun: { status: 'failed', passed: 3, total: 5, label: '12m ago' },
  },
  {
    publicId: 'tp_01j5',
    name: 'Refund a paid order',
    description: 'Refund in full and confirm the ledger balances.',
    status: 'approved',
    version: 2,
    triggerSource: 'manual',
    createdLabel: '7w ago',
    stepCount: 4,
    assertionCount: 10,
    covers: [
      { method: 'POST', path: '/refunds' },
      { method: 'GET', path: '/refunds/:id' },
    ],
    lastRun: { status: 'running', passed: 2, total: 4, label: 'Just now' },
  },
  {
    publicId: 'tp_01j6',
    name: 'Subscription lifecycle',
    description: 'Start, pause, and cancel a subscription in one pass.',
    status: 'approved',
    version: 2,
    triggerSource: 'git_push',
    createdLabel: '2mo ago',
    stepCount: 4,
    assertionCount: 9,
    covers: [
      { method: 'POST', path: '/subscriptions' },
      { method: 'POST', path: '/subscriptions/:id/pause' },
      { method: 'DELETE', path: '/subscriptions/:id' },
    ],
    lastRun: { status: 'failed', passed: 3, total: 4, label: '3h ago' },
  },
  {
    publicId: 'tp_01j7',
    name: 'Invoice PDF export',
    description: 'Send an invoice and download the rendered PDF.',
    status: 'archived',
    version: 1,
    triggerSource: 'manual',
    createdLabel: '4mo ago',
    stepCount: 3,
    assertionCount: 6,
    covers: [
      { method: 'POST', path: '/invoices/:id/send' },
      { method: 'GET', path: '/invoices/:id/pdf' },
    ],
    lastRun: null,
  },
  {
    publicId: 'tp_01j8',
    name: 'Admin flag toggle',
    description: 'Turn a feature flag on and off as an admin.',
    status: 'archived',
    version: 2,
    triggerSource: 'manual',
    createdLabel: '4mo ago',
    stepCount: 4,
    assertionCount: 8,
    covers: [
      { method: 'POST', path: '/admin/flags' },
      { method: 'DELETE', path: '/admin/flags/:id' },
    ],
    lastRun: { status: 'failed', passed: 2, total: 4, label: '3mo ago' },
  },
];

export const allPlans: TestPlan[] = [...plansAwaitingReview, ...settledPlans];

export const recentRuns: TestExecution[] = [
  {
    publicId: 'ex_01m1',
    planPublicId: 'tp_01j4',
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
    planPublicId: 'tp_01j3',
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
    planPublicId: 'tp_01j5',
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
    planPublicId: 'tp_01j2',
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
    planPublicId: 'tp_01j1',
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
    planPublicId: 'tp_01j6',
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
  { planPublicId: 'tp_01j1', name: 'Customer CRUD round trip', series: 1, rate: 99, runs: 31, direction: 'up' as const, delta: '+1' },
  { planPublicId: 'tp_01j2', name: 'Sign in and fetch the current user', series: 2, rate: 98, runs: 44, direction: 'flat' as const, delta: '0' },
  { planPublicId: 'tp_01j3', name: 'Create and confirm an order', series: 3, rate: 96, runs: 28, direction: 'up' as const, delta: '+4' },
  { planPublicId: 'tp_01j4', name: 'Charge a checkout with a mocked provider', series: 4, rate: 91, runs: 22, direction: 'down' as const, delta: '−6' },
  { planPublicId: 'tp_01j5', name: 'Refund a paid order', series: 5, rate: 88, runs: 17, direction: 'down' as const, delta: '−2' },
];

/** The 24 runs older than the ones with a full report, oldest first. */
const OLDER_CELLS = [
  'ppppp', 'pppp', 'ppppp', 'ppppf', 'pppppp', 'ppppp', 'pppp', 'ppppp',
  'pppfs', 'pppppp', 'ppppp', 'pppp', 'ppppp', 'pppppp', 'ppppf', 'ppppp',
  'pppp', 'pppppp', 'ppppp', 'pppfs', 'ppppp', 'pppppp', 'pppp', 'ppppp',
];

const RUN_PLANS = ['tp_01j1', 'tp_01j2', 'tp_01j3', 'tp_01j4', 'tp_01j5', 'tp_01j6'];

const CELL: Record<StepStatus, string> = {
  passed: 'p',
  failed: 'f',
  skipped: 's',
  pending: 's',
  error: 'f',
};

const planName = (id: string) => allPlans.find((p) => p.publicId === id)?.name ?? id;

export const runHistory: RunHistoryEntry[] = [
  ...OLDER_CELLS.map((cells, i) => {
    const planPublicId = RUN_PLANS[i % RUN_PLANS.length];
    return {
      publicId: `ex_01l${String(i + 1).padStart(2, '0')}`,
      planPublicId,
      planName: planName(planPublicId),
      status: (cells.includes('f') ? 'failed' : 'passed') as ExecutionStatus,
      cells,
      whenLabel: `${29 - i}d ago`,
    };
  }),
  ...[...recentRuns].reverse().map((run) => ({
    publicId: run.publicId,
    planPublicId: run.planPublicId,
    planName: run.planName,
    status: run.status,
    cells: run.steps.map((s) => CELL[s.status]).join(''),
    whenLabel: run.startedLabel,
  })),
];

export const runStripStats = (() => {
  const cells = runHistory.map((r) => r.cells).join('');
  const total = cells.length;
  const failed = [...cells].filter((c) => c === 'f').length;
  const skipped = [...cells].filter((c) => c === 's').length;
  const passed = total - failed - skipped;
  return {
    total,
    runs: runHistory.length,
    passed,
    failed,
    skipped,
    passRate: ((passed / total) * 100).toFixed(1),
  };
})();

/**
 * What the CLI has read but nothing has been drafted for yet — the same shape as
 * the diff_context a generated plan carries.
 */
export const pendingChanges: PlanDiffContext | null = {
  branch: 'main',
  commit: '7d41c9a',
  message: 'Split checkout tax out of the quote endpoint',
  additions: 214,
  deletions: 61,
  files: [
    { path: 'routes/checkout.go', additions: 96, deletions: 24 },
    { path: 'routes/refunds.go', additions: 71, deletions: 18 },
    { path: 'routes/invoices.go', additions: 47, deletions: 19 },
  ],
};

export const period = {
  runs: 142,
  runsPrevious: 118,
  passRatePrevious: '91.0',
  medianRun: '3.2s',
  medianRunPrevious: '3.6s',
  endpointsCoveredPrevious: 12,
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

/* Everything the CLI found in the repo. Coverage is not authored here — a
   square's colour is worked out below from the plans and runs that exist, so
   clicking one always lands on something that agrees with it. */
const COVERAGE_SOURCE: [string, string[]][] = [
  ['routes/auth.go', [
    'POST /auth/login', 'POST /auth/register', 'POST /auth/refresh', 'POST /auth/logout',
    'GET /auth/me', 'POST /auth/forgot-password', 'POST /auth/reset-password',
  ]],
  ['routes/checkout.go', [
    'POST /checkout', 'GET /checkout/:id', 'POST /checkout/:id/pay', 'POST /checkout/:id/cancel',
    'POST /checkout/:id/tax', 'GET /checkout/:id/summary', 'POST /checkout/quote', 'POST /checkout/validate',
  ]],
  ['routes/orders.go', [
    'GET /orders', 'POST /orders', 'GET /orders/:id', 'PATCH /orders/:id', 'DELETE /orders/:id',
    'POST /orders/:id/confirm', 'POST /orders/:id/cancel', 'GET /orders/:id/items', 'POST /orders/:id/items',
  ]],
  ['routes/refunds.go', [
    'POST /refunds', 'GET /refunds', 'GET /refunds/:id', 'POST /refunds/:id/approve',
    'POST /refunds/:id/reject', 'GET /refunds/:id/receipt',
  ]],
  ['routes/customers.go', [
    'GET /customers', 'POST /customers', 'GET /customers/:id', 'PATCH /customers/:id',
    'DELETE /customers/:id', 'GET /customers/:id/orders', 'GET /customers/:id/cards',
    'POST /customers/:id/cards', 'PUT /customers/:id/cards/:cardId', 'POST /customers/import',
  ]],
  ['routes/subscriptions.go', [
    'GET /subscriptions', 'POST /subscriptions', 'GET /subscriptions/:id', 'PATCH /subscriptions/:id',
    'POST /subscriptions/:id/pause', 'POST /subscriptions/:id/resume', 'DELETE /subscriptions/:id',
  ]],
  ['routes/invoices.go', [
    'GET /invoices', 'POST /invoices', 'GET /invoices/:id', 'POST /invoices/:id/send',
    'GET /invoices/:id/pdf', 'POST /invoices/:id/void', 'GET /invoices/:id/lines',
  ]],
  ['routes/payouts.go', [
    'GET /payouts', 'POST /payouts', 'GET /payouts/:id', 'POST /payouts/:id/retry',
    'GET /payouts/:id/ledger', 'POST /payouts/:id/cancel',
  ]],
  ['routes/webhooks.go', [
    'POST /webhooks/paystack', 'POST /webhooks/stripe', 'POST /webhooks/replay', 'GET /webhooks/log',
  ]],
  ['routes/products.go', [
    'GET /products', 'POST /products', 'GET /products/:id', 'PATCH /products/:id',
    'DELETE /products/:id', 'GET /products/:id/prices', 'POST /products/:id/prices',
    'POST /products/:id/archive', 'GET /products/search', 'POST /products/bulk',
  ]],
  ['routes/reports.go', [
    'GET /reports/revenue', 'GET /reports/churn', 'GET /reports/mrr', 'POST /reports/export',
    'GET /reports/failed-payments', 'GET /reports/disputes',
  ]],
  ['routes/admin.go', [
    'GET /admin/users', 'POST /admin/users', 'PATCH /admin/users/:id', 'GET /admin/audit',
    'POST /admin/flags', 'GET /admin/flags', 'DELETE /admin/flags/:id', 'GET /admin/health',
  ]],
  ['routes/health.go', ['GET /health', 'GET /ready', 'GET /version']],
];

const brokenEndpoints = new Set(
  recentRuns.flatMap((run) =>
    run.steps
      .filter((s) => s.status === 'failed' || s.status === 'error')
      .map((s) => `${s.method} ${s.path}`),
  ),
);

const endpointsOf = (status: TestPlan['status']) =>
  new Set(
    allPlans
      .filter((p) => p.status === status)
      .flatMap((p) => p.covers.map((c) => `${c.method} ${c.path}`)),
  );

const approvedEndpoints = endpointsOf('approved');
const draftEndpoints = endpointsOf('draft');

/* A broken run outranks everything, then an approved plan, then a draft. An
   endpoint only archived plans touch counts as uncovered, because archived
   plans never run. */
function coverageState(signature: string): CoverageState {
  if (brokenEndpoints.has(signature)) return 'failing';
  if (approvedEndpoints.has(signature)) return 'approved';
  if (draftEndpoints.has(signature)) return 'draft';
  return 'none';
}

export const coverage: CoverageFile[] = COVERAGE_SOURCE.map(([file, entries]) => ({
  file,
  endpoints: entries.map((signature) => {
    const [method, path] = signature.split(' ');
    return {
      method: method as CoverageFile['endpoints'][number]['method'],
      path,
      state: coverageState(signature),
    };
  }),
}));

export const coverageTotals = coverage
  .flatMap((f) => f.endpoints)
  .reduce(
    (acc, e) => ({ ...acc, [e.state]: acc[e.state] + 1, total: acc.total + 1 }),
    { approved: 0, draft: 0, failing: 0, none: 0, total: 0 },
  );

export const auditLog: AuditEntry[] = [
  { id: 8421, action: 'project.indexed', label: 'payments-api re-read after a push to main', tone: 'project', whenLabel: '4m ago', ip: '102.89.34.7' },
  { id: 8420, action: 'test_execution.completed', label: 'Charge a checkout with a mocked provider failed on step 4', tone: 'run', whenLabel: '12m ago', ip: '102.89.34.7' },
  { id: 8419, action: 'test_plan.created', label: 'Checkout applies the right tax rate drafted from a push', tone: 'plan', whenLabel: '2h ago', ip: '102.89.34.7' },
  { id: 8418, action: 'test_plan.approved', label: 'Webhook replay is idempotent approved by you', tone: 'plan', whenLabel: '3h ago', ip: '102.89.34.7' },
  { id: 8417, action: 'testing_rule.updated', label: 'Pagination envelope turned off', tone: 'rule', whenLabel: 'Yesterday', ip: '102.89.34.7' },
  { id: 8416, action: 'mock_endpoint.created', label: 'Stripe webhook mock added', tone: 'rule', whenLabel: 'Yesterday', ip: '102.89.34.7' },
  { id: 8415, action: 'user.ai_key.updated', label: 'AI key replaced', tone: 'account', whenLabel: '3d ago', ip: '102.89.34.7' },
  { id: 8414, action: 'project.created', label: 'notifications added from the CLI', tone: 'project', whenLabel: '5d ago', ip: '41.58.120.19' },
  { id: 8413, action: 'user.login', label: 'Signed in with GitHub', tone: 'account', whenLabel: '5d ago', ip: '41.58.120.19' },
];
