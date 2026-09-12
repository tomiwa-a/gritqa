import type {
  CoverageFile,
  CoverageState,
  Endpoint,
  ExecutionStatus,
  PlanAssertion,
  PlanStepSpec,
  StepKind,
  TestPlan,
  TestPlanDetail,
  TestingRule,
} from '@/lib/model';

export const RUN_TONE: Record<ExecutionStatus, 'pass' | 'fail' | 'running' | 'skip'> = {
  passed: 'pass',
  failed: 'fail',
  error: 'fail',
  running: 'running',
  pending: 'skip',
};

export const RUN_WORD: Record<ExecutionStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  error: 'Could not run',
  running: 'Running',
  pending: 'Queued',
};

const VARIABLE = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * The `{{ }}` a runner would refuse, or null when there is none.
 *
 * `literal()` in `cli/internal/plan/load.go`, mirrored: strip every well-formed
 * reference and any `{{` still standing is one nothing can resolve, so the step would
 * send those characters verbatim. The regex above was already shared with that half;
 * only the *check* lived on one side of the wire, which is how a plan reading
 * `{{$ENV.RUN_ID}}` got drafted, saved, reviewed, approved, dispatched, and then
 * refused before its first step on a machine nobody was watching.
 */
export function badReference(value: string, where: string): string | null {
  if (!value.replace(VARIABLE, '').includes('{{')) return null;
  const shown = value.length > 60 ? `${value.slice(0, 60)}\u2026` : value;
  return (
    `${where} reads ${JSON.stringify(shown)} \u2014 {{ }} holds one variable name and ` +
    'nothing else, so this would be sent exactly as written'
  );
}

/** Anything reachable, the way `deepBraces` walks it: strings, maps, arrays. */
function deepBad(value: unknown, where: string): string | null {
  if (typeof value === 'string') return badReference(value, where);
  if (Array.isArray(value)) {
    return value.reduce<string | null>(
      (bad, item, i) => bad ?? deepBad(item, `${where}[${i}]`),
      null,
    );
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce<string | null>(
      (bad, [key, inner]) => bad ?? deepBad(inner, `${where} ${key}`),
      null,
    );
  }
  return null;
}

/**
 * The first reason this plan could not be loaded, or null.
 *
 * Same fields and same order as `braces()` on the other side, so the sentence a
 * developer reads here is the sentence the runner would have shown them later.
 */
export function unloadable(plan: {
  variables: Record<string, string>;
  steps: PlanStepSpec[];
}): string | null {
  for (const [name, value] of Object.entries(plan.variables)) {
    const bad = badReference(value, `the variable ${name}`);
    if (bad) return bad;
  }
  for (const [i, step] of plan.steps.entries()) {
    const where = `step ${i + 1} (${step.id})`;
    const bad =
      (step.request ? deepBad(step.request.url, `${where} url`) : null) ??
      deepBad(step.request?.headers, where) ??
      deepBad(step.request?.query, where) ??
      deepBad(step.request?.body, `${where} body`) ??
      deepBad(step.action?.statement, `${where} statement`) ??
      deepBad(step.action?.command, `${where} command`) ??
      step.assertions.reduce<string | null>(
        (found, a, n) => found ?? deepBad(a.expected, `${where} check ${n + 1}`),
        null,
      );
    if (bad) return bad;
  }
  return null;
}

/**
 * The `{{name}}` references one step reads, whatever kind of step it is.
 *
 * Stringifying the payload rather than the request specifically, because a `{{token}}`
 * in a statement or a command is a real dependency and reading only `request` made it
 * invisible -- and invisible in the worst possible way, since `variableChain` keeps
 * only the links with consumers, so the panel titled "How the steps feed each other"
 * would quietly drop the whole chain instead of drawing it wrong.
 */
export function variablesUsedBy(step: PlanStepSpec): string[] {
  const found = new Set<string>();
  const payload = step.kind === 'sql' || step.kind === 'shell' ? step.action : step.request;
  for (const [, name] of JSON.stringify(payload ?? {}).matchAll(VARIABLE)) found.add(name);
  return [...found];
}

/**
 * The kind a step is, with the absent-means-http reading applied in one place.
 *
 * Plans written before the other two kinds existed have no `kind` at all, and the
 * runner reads that the same way -- so this is the reading, not a fallback.
 */
export function stepKindOf(step: PlanStepSpec): StepKind {
  return step.kind ?? 'http';
}

const KIND_ORDER = ['http', 'sql', 'shell'] as const;

/**
 * Which kinds a plan or a report is made of, in one fixed order.
 *
 * Fixed so the same plan reads the same way twice: derived from a `Set`, the order
 * would follow whichever step happened to come first and the prose below would
 * reshuffle between two plans that are made of the same things.
 */
export function kindsIn(steps: { kind?: StepKind }[]): StepKind[] {
  const seen = new Set(steps.map((step) => step.kind ?? 'http'));
  return KIND_ORDER.filter((kind) => seen.has(kind));
}

