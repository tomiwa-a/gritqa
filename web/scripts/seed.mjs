/**
 * The local slate: one developer, one project, and nothing else.
 *
 * This used to seed six projects with an index, a git history, rules, plans and
 * runs, so that every screen had something to render before any of it was real.
 * That was the right call for a dashboard being designed and the wrong one for a
 * dashboard being used -- the agent researched an actual codebase through MCP and
 * then refined a plan about `payments-api`, because the project row on screen and
 * the code the tools opened had nothing to do with each other. Convincing output
 * about the wrong repository is worse than an empty screen.
 *
 * So: the one project the CLI actually serves, `last_indexed_at` left null because
 * nothing has read it yet, and every other table empty. What appears from here on
 * appears because something wrote it.
 *
 * Destructive, and deliberately so -- this is a reset, not a top-up. Everything
 * project-scoped is truncated on every run.
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
  name: process.env.SEED_NAME ?? 'Tomiwa',
  provider: 'github',
  providerId: 'seed-developer',
};

/**
 * The project the CLI is pointed at, which is the only thing that makes any of
 * this checkable.
 *
 * `localPath` is the directory holding `.gritqa`, not the git root, because that
 * is where the CLI is started and therefore what `device_codes.local_path` reports
 * when a machine asks to be approved -- it is matched against this to pre-select
 * the project. Overridable, since the path is one developer's and this file is
 * committed.
 */
const PROJECT = {
  name: process.env.SEED_PROJECT ?? 'hotel-api',
  localPath: process.env.SEED_PROJECT_PATH ?? '/Applications/XAMPP/xamppfiles/htdocs/hotel/api',
  repoUrl: process.env.SEED_PROJECT_REPO ?? 'git@github.com:tomiwa-a/hotel_management.git',
  branch: process.env.SEED_PROJECT_BRANCH ?? 'main',
};

/**
 * Everything that belongs to a project rather than to the developer.
 *
 * Ordered for readability rather than for the FKs -- CASCADE handles those -- and
 * `projects` is absent on purpose: the row is updated in place further down so its
 * `public_id` survives, which is what keeps an already-issued session cookie and
 * CLI credential pointing at something that exists.
 */
const SCOPED = [
  'test_results',
  'test_executions',
  'jobs',
  'plan_revisions',
  'test_plans',
  'testing_rules',
  'mock_endpoints',
  'commits',
  'codebase_index',
  'cli_instances',
  'device_codes',
];

const sql = postgres(url, { max: 1, onnotice: () => {} });

async function main() {
  const summary = await sql.begin(async (tx) => {
    await tx.unsafe(`TRUNCATE ${SCOPED.join(', ')} RESTART IDENTITY CASCADE`);

    /* The audit log is append-only, enforced by a BEFORE TRUNCATE trigger rather
       than by convention -- so clearing it takes ownership of the table, which the
       application role does not have and never will. That is the guarantee working,
       not a hole in it: a reset script run by hand against a local database is a
       different actor from the running app. */
    await tx.unsafe('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_truncate');
    await tx.unsafe('TRUNCATE audit_logs RESTART IDENTITY');
    await tx.unsafe('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_truncate');

    const [developer] = await tx`
      INSERT INTO users (email, name, provider, provider_id)
      VALUES (${DEVELOPER.email}, ${DEVELOPER.name}, ${DEVELOPER.provider}, ${DEVELOPER.providerId})
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
      RETURNING id, public_id
    `;

    /* Updated in place when it is already there, so the public_id in a browser
       cookie keeps resolving. A developer who renamed the project in `.gritqa`
       gets the rename rather than a second row. */
    const [existing] = await tx`
      SELECT id FROM projects WHERE user_id = ${developer.id} ORDER BY id LIMIT 1
    `;

    const [project] = existing
      ? await tx`
          UPDATE projects SET
            name = ${PROJECT.name},
            local_path = ${PROJECT.localPath},
            repo_url = ${PROJECT.repoUrl},
            default_branch = ${PROJECT.branch},
            status = 'active',
            last_indexed_at = NULL,
            updated_at = now()
          WHERE id = ${existing.id}
          RETURNING id, public_id
        `
      : await tx`
          INSERT INTO projects (user_id, name, local_path, repo_url, default_branch, status)
          VALUES (${developer.id}, ${PROJECT.name}, ${PROJECT.localPath}, ${PROJECT.repoUrl},
                  ${PROJECT.branch}, 'active')
          RETURNING id, public_id
        `;

    /* Any other project is fixture left over from the old seed. */
    const removed = await tx`
      DELETE FROM projects WHERE user_id = ${developer.id} AND id <> ${project.id} RETURNING name
    `;

    return { developer, project, removed: removed.map((r) => r.name) };
  });

  console.log(`user      ${DEVELOPER.email} (${summary.developer.public_id})`);
  console.log(`project   ${PROJECT.name} -> ${PROJECT.localPath}`);
  console.log(`          ${summary.project.public_id}, branch ${PROJECT.branch}, never indexed`);
  if (summary.removed.length > 0) {
    console.log(`removed   ${summary.removed.join(', ')}`);
  }
  console.log('everything else is empty. Sign in with GRITQA_DEV_LOGIN=1.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
