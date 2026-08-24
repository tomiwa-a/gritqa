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

/**
 * What an assertion is about. The four HTTP ones, then the two a query answers and
 * the two a command does.
 *
 * Widened rather than forked into three types on purpose: the operators, the target
 * and the expected value are the same in all eight cases, so the diff, the rules
 * engine and `assertionCount` keep working with no branch. What the split buys is the
 * one thing that matters -- `stdoutContains` on a result set is rejected rather than
 * quietly always-true, and a query is asserted on with `rowCount` and `valueEquals`
 * rather than by string-matching the rows it printed.
 */
export type AssertionType =
  | 'status'
  | 'bodyField'
  | 'header'
  | 'responseTime'
  | 'rowCount'
  | 'valueEquals'
  | 'exitCode'
  | 'stdoutContains';

/** What a step is. Absent in a stored plan means `http`, which is what every plan written before these existed was made of. */
export type StepKind = 'http' | 'sql' | 'shell';

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
  /**
   * Where the value comes from. `result` and `stdout` are what make a sql or shell
   * step compose: a fixture insert hands a real booking id to the request after it,
   * instead of the draft inventing one.
   */
  source: 'body' | 'header' | 'result' | 'stdout';
};

/**
 * What a sql or shell step does, where an HTTP step has a request.
 *
 * One flat object of optional strings, mirroring `Action` in
 * `cli/internal/plan/plan.go` field for field. Not a discriminated union: the wire
 * dialect a draft comes back through has eaten a nested construct before, and the
 * shape the runner already reads happens to be the safe one.
 *
 * `target` is load-bearing rather than decorative. `verify` queries, and its rows are
 * what the assertions read -- that is the out-of-band evidence a `201` is not. `setup`
 * executes, and its row count is rows affected; it is also what marks the step as
 * writing, which is what the approval confirm is drawn from.
 */
export type PlanAction = {
  statement?: string;
  target?: 'setup' | 'verify';
  command?: string;
};

export type PlanStepSpec = {
  id: string;
  name: string;
  description: string;
  dependsOn: string[];
  kind?: StepKind;
  /** Present for an `http` step, absent for the other two. */
  request?: {
    method: Method;
    url: string;
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
    query?: Record<string, string>;
  };
  /** Present for a `sql` or `shell` step, absent for a request. */
  action?: PlanAction;
  extract: PlanExtraction[];
  assertions: PlanAssertion[];
  onFailure: 'abort' | 'continue';
  retry?: { maxAttempts: number; delayMs: number };
};

/**
 * True for a step whose approval deserves a second look: a fixture that writes to
 * GritQA's copy of the database, or any command in its container. A plan of requests
 * and read-only queries approves in one click, which is what keeps the confirm a thing
 * people read rather than dismiss.
 */
export function stepIsHeavy(step: PlanStepSpec): boolean {
  if (step.kind === 'shell') return true;
  return step.kind === 'sql' && step.action?.target !== 'verify';
}

/**
 * What a step was checked against, and how it came out.
 *
 * A drafted step is a claim about somebody else's code -- this route exists, this
 * field is called that, this status comes back. Nothing used to test those claims:
 * the only gates were shape gates, so a step naming a route that does not exist
 * saved as cleanly as one naming a route that does. A developer found out by reading
 * fourteen steps and knowing the codebase well enough to spot the two wrong ones.
 *
 * So a check is recorded per step and kept with the plan. `unsupported` is the
 * verdict worth having and the one a boolean would have lost: there is a real
 * difference between a step that was checked and disagreed with the code, and one
 * whose evidence simply was not reachable -- an endpoint no run has exercised, a
 * table the sandbox never came up to describe. Only the first is a mistake.
 */
export type StepCheckVerdict = 'confirmed' | 'unsupported' | 'wrong';

export type StepCheck = {
  stepId: string;
  verdict: StepCheckVerdict;
  /** Why, in the developer's terms, naming what was read. Empty for a plain confirmation. */
  note: string;
};

/** Whether a check is worth a developer's attention. A confirmation is not. */
export function checkIsDoubt(check: StepCheck): boolean {
  return check.verdict !== 'confirmed';
}

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
  /**
   * What the plan takes on faith. Empty for a plan whose every value came off the
   * code, which is the outcome to aim for and not the common one.
   */
  assumptions: string[];
  /**
   * How each step came out when it was checked against the code. Empty for a plan
   * nothing verified, which is every plan written before the pass existed.
   */
  checks: StepCheck[];
  diffContext: PlanDiffContext | null;
  previousFailure: PlanFailureSeed | null;
  revisions: PlanRevision[];
};

/**
 * One unit that changed, as the runner measured it.
 *
 * `rows` is signed, because a delete moving a count down is as much a finding as an
 * insert moving it up. `from`/`to` are the high-water mark either side and are null
 * for a unit that can only be counted -- a UUID primary key has no MAX.
 */
export type MovedUnit = {
  unit: string;
  rows: number;
  from: string | null;
  to: string | null;
};

/**
 * One check as the runner settled it. `found` is separate from `passed` because the
 * two failures read differently: a field that came back wrong is a bug in the code,
 * and a field that was not in the response at all is usually a bug in the plan.
 */
export type AssertionResult = {
  type: string;
  operator: string;
  target: string | null;
  expected: string | null;
  actual: string | null;
  passed: boolean;
  found: boolean;
};