const KIND_NOUN: Record<StepKind, string> = {
  http: 'a request',
  sql: 'a query',
  shell: 'a command',
};

/**
 * What the steps are, as a phrase: `a request`, `a request or a query`, `a request, a
 * query or a command`.
 *
 * Every sentence introducing a list of steps said "one request" each, which was true
 * of every plan that could be written until now. Rather than hedge them all into
 * something that is true of anything -- "each step below is one step" -- they say what
 * this plan is actually made of.
 */
export function kindPhrase(kinds: StepKind[]): string {
  const nouns = kinds.map((kind) => KIND_NOUN[kind]);
  if (nouns.length <= 1) return nouns[0] ?? KIND_NOUN.http;
  return `${nouns.slice(0, -1).join(', ')} or ${nouns[nouns.length - 1]}`;
}

/**
 * The one line that identifies a step in a list: the URL it calls, or the statement or
 * command it runs.
 *
 * Whitespace collapsed rather than cut at the first newline, because a statement is
 * usually written across four lines and its first one is `SELECT` on its own. One line
 * of the whole thing says more than all of a line that says nothing; the truncation is
 * CSS's job from here.
 */
export function stepHeadline(step: PlanStepSpec): string {
  const kind = stepKindOf(step);
  const text =
    kind === 'sql'
      ? step.action?.statement
      : kind === 'shell'
        ? step.action?.command
        : step.request?.url;
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

export type VariableOrigin =
  { kind: 'seed' } | { kind: 'step'; stepId: string; index: number; path: string };

export type VariableLink = {
  name: string;
  origin: VariableOrigin;
  consumers: { stepId: string; index: number }[];
};

export function variableChain(plan: TestPlanDetail): VariableLink[] {
  const links = new Map<string, VariableLink>();

  for (const name of Object.keys(plan.variables)) {
    links.set(name, { name, origin: { kind: 'seed' }, consumers: [] });
  }

  plan.steps.forEach((step, index) => {
    for (const e of step.extract) {
      links.set(e.name, {
        name: e.name,
        origin: { kind: 'step', stepId: step.id, index, path: e.path },
        consumers: links.get(e.name)?.consumers ?? [],
      });
    }
  });

  plan.steps.forEach((step, index) => {
    for (const name of variablesUsedBy(step)) {
      const link = links.get(name);
      if (link) link.consumers.push({ stepId: step.id, index });
    }
  });

  return [...links.values()].filter((l) => l.consumers.length > 0);
}

const OPERATOR: Record<PlanAssertion['operator'], string> = {
  equals: 'is',
  notEquals: 'is not',
  contains: 'contains',
  notContains: 'does not contain',
  exists: 'is present',
  lt: 'under',
  gt: 'over',
};

export function assertionTarget(a: PlanAssertion) {
  if (a.type === 'status') return 'status';
  if (a.type === 'responseTime') return 'response time';
  if (a.type === 'header') return `header ${a.target}`;
  return a.target;
}

export function assertionPredicate(a: PlanAssertion) {
  const expected =
    a.operator === 'exists'
      ? ''
      : a.type === 'responseTime'
        ? ` ${a.expected}ms`
        : ` ${String(a.expected)}`;
  return `${OPERATOR[a.operator]}${expected}`;
}

export function assertionLabel(a: PlanAssertion) {
  return `${assertionTarget(a)} ${assertionPredicate(a)}`;
}

/** Strips the leading segment of a step URL back to the shape the index knows. */
export function endpointPathOf(url: string) {
  const withoutQuery = url.split('?')[0];
  return withoutQuery.replace(VARIABLE, ':id');
}

/**
 * The endpoints a plan's steps call.
 *
 * Only its requests: a query proving `POST …processBag` wrote a row is evidence about
 * that endpoint, but it is not traffic to it, and this is what the coverage grid
 * counts. Keeping the grid meaning exactly one thing costs something real, which is
 * written down where the query that reads it lives.
 */
export function endpointsTouched(plan: TestPlanDetail): Endpoint[] {
  const seen = new Map<string, Endpoint>();
  for (const step of plan.steps) {
    if (!step.request) continue;
    const path = endpointPathOf(step.request.url);
    const key = `${step.request.method} ${path}`;
    if (!seen.has(key)) seen.set(key, { method: step.request.method, path });
  }
  return [...seen.values()];
}

/** The route file an endpoint lives in, read off the same index the CLI built. */
export function fileForPath(coverage: CoverageFile[], path: string): string | null {
  for (const file of coverage) {
    if (file.endpoints.some((e) => e.path === path)) return file.file;
  }
  return null;
}

export function filesCoveredBy(coverage: CoverageFile[], plan: TestPlan): string[] {
  const files = new Set<string>();
  for (const endpoint of plan.covers) {
    const file = fileForPath(coverage, endpoint.path);
    if (file) files.add(file);
  }
  return [...files].sort();
}

/* ---- Endpoints as first-class objects -------------------------------------
   A coverage square is an endpoint, so it needs one address and one place to
   land. Both are derived from the index; nothing new is stored. */

export function endpointKey(endpoint: { method: string; path: string }) {
  return `${endpoint.method} ${endpoint.path}`;
}

export function endpointHref(endpoint: { method: string; path: string }) {
  return `/dashboard/test-plans?endpoint=${encodeURIComponent(endpointKey(endpoint))}`;
}

export function fileHref(file: string) {
  return `/dashboard/test-plans?file=${encodeURIComponent(file)}`;
}

export type EndpointFocus = {
  method: Endpoint['method'];
  path: string;
  file: string;
  state: CoverageState;
};

/** Only an endpoint the index actually knows about resolves. */
export function endpointFocusFor(
  coverage: CoverageFile[],
  key: string | undefined,
): EndpointFocus | null {
  if (!key) return null;
  for (const file of coverage) {
    for (const endpoint of file.endpoints) {
      if (endpointKey(endpoint) === key) {
        return {
          method: endpoint.method,
          path: endpoint.path,
          file: file.file,
          state: endpoint.state,
        };
      }
    }
  }
  return null;
}

export function coverageFileFor(
  coverage: CoverageFile[],
  name: string | undefined,
): CoverageFile | null {
  if (!name) return null;
  return coverage.find((f) => f.file === name) ?? null;
}

export function plansForEndpoint(plans: TestPlan[], path: string): TestPlan[] {
  return plans.filter((plan) => plan.covers.some((c) => c.path === path));
}

export function plansForFile(
  plans: TestPlan[],
  coverage: CoverageFile[],
  file: string,
): TestPlan[] {
  return plans.filter((plan) => filesCoveredBy(coverage, plan).includes(file));
}

export function coverageTotalsOf(endpoints: { state: CoverageState }[]) {
  return endpoints.reduce((acc, e) => ({ ...acc, [e.state]: acc[e.state] + 1 }), {
    approved: 0,
    draft: 0,
    failing: 0,
    none: 0,
    tested: 0,
    invalid: 0,
  } as Record<CoverageState, number>);
}

/**
 * Which rules shaped a draft. Ordering, assertion and fixture rules apply to
 * every plan; a mock rule only applies when the plan actually reaches its
 * target. Nothing is stored — the generator re-reads the active rules, so this
 * is the same derivation it does.
 */
export function rulesFor(rules: TestingRule[], plan: TestPlanDetail): TestingRule[] {
  const surface = JSON.stringify(plan.steps).toLowerCase();
  return rules.filter((rule) => {
    if (!rule.isActive) return false;
    if (rule.category !== 'mock') return true;
    const target = mockTargetOf(rule);
    return target ? surface.includes(target) : false;
  });
}

/** The service a mock rule stands in for, as its own detail line names it. */
export function mockTargetOf(rule: TestingRule): string | null {
  return rule.detail.match(/target (\w+)/)?.[1] ?? null;
}

/** How far a rule reaches, and how much of that is knowable. */
export type RuleReach = {
  /** Plans this rule is shaping, as far as the record can show. */
  plans: TestPlan[];
  /** Plans with no steps on record, so the rule could not be checked against them. */
  unknown: number;
};

/**
 * `rulesFor` read the other way round: which plans a rule is shaping right now.
 *
 * The two categories answer differently, and collapsing them would be a lie.
 * Ordering, assertion and fixture rules are imposed on every draft whatever it
 * contains, so their reach is every plan and needs no steps to know. A mock rule
 * only applies where a plan actually reaches its target, which can only be read
 * off the steps -- so plans without them are counted as unknown rather than
 * being claimed either way.
 */
export function reachOf(
  rules: TestingRule[],
  allPlans: TestPlan[],
  details: TestPlanDetail[],
  rule: TestingRule,
): RuleReach {
  if (!rule.isActive) return { plans: [], unknown: 0 };
  if (rule.category !== 'mock') return { plans: allPlans, unknown: 0 };

  const plans: TestPlan[] = [];
  let unknown = 0;

  for (const plan of allPlans) {
    const detail = details.find((d) => d.publicId === plan.publicId);
    if (!detail) {
      unknown += 1;
      continue;
    }
    if (rulesFor(rules, detail).some((r) => r.publicId === rule.publicId)) plans.push(plan);
  }

  return { plans, unknown };
}

/** The plan as the CLI receives it, in the shape the runner expects. */
export function planJson(plan: TestPlanDetail) {
  return JSON.stringify(
    {
      name: plan.name,
      version: plan.version,
      description: plan.description,
      baseUrl: plan.baseUrl,
      variables: plan.variables,
      steps: plan.steps,
    },
    null,
    2,
  );
}
