import { coverage, rules } from '@/lib/mock/data';
import type {
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
  | { kind: 'seed' }
  | { kind: 'step'; stepId: string; index: number; path: string };

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
export function fileForPath(path: string): string | null {
  for (const file of coverage) {
    if (file.endpoints.some((e) => e.path === path)) return file.file;
  }
  return null;
}

export function filesCoveredBy(plan: TestPlan): string[] {
  const files = new Set<string>();
  for (const endpoint of plan.covers) {
    const file = fileForPath(endpoint.path);
    if (file) files.add(file);
  }
  return [...files].sort();
}

/**
 * Which rules shaped a draft. Ordering, assertion and fixture rules apply to
 * every plan; a mock rule only applies when the plan actually reaches its
 * target. Nothing is stored — the generator re-reads the active rules, so this
 * is the same derivation it does.
 */
export function rulesFor(plan: TestPlanDetail): TestingRule[] {
  const surface = JSON.stringify(plan.steps).toLowerCase();
  return rules.filter((rule) => {
    if (!rule.isActive) return false;
    if (rule.category !== 'mock') return true;
    const target = rule.detail.match(/target (\w+)/)?.[1];
    return target ? surface.includes(target) : false;
  });
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
