/**
 * The read model: every shape a screen renders, and every shape a `lib/db/` mapper returns.
 *
 * One vocabulary between the two, which is what makes the seam in `lib/data/` a seam. A
 * query builds these; a component consumes them; neither knows the other's shape. Renaming
 * a field here breaks both ends at once, and that is the point of the file.
 *
 * Two conventions run through it:
 *
 * - **Ids are `publicId`.** The BIGINT primary keys never leave the server -- a URL, a prop
 *   and an API answer all name a row by its UUID.
 * - **Labels come with their raw value.** `createdLabel` beside `createdAt`, `whenLabel`
 *   beside `committedAt`. The label is what a screen shows and the timestamp is what it
 *   sorts, filters or recomputes by; a screen that only got the label would have to parse
 *   English back into a date.
 *
 * It lived in `lib/mock/types.ts` for as long as the mock did. Nothing about it was ever the
 * mock's -- these were the shapes the constants had to satisfy -- so it moved out when they
 * were deleted rather than being renamed in place.
 */
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
  lastIndexedAt: string | null;
  fileCount: number;
  endpointCount: number;
};

/**
 * One machine that has polled for this project.
 *
 * `connected` is a fact with a shelf life -- 30 seconds from `lastSeenAt` -- so it is
 * computed at read time and never stored. Nothing writes `false` when a laptop lid
 * closes, because that is precisely the event nobody gets to observe.
 */
export type Machine = {
  instanceId: string;
  /** What the machine calls itself. Null when the CLI did not say. */
  hostname: string | null;
  version: string | null;
  connected: boolean;
  lastSeenLabel: string;
  lastSeenAt: string;
};

export type MachineStatus = {
  connected: boolean;
  /** Newest first. Empty for a project no CLI has ever polled for. */
  machines: Machine[];
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
  createdAt: string;
  stepCount: number;
  assertionCount: number;
  /** The endpoints the plan is about — sign-in scaffolding excluded. */
  covers: Endpoint[];
  lastRun: { status: ExecutionStatus; passed: number; total: number; label: string } | null;
};

export type AssertionType = 'status' | 'bodyField' | 'header' | 'responseTime';

export type AssertionOperator =
  'equals' | 'notEquals' | 'contains' | 'notContains' | 'exists' | 'lt' | 'gt';

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
  createdAt: string;
  /** Who started the turn. A revision by 'you' is an instruction the model answered. */
  author: 'ai' | 'you';
  /** `plan_revisions.instruction`. Null on the agent's own turns: nobody asked. */
  instruction?: string;
  summary: string;
  changes: PlanChange[];
};

/** `test_results.verdict`. Per failed step, not per run: one run can break twice. */
export type FailureVerdict = 'real_bug' | 'bad_test' | 'undecided';

export type PlanFailureSeed = {
  version: number;
  stepId: string;
  whenLabel: string;
  observedAt: string;
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
  /** How many commits the range covers. One, when it is a single push. */
  commitCount?: number;
};

export type CommitFile = { path: string; additions: number; deletions: number };

/**
 * A row in `commits`. The short hash is derived on read rather than stored -- a
 * prefix of a sha is not a second fact about the commit.
 */
export type Commit = {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  whenLabel: string;
  committedAt: string;
  branch: string;
  files: CommitFile[];
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
  /**
   * What went wrong with this step, in the runner's words -- `Expected status 200, got
   * 500.` The status code beside it says a 500 came back; only this says what the plan
   * wanted instead, which is the difference between reading the report and guessing at
   * it. Null for every step that did not fail, and for a failure the runner recorded
   * without describing.
   */
  errorMessage: string | null;
};

export type TestExecution = {
  publicId: string;
  /** test_executions.test_plan_id — a run always belongs to one plan. */
  planPublicId: string;
  planName: string;
  status: ExecutionStatus;
  durationMs: number | null;
  startedLabel: string;
  /**
   * The label reads from when the run *happened*; this reads from when it started,
   * and for a queued run those are not the same thing. A run exists from the moment
   * it is asked for, so a `pending` one is labelled from that moment and has no
   * start yet -- null here means "not yet", not "unknown".
   */
  startedAt: string | null;
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
  /**
   * Why the run ended the way it did, when there is anything to say -- in practice
   * only ever set for `error`. A run reaped after its machine stopped reporting has
   * this and nothing else: no steps, no duration, no failed assertion to read. It is
   * on the window's own model rather than on the step report, because a run that
   * never made a request is exactly the run whose report is empty.
   */
  errorMessage: string | null;
  whenLabel: string;
  /**
   * The label reads from when the run *happened*; this reads from when it started,
   * and for a queued run those are not the same thing. A run exists from the moment
   * it is asked for, so a `pending` one is labelled from that moment and has no
   * start yet -- null here means "not yet", not "unknown".
   */
  startedAt: string | null;
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
  createdAt: string;
  ip: string;
};
