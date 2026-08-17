import type { Method } from '@/components/ui/method-badge';

export type Provider = 'github' | 'gitlab';

export type User = {
  publicId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  provider: Provider;
  hasAiKey: boolean;
  aiKeyMasked: string | null;
};

export type Project = {
  publicId: string;
  name: string;
  repoUrl: string | null;
  localPath: string;
  defaultBranch: string;
  status: 'active' | 'archived';
  lastIndexedLabel: string | null;
  fileCount: number;
  endpointCount: number;
};

export type TestPlanStatus = 'draft' | 'approved' | 'archived';
export type ExecutionStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error';
export type StepStatus = 'pending' | 'passed' | 'failed' | 'skipped' | 'error';
export type RuleCategory = 'ordering' | 'mock' | 'assertion' | 'fixture';

export type Endpoint = { method: Method; path: string };

export type TestPlan = {
  publicId: string;
  name: string;
  description: string;
  status: TestPlanStatus;
  version: number;
  triggerSource: 'git_push' | 'manual';
  createdLabel: string;
  stepCount: number;
  assertionCount: number;
  /** The endpoints the plan is about — sign-in scaffolding excluded. */
  covers: Endpoint[];
  lastRun: { status: ExecutionStatus; passed: number; total: number; label: string } | null;
};

export type AssertionType = 'status' | 'bodyField' | 'header' | 'responseTime';

export type AssertionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'exists'
  | 'lt'
  | 'gt';

export type PlanAssertion = {
  type: AssertionType;
  operator: AssertionOperator;
  target: string;
  expected?: string | number | boolean;
};

export type PlanExtraction = {
  name: string;
  path: string;
  source: 'body' | 'header';
};

export type PlanStepSpec = {
  id: string;
  name: string;
  description: string;
  dependsOn: string[];
  request: {
    method: Method;
    url: string;
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
    query?: Record<string, string>;
  };
  extract: PlanExtraction[];
  assertions: PlanAssertion[];
  onFailure: 'abort' | 'continue';
  retry?: { maxAttempts: number; delayMs: number };
};

export type PlanChangeKind =
  | 'step_added'
  | 'step_removed'
  | 'step_reordered'
  | 'assertion_added'
  | 'assertion_removed'
  | 'value_changed';

export type PlanChange = {
  kind: PlanChangeKind;
  stepName: string;
  detail: string;
  from?: string;
  to?: string;
};

export type PlanRevision = {
  version: number;
  whenLabel: string;
  /** Who started the turn. A revision by 'you' is an instruction the model answered. */
  author: 'ai' | 'you';
  /** SCHEMA GAP: no table stores refine instructions — versions alone lose the why. */
  instruction?: string;
  summary: string;
  changes: PlanChange[];
};

/** SCHEMA GAP: test_executions records what happened, never the human's read of it. */
export type FailureVerdict = 'real_bug' | 'bad_test' | 'undecided';

export type PlanFailureSeed = {
  version: number;
  stepId: string;
  whenLabel: string;
  expected: string;
  actual: string;
  verdict: FailureVerdict;
};

export type PlanDiffContext = {
  branch: string;
  commit: string;
  message: string;
  additions: number;
  deletions: number;
  files: { path: string; additions: number; deletions: number }[];
};

export type TestPlanDetail = TestPlan & {
  baseUrl: string;
  variables: Record<string, string>;
  steps: PlanStepSpec[];
  diffContext: PlanDiffContext | null;
  previousFailure: PlanFailureSeed | null;
  revisions: PlanRevision[];
};

export type StepResult = {
  stepName: string;
  status: StepStatus;
  method: Method;
  path: string;
  responseStatus: number | null;
  responseTimeMs: number | null;
};

export type TestExecution = {
  publicId: string;
  /** test_executions.test_plan_id — a run always belongs to one plan. */
  planPublicId: string;
  planName: string;
  status: ExecutionStatus;
  durationMs: number | null;
  startedLabel: string;
  steps: StepResult[];
};

/**
 * The 30-day strip. Every run in the window has an identity and a plan; only
 * the newest few carry a full step report in this build.
 */
export type RunHistoryEntry = {
  publicId: string;
  planPublicId: string;
  planName: string;
  status: ExecutionStatus;
  /** One character per step: p passed, f failed, s skipped or not reached. */
  cells: string;
  whenLabel: string;
};

export type TestingRule = {
  publicId: string;
  name: string;
  category: RuleCategory;
  isActive: boolean;
  detail: string;
};

export type CoverageState = 'approved' | 'draft' | 'failing' | 'none';

export type EndpointCoverage = {
  method: Method;
  path: string;
  state: CoverageState;
};

export type CoverageFile = {
  file: string;
  endpoints: EndpointCoverage[];
};

export type AuditTone = 'plan' | 'run' | 'rule' | 'project' | 'account';

export type AuditEntry = {
  id: number;
  action: string;
  label: string;
  tone: AuditTone;
  whenLabel: string;
  ip: string;
};
