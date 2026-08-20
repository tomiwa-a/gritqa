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
import { PLANS, BASE_URL, revisionsFor } from './fixtures/plans.mjs';
import { executions, resolveUrl, patternOf } from './fixtures/runs.mjs';

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
  {
    name: 'payments-api',
    localPath: '~/code/payments-api',
    branch: 'main',
    status: 'active',
    indexed: true,
  },
  {
    name: 'auth-service',
    localPath: '~/code/auth-service',
    branch: 'main',
    status: 'active',
    indexed: false,
  },
  {
    name: 'orders-api',
    localPath: '~/code/orders-api',
    branch: 'main',
    status: 'active',
    indexed: false,
  },
  {
    name: 'notifications',
    localPath: '~/code/notifications',
    branch: 'develop',
    status: 'active',
    indexed: false,
  },
  {
    name: 'web-bff',
    localPath: '~/code/web-bff',
    branch: 'main',
    status: 'active',
    indexed: false,
  },
  {
    name: 'admin-api',
    localPath: '~/code/admin-api',
    branch: 'main',
    status: 'archived',
    indexed: false,
  },
];

/**
 * The rules the dashboard was designed against, on the first project.
 *
 * `rule_config` carries the whole line as `description`, which is what the editor
 * writes today. The structured per-category form -- `{ priority: 1, description }`
 * for an ordering rule -- renders identically through `ruleDetail`, so these can be
 * split later without any screen changing.
 */
