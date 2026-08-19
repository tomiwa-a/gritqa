/**
 * The fixture was written in relative words — `2h ago`, `Yesterday` — because
 * that is what the screens show. The read model now carries the raw instant
 * beside every label, so this turns one into the other rather than asking every
 * literal to state both.
 *
 * The anchor is fixed on purpose. A moving `Date.now()` would make the same
 * fixture render differently on every request, and the labels beside these
 * values are static strings, so a static instant is the honest pairing.
 */
const ANCHOR = Date.parse('2026-08-17T09:20:00Z');

const MINUTE = 60_000;
const UNIT: Record<string, number> = {
  m: MINUTE,
  h: 60 * MINUTE,
  d: 24 * 60 * MINUTE,
  w: 7 * 24 * 60 * MINUTE,
  mo: 30 * 24 * 60 * MINUTE,
};

/** `2h ago` → an ISO instant, measured back from the anchor. */
export function at(label: string): string {
  if (label === 'Just now') return new Date(ANCHOR).toISOString();
  if (label === 'Yesterday') return new Date(ANCHOR - UNIT.d).toISOString();

  const found = label.match(/^(\d+)(mo|[mhdw]) ago$/);
  if (!found) throw new Error(`Cannot read a time out of "${label}"`);
  return new Date(ANCHOR - Number(found[1]) * UNIT[found[2]]).toISOString();
}

/** The nullable variant, for a project that has never been read. */
export function atOrNull(label: string | null): string | null {
  return label === null ? null : at(label);
}
