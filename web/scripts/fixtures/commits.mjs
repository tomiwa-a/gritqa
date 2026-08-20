/**
 * The project's git history, which the CLI reads at the same time it reads the index.
 *
 * `test_plans.diff_context` used to be the only record of a commit anywhere, which
 * meant history could only be seen through whichever plans happened to quote it:
 * nothing to browse, and no way to look a commit up by hash. The range picker needs
 * both, so commits are rows.
 *
 * Two of these are the commits the two open drafts were written from, and their diff
 * context is built from the row rather than typed out beside it -- see
 * `diffContextOf`. That is the point of the table: a plan that says it came from
 * `a91f3c2` and a history that says what `a91f3c2` touched cannot disagree.
 *
 * Every path is a file the index knows about, except `go.mod` and `go.sum`, which are
 * not source and are here because plenty of commits touch nothing an endpoint lives
 * in. Which endpoints a change reaches is not knowable from a diff, and nothing here
 * pretends otherwise.
 */
const HOUR = 60;
const DAY = 24 * HOUR;

const TOMIWA = 'Tomiwa';
const ADA = 'Ada';
const MARCUS = 'Marcus';

/**
 * [minutes ago, sha, subject, author, [[path, additions, deletions], ...]]
 *
 * Full shas, because a short hash is a prefix rather than a second fact -- a CHECK on
 * the column says as much. Newest first, which is the order git and the picker agree on.
 */
const HISTORY = [
  [
    10,
    '4c1f8ab3e07d2b95c186a4f0d3e29b7c5a80f612',
    'reports: rate-limit the export endpoints',
    MARCUS,
    [['internal/http/reports.go', 34, 6]],
  ],
  [
    95,
    'b7e3d024a9f18c635e0d7b42a86c19f350d7e2b4',
    'customers: index by email as well as id',
    ADA,
    [
      ['internal/store/customers.go', 52, 14],
      ['internal/http/customers.go', 11, 3],
    ],
  ],
  [
    3 * HOUR,
    'a91f3c2d84b06e5a71c93f2b0d8e64a7c105b39f',
    'tax: split VAT by product band',
    TOMIWA,
    [
      ['internal/tax/rate.go', 71, 9],
      ['internal/tax/band.go', 43, 7],
      ['internal/http/checkout.go', 34, 6],
    ],
  ],
  [
    8 * HOUR,
    '5d9c470b3a8e12f65d074c9b0a3f28e6b14d75c0',
    'token: rotate signing keys on the hour',
    MARCUS,
    [
      ['internal/token/sign.go', 48, 22],
      ['internal/http/auth.go', 9, 4],
    ],
  ],
  [
    26 * HOUR,
    '7d2e04b1f95a3c806e2d47b0a9f31c58d64e0b27',
    'refunds: only unshipped lines are refundable',
    TOMIWA,
    [
      ['internal/store/refunds.go', 96, 41],
      ['internal/http/refunds.go', 52, 18],
    ],
  ],
  [
    30 * HOUR,
    '2f8b615c0d97a34e8b52f16d0c4a78e93b05d2f1',
    'subscriptions: 409 on a cancellation that already happened',
    ADA,
    [['internal/http/subscriptions.go', 23, 7]],
  ],
  [
    2 * DAY,
    '9a4e7c31b8f0d652a07e4c98b3d16f28e5a0c47b',
    'payouts: put scheduling behind a flag',
    ADA,
    [['internal/http/payouts.go', 52, 31]],
  ],
  [
    3 * DAY,
    'e6c0d8175b29a4f30c86e1d54b07a9f2c38e6b01',
    'invoices: stream the PDF instead of buffering it',
    TOMIWA,
    [['internal/http/invoices.go', 38, 52]],
  ],
  [
    4 * DAY,
    '1b5f9a26e08c47d31a95b0f2c6d84e70a3b19f5c',
    'webhooks: verify the signature before parsing the body',
    MARCUS,
    [
      ['internal/http/webhooks.go', 71, 14],
      ['internal/token/sign.go', 29, 3],
    ],
  ],
  [
    5 * DAY,
    '8e3d0472c15b9a68d03f7e2c41a05b96d8c72e34',
    'products: cache lookups on the read path',
    MARCUS,
    [['internal/http/products.go', 47, 11]],
  ],
  [
    6 * DAY,
    '30af62c9e1d75b08a4c36f0b29e5d7a14c80f6b3',
    'checkout: require an idempotency key on charge',
    TOMIWA,
    [
      ['internal/http/checkout.go', 33, 8],
      ['internal/store/orders.go', 58, 12],
    ],
  ],
  [
    9 * DAY,
    '6b1c94e30a87f2d5c04b6e19a3d02f78b5c1e6a4',
    'admin: split off the public router',
    TOMIWA,
    [
      ['internal/http/admin.go', 112, 48],
      ['internal/http/health.go', 6, 2],
    ],
  ],
  [
    11 * DAY,
    'c05a7f31b6d84e0293a5c7f18b0d46e2a97c3b50',
    'go: bump to 1.23',
    MARCUS,
    [
      ['go.mod', 3, 3],
      ['go.sum', 64, 58],
    ],
  ],
];

export const COMMITS = HISTORY.map(([agoMinutes, sha, subject, author, files]) => ({
  agoMinutes,
  sha,
  subject,
  author,
  branch: 'main',
  files: files.map(([path, additions, deletions]) => ({ path, additions, deletions })),
}));

/**
 * A commit as a plan's `diff_context`.
 *
 * A single-commit range, which is what a push-triggered draft is. The totals are
 * summed here rather than declared, for the same reason the column is: two numbers
 * that have to be kept equal to a list are one number too many.
 */
export function diffContextOf(shortSha) {
  const commit = COMMITS.find((c) => c.sha.startsWith(shortSha));
  if (!commit) throw new Error(`no commit in the fixture starts with ${shortSha}`);
  return {
    branch: commit.branch,
    commit: shortSha,
    message: commit.subject,
    additions: commit.files.reduce((sum, f) => sum + f.additions, 0),
    deletions: commit.files.reduce((sum, f) => sum + f.deletions, 0),
    files: commit.files,
    commitCount: 1,
  };
}