const RULES = [
  [
    'Authentication first',
    'ordering',
    true,
    'priority 1 -- test authentication before other endpoints',
  ],
  [
    'Create before read',
    'ordering',
    true,
    'priority 2 -- never assert on a list before seeding it',
  ],
  ['Cleanup runs last', 'ordering', true, 'priority 9 -- deletes go at the end of a plan'],
  ['Paystack charge', 'mock', true, 'target paystack -- 200, status success, amount 10000'],
  ['Paystack verify', 'mock', true, 'target paystack -- /transaction/verify returns success'],
  ['Stripe webhook', 'mock', true, 'target stripe -- signed event, 200'],
  ['Outbound mail', 'mock', true, 'target sendgrid -- 202, no delivery'],
  ['Object storage', 'mock', false, 'target s3 -- 200, fake object key'],
  ['Response under 2s', 'assertion', true, 'responseTime lt 2000 on every step'],
  ['Never a 500', 'assertion', true, 'status notEquals 500 on every step'],
  ['JSON content type', 'assertion', true, 'header content-type contains application/json'],
  ['No stack traces', 'assertion', true, 'bodyField error notContains goroutine'],
  ['Auth header required', 'assertion', true, 'unauthenticated calls assert status equals 401'],
  ['Pagination envelope', 'assertion', false, 'bodyField meta.total exists on list endpoints'],
  ['Test email', 'fixture', true, 'testEmail -- qa+run@gritqa.dev'],
  ['Test password', 'fixture', true, 'testPassword -- generated per run'],
  ['Test amount', 'fixture', true, 'testAmount -- 50000 minor units'],
  ['Test currency', 'fixture', true, 'testCurrency -- NGN'],
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
  for (const ch of seed) h = (h * 131n + BigInt(ch.codePointAt(0))) % 2n ** 64n;
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

    // Matched on name rather than upserted, because there is no unique index on
    // (project_id, name) -- two rules may legitimately share one. That keeps
    // `public_id` stable across re-seeds, so a bookmarked ?open=rule:<id> survives.
    for (const [name, category, isActive, description] of RULES) {
      const detail = description.replaceAll(' -- ', ' \u2014 ');
      const [existing] = await sql`
        SELECT id FROM testing_rules WHERE project_id = ${first.id} AND name = ${name} LIMIT 1
      `;
      if (existing) {
        await sql`
          UPDATE testing_rules
          SET category = ${category}, is_active = ${isActive},
              rule_config = ${sql.json({ description: detail })}
          WHERE id = ${existing.id}
        `;
      } else {
        await sql`
          INSERT INTO testing_rules (project_id, name, category, is_active, rule_config)
          VALUES (${first.id}, ${name}, ${category}, ${isActive},
                  ${sql.json({ description: detail })})
        `;
      }
    }
    console.log(`${RULES.length} rules on ${first.name}`);

    // Plans, matched on name for the same reason rules are: it keeps `public_id`
    // stable across re-seeds, so a bookmarked ?open=plan:<id> survives one.
    //
    // `created_at` is the oldest revision and `updated_at` the newest, which is
    // what those columns mean -- the row appeared when v1 was drafted and changed
    // when v2 was. The plan lists read the latter, because what a reviewer wants
    // to know about a queue is when each thing last moved.
    const planIds = new Map();
    for (const plan of PLANS) {
      const revisions = revisionsFor(plan);
      const oldest = Math.max(...revisions.map((r) => r.agoMinutes));
      const planJson = {
        variables: plan.variables ?? {},
        covers: plan.covers,
        steps: plan.steps,
      };

      const [existing] = await sql`
        SELECT id FROM test_plans WHERE project_id = ${first.id} AND name = ${plan.name} LIMIT 1
      `;
      let planId;
      if (existing) {
        await sql`
          UPDATE test_plans
          SET description = ${plan.description}, base_url = ${BASE_URL},
              plan_json = ${sql.json(planJson)}, status = ${plan.status},
              version = ${plan.version}, trigger_source = ${plan.trigger},
              diff_context = ${plan.diffContext ? sql.json(plan.diffContext) : null},
              created_at = now() - make_interval(mins => ${oldest}),
              updated_at = now() - make_interval(mins => ${plan.createdAgo})
          WHERE id = ${existing.id}
        `;
        planId = existing.id;
      } else {
        const [row] = await sql`
          INSERT INTO test_plans
            (project_id, name, description, base_url, plan_json, status, version,
             trigger_source, diff_context, created_at, updated_at)
          VALUES (
            ${first.id}, ${plan.name}, ${plan.description}, ${BASE_URL},
            ${sql.json(planJson)}, ${plan.status}, ${plan.version}, ${plan.trigger},
            ${plan.diffContext ? sql.json(plan.diffContext) : null},
            now() - make_interval(mins => ${oldest}),
            now() - make_interval(mins => ${plan.createdAgo})
          )
          RETURNING id
        `;
        planId = row.id;
      }
      planIds.set(plan.key, planId);

      for (const revision of revisions) {
        // A human revision has to carry the instruction that caused it -- the
        // table refuses one without. An agent's own turn has no instruction to
        // record, and null is the truthful column value rather than a placeholder.
        await sql`
          INSERT INTO plan_revisions
            (test_plan_id, version, author, instruction, summary, changes, created_by, created_at)
          VALUES (
            ${planId}, ${revision.version}, ${revision.author},
            ${revision.instruction ?? null}, ${revision.summary},
            ${sql.json(revision.changes ?? [])},
            ${revision.author === 'human' ? user.id : null},
            now() - make_interval(mins => ${revision.agoMinutes})
          )
          ON CONFLICT (test_plan_id, version)
            DO UPDATE SET author = EXCLUDED.author,
                          instruction = EXCLUDED.instruction,
                          summary = EXCLUDED.summary,
                          changes = EXCLUDED.changes,
                          created_at = EXCLUDED.created_at
        `;
      }
    }
    const revisionCount = PLANS.reduce((n, plan) => n + revisionsFor(plan).length, 0);
    console.log(`${PLANS.length} plans, ${revisionCount} revisions on ${first.name}`);

    // Runs are replaced wholesale rather than matched, because an execution has no
    // natural key -- two runs of one plan differ only by when they happened. That
    // means a re-seed mints new run ids and a bookmarked ?open=run:<id> does not
    // survive it. Only the fixture behaves this way: real executions are written
    // once, by the CLI, and never rewritten.
    await sql`DELETE FROM test_executions WHERE project_id = ${first.id}`;

    const runs = executions();
    let resultCount = 0;
    for (const run of runs) {
      const planId = planIds.get(run.plan.key);
      const settled = run.status === 'passed' || run.status === 'failed';
      const [execution] = await sql`
        INSERT INTO test_executions
          (test_plan_id, project_id, status, plan_version, started_at, completed_at,
           duration_ms, created_at)
        VALUES (
          ${planId}, ${first.id}, ${run.status}, ${run.planVersion},
          now() - make_interval(mins => ${run.startedAgo}),
          ${settled ? sql`now() - make_interval(mins => ${run.startedAgo}) + make_interval(secs => ${(run.durationMs ?? 0) / 1000})` : null},
          ${settled ? run.durationMs : null},
          now() - make_interval(mins => ${run.startedAgo})
        )
        RETURNING id
      `;

      for (const [index, [status, responseStatus, responseTimeMs]] of run.steps.entries()) {
        const step = run.plan.steps[index];
        const reached = status !== 'skipped' && status !== 'pending';
        const failed = status === 'failed';

        // Only a failed step gets its assertions written out. A passing step's
        // results are all "expected, and got it", which is what `passed` already
        // says; inventing an observed value per assertion would be filling the
        // column with narration rather than data.
        const assertions = failed
          ? [
              {
                target: run.failure?.expected?.split(' ')[0] ?? 'status',
                expected:
                  run.failure?.expected ?? `status equals ${step.assertions[0]?.expected ?? 200}`,
                actual: run.failure?.actual ?? String(responseStatus),
                passed: false,
              },
            ]
          : null;

        await sql`
          INSERT INTO test_results
            (execution_id, step_id, step_name, status, request_method, route_pattern,
             request_url, request_body, response_status, response_time_ms,
             assertion_results, error_message, verdict, verdict_at, verdict_by,
             created_at)
          VALUES (
            ${execution.id}, ${step.id}, ${step.name}, ${status},
            -- The method and the endpoint come from the plan, so they are known for
            -- a step that never ran: a skipped step is still "the POST we did not
            -- get to". The substituted URL is not -- resolving it needs variables
            -- an aborted run never extracted -- so that one stays null.
            ${step.request.method},
            ${patternOf(step.request.url, step.request.method, run.plan.covers)},
            ${reached ? BASE_URL + resolveUrl(step.request.url, run.plan.variables) : null},
            ${reached && step.request.body ? sql.json(step.request.body) : null},
            ${responseStatus}, ${responseTimeMs},
            ${assertions ? sql.json(assertions) : null},
            ${failed ? `Assertion failed on ${step.name.toLowerCase()}.` : null},
            ${failed && run.failure ? run.failure.verdict : null},
            ${failed && run.failure ? sql`now() - make_interval(mins => ${run.startedAgo - 30})` : null},
            ${failed && run.failure ? user.id : null},
            now() - make_interval(mins => ${run.startedAgo})
          )
        `;
        resultCount += 1;
      }
    }
    console.log(`${runs.length} executions, ${resultCount} step results on ${first.name}`);
  }

  console.log('Seeded. Sign in at http://localhost:3000/api/auth/dev');
} finally {
  await sql.end();
}
