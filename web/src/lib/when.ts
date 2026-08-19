/**
 * Instants into the words the screens use.
 *
 * The inverse of `mock/when.ts`, and the direction that matters once rows are
 * real: the fixture was written as `4m ago` and derived a timestamp from it, while
 * a database row has the timestamp and needs the label. The vocabulary is
 * deliberately the same one the fixture used -- `Just now`, `Yesterday`,
 * `4m/2h/6d/3w/4mo ago` -- so a screen cannot tell which source it is rendering.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

export function agoLabel(when: Date | string): string {
  const then = typeof when === 'string' ? Date.parse(when) : when.getTime();
  const elapsed = Date.now() - then;

  // A clock skew between the app and the database can put a row microseconds in
  // the future. "Just now" is the truthful reading of that, not a negative count.
  if (elapsed < MINUTE) return 'Just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 2 * DAY) return 'Yesterday';
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d ago`;
  if (elapsed < MONTH) return `${Math.floor(elapsed / WEEK)}w ago`;
  return `${Math.floor(elapsed / MONTH)}mo ago`;
}

export function agoLabelOrNull(when: Date | string | null): string | null {
  return when === null ? null : agoLabel(when);
}
