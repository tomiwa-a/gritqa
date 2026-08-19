import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * One connection pool for the process.
 *
 * The `globalThis` cache is not a style preference: `next dev` re-evaluates a
 * module on every edit that touches its import graph, and a fresh pool per
 * evaluation exhausts Postgres' connection limit within an afternoon of editing.
 * The pool outlives the module so reloads reuse it.
 */
const globalForDb = globalThis as unknown as {
  __gritqaSql?: ReturnType<typeof postgres>;
};

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy web/.env.example to web/.env.local and point it at Postgres.',
    );
  }
  return postgres(url, {
    // A serverless function gets one request at a time, so a wide pool per
    // instance buys nothing and costs connections. Dev is one long-lived process,
    // where a few help.
    max: process.env.NODE_ENV === 'production' ? 1 : 5,
    // Timestamps come back as Date objects; the read model formats them.
    transform: undefined,
  });
}

export const sql = (globalForDb.__gritqaSql ??= connect());

export const db = drizzle(sql, { schema });

export type Db = typeof db;