export type StepResult = {
  stepName: string;
  status: StepStatus;
  kind: StepKind;
  /**
   * The method and the endpoint, for a step that made a request. Null for the other
   * two kinds, which have neither -- and null rather than defaulted, because a query
   * labelled `GET` with an empty path is both wrong and indistinguishable in the run
   * report from a request whose pattern went missing.
   */
  method: Method | null;
  path: string | null;
  /** What it called, ran or executed, with the variables filled in. */
  detail: string | null;
  responseStatus: number | null;
  /** Rows a query returned or a fixture moved. `0` is a finding, not an absence. */
  rowCount: number | null;
  /** What a command exited with. `0` is success, so this is null when there is none. */
  exitCode: number | null;
  /** What a command printed. */
  output: string | null;
  /**
   * What actually came back: a JSON body for a request, the rows for a query, the
   * count for a fixture. Stored masked, so a secret the step sent is not in here.
   *
   * `unknown` because it is whatever the endpoint returned. The runner replaces a
   * body over 64KB with `{truncated: true, bytes: n}` rather than dropping the step,
   * and quotes a non-JSON body as a string, so this is valid JSON either way and
   * never a promise about shape.
   */
  responseBody: unknown;
  /**
   * What the plan declared it would send, before interpolation -- `{{password}}`
   * rather than the password. That is deliberate and it is why no credential a run
   * uses reaches the database, but it means this is the request as written and not
   * as sent. The URL beside it is the other way round: filled in, then masked.
   */
  requestBody: unknown;
  /** Every check the step made, passed and failed alike. A pass is evidence too. */
  assertions: AssertionResult[];
  /** How long the step took, whatever kind it was. */
  responseTimeMs: number | null;
  /**
   * What went wrong with this step, in the runner's words -- `Expected status 200, got
   * 500.` The status code beside it says a 500 came back; only this says what the plan
   * wanted instead, which is the difference between reading the report and guessing at
   * it. Null for every step that did not fail, and for a failure the runner recorded
   * without describing.
   */
  errorMessage: string | null;
  /**
   * What this step changed. Empty is a finding in its own right for a step that
   * claimed to write, and it is only measured after steps that could -- a GET's
   * margin is not taken, which is why the run's own ledger is not the sum of these.
   */
  moved: MovedUnit[];
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
  /**
   * The run's own reading: what the world looks like after, against before the first
   * step. Not the sum of the steps' margins -- this is the reading that catches a GET
   * that writes.
   */
  moved: MovedUnit[];
  /**
   * Why the ledger is incomplete, when it is. An empty `moved` with no note means the
   * run changed nothing; with one it means nobody could tell.
   */
  stateNote: string | null;
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

/**
 * An endpoint's contract as observed, not as declared.
 *
 * Nothing in this product reads a request or response *shape* off the source: the
 * index records where a route is registered, and an OpenAPI document, when there is
 * one, is not kept. What is kept is every call a run actually made -- method, route
 * pattern, url, body, status, body back -- so the shape of an endpoint is answerable
 * from evidence the moment it has been exercised once, and unanswerable before that.
 * Saying which of the two you are looking at is the whole point of the type.
 */
export type ObservedRoute = {
  method: Method;
  path: string;
  /** The url as sent, values substituted, so it is replayable as written. */
  url: string;
  status: number | null;
  /** How many steps in this project have called it. */
  calls: number;
  lastRunAt: Date | null;
};

export type ObservedCall = ObservedRoute & {
  /** Pretty-printed and capped. Null when the call carried no body. */
  request: string | null;
  response: string | null;
  /** Whether either body was cut to fit. */
  clipped: boolean;
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

/**
 * One thing the agent did on its way to an answer: the tool, what it was asked
 * for, and a line about what came back.
 *
 * A digest and never the payload. `read_file` returns whole files, and a transcript
 * that kept results would copy the project's source into the database once per turn.
 * What makes an answer inspectable is knowing it read `api/routes.php` and searched
 * for `reservation` -- not having the file again.
 */
export type AgentStep = {
  tool: string;
  /** What it asked for, flattened to one readable line. A path, a query, a table. */
  subject?: string;
  /** What came back, as a measurement: `412 lines`, `3 matches`, `no rows`. */
  digest?: string;
};

/** A conversation in the history list. No turns -- the list draws a row, not a thread. */
export type Conversation = {
  publicId: string;
  title: string;
  whenLabel: string;
  updatedAt: string;
  turnCount: number;
  /** How many plans came out of this conversation. Usually none, sometimes one. */
  planCount: number;
  /**
   * The last thing said, flattened out of markdown, for a row you are scanning.
   * Null only for a thread with no turns, which nothing writes.
   */
  preview: string | null;
};

export type ConversationTurn = {
  publicId: string;
  seq: number;
  /** Same two-sided naming as `PlanRevision.author`, for the same reason. */
  author: 'ai' | 'you';
  body: string;
  whenLabel: string;
  createdAt: string;
  /** Empty on your turns: you did not call anything. */
  steps: AgentStep[];
};

export type ConversationDetail = Conversation & {
  turns: ConversationTurn[];
  /** Plans drafted out of this conversation, newest first. */
  plans: { publicId: string; name: string; status: TestPlanStatus; version: number }[];
};
