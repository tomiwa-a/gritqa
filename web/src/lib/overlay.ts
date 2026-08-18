/**
 * Overlays are addressed the same way every other piece of dashboard state is:
 * a search param on the page you are already on. Closing drops the param and
 * leaves the rest of the URL — and so the filter you were looking at — alone.
 */

export type OverlayKind = 'plan' | 'run' | 'ask' | 'generate';

export type OverlayToken =
  { kind: 'plan' | 'run' | 'ask'; id: string } | { kind: 'generate'; id: null };

/** Params an overlay owns. Everything else on the URL belongs to the page. */
export const OVERLAY_PARAMS = ['open', 'g', 'from', 'state', 'since', 'q', 'only'] as const;

export type PageParams = Record<string, string | string[] | undefined>;

export function parseOverlay(open: string | undefined): OverlayToken | null {
  if (!open) return null;
  if (open === 'generate') return { kind: 'generate', id: null };

  const at = open.indexOf(':');
  if (at < 1) return null;

  const kind = open.slice(0, at);
  const id = open.slice(at + 1);
  if (!id) return null;
  if (kind === 'plan' || kind === 'run' || kind === 'ask') return { kind, id };
  return null;
}

export function planToken(publicId: string) {
  return `plan:${publicId}`;
}

export function runToken(publicId: string) {
  return `run:${publicId}`;
}

/** The conversation about a plan, opened over whatever page you are reading. */
export function askToken(planPublicId: string) {
  return `ask:${planPublicId}`;
}

function search(params: PageParams, drop: readonly string[]) {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (drop.includes(key)) continue;
    if (typeof value === 'string' && value !== '') out.set(key, value);
  }
  return out;
}

function join(pathname: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Open an overlay over the current page, keeping the page's own params. */
export function withOverlay(
  pathname: string,
  params: PageParams,
  token: string,
  extra?: Record<string, string | undefined>,
) {
  const next = search(params, OVERLAY_PARAMS);
  next.set('open', token);
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) next.set(key, value);
  }
  return join(pathname, next);
}

/** Where an overlay's close button goes: this page, minus the overlay. */
export function withoutOverlay(pathname: string, params: PageParams) {
  return join(pathname, search(params, OVERLAY_PARAMS));
}

/** Change one overlay param — the wizard's step, the commit in range — keeping the rest. */
export function withOverlayParams(
  pathname: string,
  params: PageParams,
  patch: Record<string, string | undefined>,
) {
  const next = search(params, []);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) next.delete(key);
    else next.set(key, value);
  }
  return join(pathname, next);
}
