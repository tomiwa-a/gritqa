/**
 * Overlays are addressed the same way every other piece of dashboard state is:
 * a search param on the page you are already on. Closing drops the param and
 * leaves the rest of the URL — and so the filter you were looking at — alone.
 */

export type OverlayKind = 'plan' | 'run' | 'refine' | 'ask' | 'rule' | 'generate';

export type OverlayToken =
  { kind: 'plan' | 'run' | 'refine' | 'ask' | 'rule'; id: string } | { kind: 'generate'; id: null };

/** Params an overlay owns. Everything else on the URL belongs to the page. */
export const OVERLAY_PARAMS = ['open', 'g', 'from', 'state', 'since', 'q', 'only', 'edit'] as const;

export type PageParams = Record<string, string | string[] | undefined>;

export function parseOverlay(open: string | undefined): OverlayToken | null {
  if (!open) return null;
  if (open === 'generate') return { kind: 'generate', id: null };

  const at = open.indexOf(':');
  if (at < 1) return null;

  const kind = open.slice(0, at);
  const id = open.slice(at + 1);
  if (!id) return null;
  if (kind === 'plan' || kind === 'run' || kind === 'refine' || kind === 'ask' || kind === 'rule') {
    return { kind, id };
  }
  return null;
}

export function planToken(publicId: string) {
  return `plan:${publicId}`;
}

export function runToken(publicId: string) {
  return `run:${publicId}`;
}

/**
 * The refine thread for one plan, opened over whatever page you are reading.
 *
 * It was `ask:` until conversations existed, and the name was always slightly off --
 * the panel asks for a new *version*, and the only thing it can talk about is the
 * plan it is attached to. `ask:` now means the thing it sounds like: a conversation
 * about the codebase, which is not about any plan.
 */
export function refineToken(planPublicId: string) {
  return `refine:${planPublicId}`;
}

/**
 * A conversation about the codebase. `ask:new` starts one instead of reading one,
 * following `rule:new` -- one token, two jobs, and no route that exists only to hold
 * a thing that does not exist yet.
 */
export function askToken(conversationPublicId: string) {
  return `ask:${conversationPublicId}`;
}

/** What `ask:` carries before there is a conversation to carry. */
export const NEW_CONVERSATION = 'new';

/**
 * One rule and what it is shaping. `rule:new` writes a rule instead of reading one,
 * and `&edit=1` beside an existing id opens the same box over that rule.
 */
export function ruleToken(publicId: string) {
  return `rule:${publicId}`;
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

/**
 * The same, from an href rather than from parsed params.
 *
 * For a server action, which has the URL the browser was on as a string and no
 * `PageParams` to reach for -- an ask that started a conversation has to send the
 * panel to the conversation it just created, and the rest of the page's params come
 * along untouched.
 */
export function withOverlayOn(href: string, token: string) {
  const [pathname, query = ''] = href.split('?');
  const next = new URLSearchParams(query);
  for (const param of OVERLAY_PARAMS) next.delete(param);
  next.set('open', token);
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
