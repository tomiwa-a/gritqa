import { readFileSync } from 'node:fs';
import type { Config } from 'drizzle-kit';

/**
 * Next loads `.env.local` for the app; drizzle-kit does not, so read it here.
 * Only fills variables that are not already set, so the shell still wins.
 */
function loadEnvLocal() {
  let raw: string;
  try {
    raw = readFileSync(new URL('.env.local', import.meta.url), 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined) process.env[key] = value.replace(/^["']|["']$/g, '');
  }
}

loadEnvLocal();

export default {
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  /**
   * Migrations are written by hand, not generated. `drizzle-kit generate` cannot
   * express the parts of this schema that carry the guarantees -- the UUIDv7
   * default, the `updated_at` triggers, the append-only GRANTs on the audit
   * table -- so the SQL in ./drizzle is the source and this config exists for
   * `drizzle-kit check` and for introspection.
   */
  strict: true,
} satisfies Config;
