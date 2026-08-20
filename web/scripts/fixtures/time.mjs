/**
 * Minutes, because that is what the fixtures count in.
 *
 * A row's age is written as minutes-ago and turned into a timestamp at insert time,
 * so every seeded database is the same *shape* of history at whatever hour it is
 * run. `agoLabel` in `src/lib/when.ts` turns the column back into words.
 *
 * These live here rather than in `plans.mjs` because the commit history is what the
 * plans were drafted from -- so `plans.mjs` imports from `commits.mjs`, and anything
 * both of them need has to sit under both.
 */
export const HOUR = 60;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
export const MONTH = 30 * DAY;
