/**
 * Applies drizzle/*.sql in filename order, once each.
 *
 * Not `drizzle-kit migrate`, because the SQL in drizzle/ is hand-written rather
 * than generated -- there is no journal for drizzle-kit to read, and generating
 * one would invite `generate` to overwrite files that carry triggers and
 * comments. This does the one thing a migration runner has to do: remember what
 * it already ran.
 *
 * Each file runs inside its own transaction. A file that fails leaves nothing
 * behind, including its own row in the ledger, so fixing the SQL and re-running
 * is the recovery.
 *
 *   node scripts/migrate.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';

process.loadEnvFile?.(join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local'));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local.');
  process.exit(1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      hash       varchar(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = new Map(
    (await sql`SELECT name, hash FROM _migrations`).map((r) => [r.name, r.hash]),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  let ran = 0;

  for (const name of files) {
    const body = await readFile(join(dir, name), 'utf8');
    const hash = createHash('sha256').update(body).digest('hex');
    const seen = applied.get(name);

    if (seen === hash) continue;
    if (seen) {
      // An applied migration was edited after the fact. Replaying it would fail
      // on the first CREATE, and skipping it would leave the schema silently
      // behind the file. Neither is recoverable automatically.
      console.error(`${name} changed after it was applied. Write a new migration instead.`);
      process.exit(1);
    }

    // `sql.file`-style multi-statement bodies need simple protocol, which
    // postgres.js gives via .unsafe(). The body opens its own transaction.
    await sql.unsafe(body);
    await sql`INSERT INTO _migrations (name, hash) VALUES (${name}, ${hash})`;
    console.log(`applied ${name}`);
    ran += 1;
  }

  console.log(ran ? `${ran} migration(s) applied.` : 'Already up to date.');
} finally {
  await sql.end();
}
