/**
 * A timestamp out of a raw query, as a Date.
 *
 * Drizzle knows a column is `timestamptz` and hands back a Date; a hand-written
 * query has no such information, and whether the driver parses it depends on which
 * runtime the module was loaded in -- the same SELECT yields a Date under plain node
 * and a string under Turbopack's server chunk. Reading one as the other fails on the
 * first `.toISOString()`, so the coercion happens once, here, at the boundary where
 * the type is genuinely unknown.
 */
export function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
