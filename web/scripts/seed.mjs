/**
 * Local fixture data: one developer, the projects the dashboard was designed
 * against, and a small index for the first of them.
 *
 * Everything here is fixture, not truth. The `codebase_index` rows in particular
 * are a stand-in for what `gritqa` will push once the CLI indexes for real, and
 * they exist so the overview's file and endpoint counts have something to count
 * rather than reading zero. The CLI overwrites them by `(project_id, file_path)`.
 *
 * Idempotent: re-running updates in place rather than duplicating, so it is safe
 * to run after every migration.
 *
 *   node scripts/seed.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';

process.loadEnvFile?.(join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local'));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local.');
  process.exit(1);
}

const DEVELOPER = {
  email: process.env.SEED_EMAIL ?? 'dev@gritqa.local',
  name: 'Tomiwa',
  provider: 'github',
  providerId: 'seed-developer',
};

/**
 * `lastIndexedAt` is null for everything but the first project, and that is the
 * point rather than an omission: a project with no index rows has never been
 * indexed, and claiming a date for it would be the kind of small lie this
 * rebuild is trying to remove.
 */
const PROJECTS = [
  { name: 'payments-api', localPath: '~/code/payments-api', branch: 'main', status: 'active', indexed: true },
  { name: 'auth-service', localPath: '~/code/auth-service', branch: 'main', status: 'active', indexed: false },
  { name: 'orders-api', localPath: '~/code/orders-api', branch: 'main', status: 'active', indexed: false },
  { name: 'notifications', localPath: '~/code/notifications', branch: 'develop', status: 'active', indexed: false },
  { name: 'web-bff', localPath: '~/code/web-bff', branch: 'main', status: 'active', indexed: false },
  { name: 'admin-api', localPath: '~/code/admin-api', branch: 'main', status: 'archived', indexed: false },
];

/** Shaped like what a tree-sitter pass over a Go API would produce. */
const INDEX = [
  {
    filePath: 'internal/http/checkout.go',
    language: 'go',
    symbols: ['QuoteHandler', 'CheckoutHandler', 'TaxHandler'],
    dependencies: ['internal/tax/rate.go', 'internal/store/orders.go'],
    endpoints: [
      { method: 'POST', path: '/checkout/quote' },
      { method: 'POST', path: '/checkout' },
      { method: 'POST', path: '/checkout/:id/tax' },
    ],
  },
  {
    filePath: 'internal/http/orders.go',
    language: 'go',
    symbols: ['ListOrders', 'GetOrder', 'CancelOrder'],
    dependencies: ['internal/store/orders.go'],
    endpoints: [
      { method: 'GET', path: '/orders' },
      { method: 'GET', path: '/orders/:id' },
      { method: 'POST', path: '/orders/:id/cancel' },
    ],
  },
  {
    filePath: 'internal/http/auth.go',
    language: 'go',
    symbols: ['Login', 'Refresh', 'Revoke'],
    dependencies: ['internal/token/sign.go'],
    endpoints: [
      { method: 'POST', path: '/auth/login' },
      { method: 'POST', path: '/auth/refresh' },
      { method: 'POST', path: '/auth/revoke' },
    ],
  },
  {
    filePath: 'internal/http/refunds.go',
    language: 'go',
    symbols: ['CreateRefund', 'GetRefund'],
    dependencies: ['internal/store/refunds.go', 'internal/tax/rate.go'],
    endpoints: [
      { method: 'POST', path: '/refunds' },
      { method: 'GET', path: '/refunds/:id' },
    ],
  },
  {
    filePath: 'internal/tax/rate.go',
    language: 'go',
    symbols: ['RateFor', 'Jurisdiction', 'applyCompound'],
    dependencies: [],
    endpoints: [],
  },
  {
    filePath: 'internal/store/orders.go',
    language: 'go',
    symbols: ['Insert', 'ByID', 'Cancel'],
    dependencies: [],
    endpoints: [],
  },
];

const sql = postgres(url, { max: 1, onnotice: () => {} });

/** Stable stand-in for a content hash, so re-seeding does not churn the column. */
function fakeHash(seed) {
  let h = 0n;
  for (const ch of seed) h = (h * 131n + BigInt(ch.codePointAt(0))) % (2n ** 64n);
  return h.toString(16).padStart(16, '0').repeat(4);
}

try {
  const [user] = await sql`
    INSERT INTO users (email, name, provider, provider_id)
    VALUES (${DEVELOPER.email}, ${DEVELOPER.name}, ${DEVELOPER.provider}, ${DEVELOPER.providerId})
    ON CONFLICT (provider, provider_id)
      DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
    RETURNING id, public_id, email
  `;
  console.log(`developer ${user.email} (${user.public_id})`);

  let first = null;
  for (const project of PROJECTS) {
    const [row] = await sql`
      INSERT INTO projects (user_id, name, local_path, default_branch, status, last_indexed_at)
      VALUES (
        ${user.id}, ${project.name}, ${project.localPath}, ${project.branch},
        ${project.status}, ${project.indexed ? sql`now()` : null}
      )
      ON CONFLICT (user_id, local_path)
        DO UPDATE SET name = EXCLUDED.name,
                      default_branch = EXCLUDED.default_branch,
                      status = EXCLUDED.status
      RETURNING id, name, public_id
    `;
    if (project.indexed) first ??= row;
  }
  console.log(`${PROJECTS.length} projects`);

  if (first) {
    for (const file of INDEX) {
      await sql`
        INSERT INTO codebase_index
          (project_id, file_path, file_hash, language, symbols, dependencies, endpoints, last_indexed_at)
        VALUES (
          ${first.id}, ${file.filePath}, ${fakeHash(file.filePath)}, ${file.language},
          ${sql.json(file.symbols)}, ${sql.json(file.dependencies)}, ${sql.json(file.endpoints)}, now()
        )
        ON CONFLICT (project_id, file_path)
          DO UPDATE SET symbols = EXCLUDED.symbols,
                        dependencies = EXCLUDED.dependencies,
                        endpoints = EXCLUDED.endpoints,
                        last_indexed_at = now()
      `;
    }
    const endpoints = INDEX.reduce((n, f) => n + f.endpoints.length, 0);
    console.log(`${INDEX.length} indexed files, ${endpoints} endpoints on ${first.name}`);
  }

  console.log('Seeded. Sign in at http://localhost:3000/api/auth/dev');
} finally {
  await sql.end();
}
