import type {
  CoverageFile,
  CoverageState,
  Endpoint,
  ExecutionStatus,
  PlanAssertion,
  PlanStepSpec,
  TestPlan,
  TestPlanDetail,
  TestingRule,
} from '@/lib/mock/types';

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

export function variablesUsedBy(step: PlanStepSpec): string[] {
  const found = new Set<string>();
  for (const [, name] of JSON.stringify(step.request).matchAll(VARIABLE)) found.add(name);
  return [...found];
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

export function endpointsTouched(plan: TestPlanDetail): Endpoint[] {
  const seen = new Map<string, Endpoint>();
  for (const step of plan.steps) {
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
