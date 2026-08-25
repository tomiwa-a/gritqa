import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { AgentStep, CommitFile, PlanChange } from '@/lib/model';
import type { ComposeService, EnvironmentSpec } from '@/lib/environment';

/**
 * Every table carries the dual-ID pattern from `plan/technical/entities.md`: a
 * BIGINT `id` for foreign keys, which never leaves the server, and a UUIDv7
 * `public_id` for anything a URL or an API response can see. Sequential integers
 * in URLs leak how many rows exist and let one user guess at another's; v7 keeps
 * the time-ordering that makes an index useful without being enumerable.
 *
 * `uuid_generate_v7()` is defined in `drizzle/0000_identity.sql`. Postgres only
 * ships a v7 generator from 18 onward, and this runs on 16.
 */
const identity = {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  publicId: uuid('public_id')
    .notNull()
    .unique()
    .default(sql`uuid_generate_v7()`),
};

const stamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** Drizzle has no `bytea`. Only the audit log needs one, and it holds gzip. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const providerEnum = pgEnum('provider', ['github', 'gitlab']);
export const projectStatusEnum = pgEnum('project_status', ['active', 'archived']);
export const environmentStatusEnum = pgEnum('environment_status', [
  'proposed',
  'approved',
  'superseded',
]);
export const deviceCodeStatusEnum = pgEnum('device_code_status', [
  'pending',
  'approved',
  'denied',
  'claimed',
]);

export const users = pgTable(
  'users',
  {
    ...identity,
    email: varchar('email', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    avatarUrl: text('avatar_url'),
    provider: providerEnum('provider').notNull(),
    providerId: varchar('provider_id', { length: 255 }).notNull(),
    /** AES-256-GCM ciphertext, never a readable key. See `src/lib/crypto.ts`. */
    aiApiKey: text('ai_api_key'),
    ...stamps,
  },
  (t) => [uniqueIndex('users_provider_identity_idx').on(t.provider, t.providerId)],
);

export const projects = pgTable(
  'projects',
  {
    ...identity,
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    repoUrl: text('repo_url'),
    /** Absolute path on the developer's machine. The web app never reads it. */
    localPath: text('local_path').notNull(),
    defaultBranch: varchar('default_branch', { length: 255 }).notNull().default('main'),
    status: projectStatusEnum('status').notNull().default('active'),
    lastIndexedAt: timestamp('last_indexed_at', { withTimezone: true }),
    ...stamps,
  },
  (t) => [
    index('projects_user_idx').on(t.userId),
    uniqueIndex('projects_user_local_path_idx').on(t.userId, t.localPath),
  ],
);

/**
 * The dashboard's mirror of the index the CLI built. The CLI's own SQLite beside
 * the files is authoritative -- it can answer about the working tree as it is
 * right now -- so nothing correctness-bearing reads from this table. It exists so
 * `/dashboard/codebase` has something to render and so a project's file count is
 * a real count rather than a stored number that can drift.
 */
export const codebaseIndex = pgTable(
  'codebase_index',
  {
    ...identity,
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    fileHash: varchar('file_hash', { length: 64 }).notNull(),
    language: varchar('language', { length: 50 }).notNull(),
    symbols: jsonb('symbols')
      .notNull()
      .default(sql`'[]'::jsonb`),
    dependencies: jsonb('dependencies')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Endpoints the CLI parsed out of this file. Counted for the overview. */
    endpoints: jsonb('endpoints')
      .notNull()
      .default(sql`'[]'::jsonb`),
    lastIndexedAt: timestamp('last_indexed_at', { withTimezone: true }).notNull().defaultNow(),
    ...stamps,
  },
  (t) => [uniqueIndex('codebase_index_project_file_idx').on(t.projectId, t.filePath)],
);

/**
 * One CLI sign-in attempt. Not in `entities.md`, because the device flow was
 * described as a screen rather than as state.
 *
 * Two codes, and the split is the security of it. `user_code` is short enough to
 * read off a terminal and type into a browser (`GRIT-4K2P`), so it is guessable
 * and confers nothing on its own -- approving it requires a signed-in session.
 * `device_code` is the long secret only the CLI ever holds, and only a SHA-256 of
 * it is stored, so a dump of this table cannot be replayed to claim a token.
 *
 * Rows are short-lived by design: `expires_at` is minutes out, and a claimed row
 * keeps no secret.
 */
export const deviceCodes = pgTable(
  'device_codes',
  {
    ...identity,
    userCode: varchar('user_code', { length: 12 }).notNull().unique(),
    deviceCodeHash: varchar('device_code_hash', { length: 64 }).notNull().unique(),
    status: deviceCodeStatusEnum('status').notNull().default('pending'),
    /** Set when a signed-in human approves, which is the only way it gets set. */
    userId: bigint('user_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'cascade',
    }),
    projectId: bigint('project_id', { mode: 'number' }).references(() => projects.id, {
      onDelete: 'set null',
    }),
    /** What the CLI told us about itself, for the approval screen to show. */
    hostname: varchar('hostname', { length: 255 }),
    localPath: text('local_path'),
    /**
     * The project the CLI is standing in, as it described it. A proposal, not a
     * project: when `local_path` matches nothing the developer owns, approving is
     * what turns these three into a row.
     */
    projectName: varchar('project_name', { length: 255 }),
    repoUrl: text('repo_url'),
    defaultBranch: varchar('default_branch', { length: 255 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    ...stamps,
  },
  (t) => [index('device_codes_expires_idx').on(t.expiresAt)],
);

/**
 * Which of a developer's machines is connected to a project, and when it last said so.
 *
 * One row per machine per project. A column on `projects` would have had to pick one
 * machine and call it "the" CLI, and a laptop plus a desktop is an ordinary setup --
 * this also lets a screen name the machine, which is a better sentence than
 * "connected".
 *
 * Liveness is `lastSeenAt` measured against an interval, never a stored boolean. The
 * event that ends a connection is a lid closing or a process being killed, and nobody
 * is there to write `false` when it happens, so a boolean would go stale by design.
 */
export const cliInstances = pgTable(
  'cli_instances',
  {
    ...identity,
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /**
     * The CLI's own stable name for the machine, sent on every poll. Not a credential
     * -- the bearer token authorises the request and this only says which machine sent
     * it, so the worst a CLI can do by lying is impersonate another machine of the same
     * developer's.
     */
    instanceId: varchar('instance_id', { length: 255 }).notNull(),
    hostname: varchar('hostname', { length: 255 }),
    version: varchar('version', { length: 64 }),
    /** The CLI's MCP server address, auto-registered on every poll. */
    mcpUrl: varchar('mcp_url', { length: 512 }),
    /** The CLI's MCP bearer token, auto-registered on every poll. */
    mcpToken: varchar('mcp_token', { length: 255 }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** The upsert target, so a poll updates one row rather than piling up sightings. */
    uniqueIndex('cli_instances_identity_idx').on(t.projectId, t.instanceId),
    index('cli_instances_seen_idx').on(t.projectId, t.lastSeenAt),
  ],
);

export const ruleCategoryEnum = pgEnum('rule_category', [
  'ordering',
  'mock',
  'assertion',
  'fixture',
]);
export const testPlanStatusEnum = pgEnum('test_plan_status', ['draft', 'approved', 'archived']);
export const triggerSourceEnum = pgEnum('trigger_source', ['git_push', 'manual']);
/**
 * How a *run* started, which is a different question from how its plan was written.
 *
 * `queued` is the dashboard: a click, a job, a machine that claimed it. `terminal`
 * is a developer running a plan on their own machine and reporting it afterwards --
 * which has no job behind it and so settles in one insert. `auto` is a run GritQA
 * started because the code moved; it has no writer yet.
 */
export const runTriggerEnum = pgEnum('run_trigger', ['queued', 'terminal', 'auto']);
export const executionStatusEnum = pgEnum('execution_status', [
  'pending',
  'running',
  'passed',
  'failed',
  'error',
]);
/**
 * What a step was. `http` has a method, a route and a status; `sql` has rows;
 * `shell` has an exit code and output.
 *
 * Absent from a plan's JSON means `http`, which is what the Go runner already
 * resolves it to -- every step written before there was more than one kind was a
 * request, so the default backfills truthfully rather than by convention.
 */
export const stepKindEnum = pgEnum('step_kind', ['http', 'sql', 'shell']);

export const stepStatusEnum = pgEnum('step_status', [
  'pending',
  'passed',
  'failed',
  'skipped',
  'error',
]);
export const jobTypeEnum = pgEnum('job_type', ['index_codebase', 'execute_tests']);
export const jobStatusEnum = pgEnum('job_status', [
  'pending',
  'claimed',
  'completed',
  'failed',
  'dead',
]);
export const httpMethodEnum = pgEnum('http_method', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
export const failureVerdictEnum = pgEnum('failure_verdict', ['real_bug', 'bad_test', 'undecided']);
export const revisionAuthorEnum = pgEnum('revision_author', ['agent', 'human']);

export const testingRules = pgTable(
  'testing_rules',
  {
    ...identity,
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    category: ruleCategoryEnum('category').notNull(),
    /**
     * Shape depends on the category, and stays JSONB until the structured
     * per-category fields land -- an assertion is type x operator x target x
     * expected, an ordering rule is a priority number, and inventing four
     * columns that are null three times out of four buys nothing yet.
     */
    ruleConfig: jsonb('rule_config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    isActive: boolean('is_active').notNull().default(true),
    ...stamps,
  },
  (t) => [index('testing_rules_project_category_idx').on(t.projectId, t.category)],
);

export const testPlans = pgTable(
  'test_plans',
  {
    ...identity,
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    baseUrl: text('base_url').notNull(),
    /** The agent's output. Validated against JSON Schema on the way in, not here. */
    planJson: jsonb('plan_json').notNull(),
    status: testPlanStatusEnum('status').notNull().default('draft'),
    /** Optimistic lock. A version that walks backwards means two writers raced. */
    version: integer('version').notNull().default(1),
    triggerSource: triggerSourceEnum('trigger_source').notNull(),
    /**
     * Kept even though `commits` exists: this is the diff as it stood when the
     * plan was drafted, and a branch that has since moved cannot reproduce it.
     */
    diffContext: jsonb('diff_context'),
    /**
     * Where this plan came from, when it came out of a conversation rather than
     * out of the wizard. `triggerSource` stays `manual` either way -- a person
     * asked -- and this carries the difference between asking by filling in a box
     * and arriving at it by talking.
     */
    conversationId: bigint('conversation_id', { mode: 'number' }).references(
      () => conversations.id,
      { onDelete: 'set null' },
    ),
    ...stamps,
  },
  (t) => [index('test_plans_project_status_idx').on(t.projectId, t.status, t.createdAt)],
);

/**
 * Why a plan changed, which `test_plans.version` cannot say.
 *
 * A developer reading a plan's history wants the sentence they typed, not a diff
 * of two JSON blobs to infer it from. This is the table `refine-composer.tsx`
 * has been submitting into nothing for.
 *
 * `author` is stored as agent/human rather than the read model's ai/you, because
 * "you" is only true from one side of the screen. The data layer maps it.
 */
export const planRevisions = pgTable(
  'plan_revisions',
  {
    ...identity,
    testPlanId: bigint('test_plan_id', { mode: 'number' })
      .notNull()
      .references(() => testPlans.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    author: revisionAuthorEnum('author').notNull(),
    /** Null for the agent's own turns; a CHECK requires it for a human's. */
    instruction: text('instruction'),
    summary: text('summary').notNull(),
    changes: jsonb('changes')
      .$type<PlanChange[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('plan_revisions_plan_version_idx').on(t.testPlanId, t.version)],
);

/**
 * Asking about the codebase, which nothing could do until now.
 *
 * The agent has had read access to the developer's project since W4 -- `get_index`,
 * `read_file`, `search`, `db` -- and exactly one thing to spend it on. Both draft
 * paths end in a structured-output call whose only legal value is a complete plan,
 * so there was no shape a question could take: an ambiguous brief had one legal
 * answer and it was a confident guess.
 *
 * This is the other thing to spend it on, and the audience it is for is the one
 * that cannot read the code and whose whole job is asking questions about how it
 * behaves. A plan can come out of a conversation; nothing here runs anything.
 */
export const conversations = pgTable(
  'conversations',
  {
    ...identity,
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /**
     * Written from the first exchange rather than typed. Nobody names a question
     * before they have asked it, and an untitled row in a history list cannot be
     * found again.
     */
    title: text('title').notNull(),
    createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    ...stamps,
  },
  /* Ordered by `updatedAt`, because the history list is "most recently spoken in"
     and not "most recently started": a thread returned to after a week belongs at
     the top, and one opened and abandoned does not. */
  (t) => [index('conversations_project_idx').on(t.projectId, t.updatedAt)],
);

/**
 * One turn. A human turn is somebody typing; an agent turn is prose plus the
 * account of how it was arrived at.
 *
 * `steps` is the account, and it stores **what was called, never what came back**.
 * `read_file` returns whole files, so a transcript holding tool results would copy
 * the developer's source into Postgres once per turn and keep it forever. The tool
 * name, its arguments and a one-line digest are the whole of what makes an answer
 * inspectable -- "read api/routes.php, searched for reservation" -- and that is
 * what a developer asking "why did it say that" is actually asking about.
 *
 * `body` on an agent turn *is* the findings. `draft.ts` produces the same prose on
 * every draft and stores it nowhere; a conversation gives it a column, and a plan
 * drafted out of one is handed it as prior context.
 */
export const conversationMessages = pgTable(
  'conversation_messages',
  {
    ...identity,
    conversationId: bigint('conversation_id', { mode: 'number' })
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /* Not `createdAt`: two turns can land in the same millisecond, and a
       conversation replayed out of order is worse than one that failed to save. */
    seq: integer('seq').notNull(),
    author: revisionAuthorEnum('author').notNull(),
    body: text('body').notNull(),
    /** Null on a human turn, which a CHECK enforces along with `modelLabel`. */
    steps: jsonb('steps').$type<AgentStep[]>(),
    /** Which model answered, for the record. Never a key. */
    modelLabel: text('model_label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('conversation_messages_seq_idx').on(t.conversationId, t.seq)],
);

export const testExecutions = pgTable(
  'test_executions',
  {
    ...identity,
    testPlanId: bigint('test_plan_id', { mode: 'number' })
      .notNull()
      .references(() => testPlans.id, { onDelete: 'cascade' }),
    /**
     * Denormalized from the plan on purpose. Every runs query filters by project
     * and none of them wants to join through `test_plans` to do it.
     */
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /**
     * Which version of the plan this run actually ran.
     *
     * No default, so a writer has to say. A run whose version is behind the plan's
     * current one is still a fact, just a fact about older text -- and the runs UI
     * says so, which it can only do if the number is recorded rather than assumed.
     */
    planVersion: integer('plan_version').notNull(),
    status: executionStatusEnum('status').notNull().default('pending'),
    /**
     * Where this run came from. Defaulted to `queued`, which is what every row
     * written before the CLI could report one directly actually was.
     */
    trigger: runTriggerEnum('trigger').notNull().default('queued'),
    dockerContainerId: varchar('docker_container_id', { length: 64 }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    errorMessage: text('error_message'),
    /**
     * Why the state ledger is incomplete, when it is.
     *
     * Never decides the status: the HTTP result stands on its own and the delta is
     * annotation. It exists because an empty ledger otherwise means either "this run
     * changed nothing" or "we could not tell", and those are opposite findings.
     */
    stateNote: text('state_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('test_executions_project_idx').on(t.projectId, t.createdAt),
    index('test_executions_plan_idx').on(t.testPlanId, t.createdAt),
    /**
     * At most one unsettled run per plan, which is the whole concurrency story of
     * queueing. Two clicks on `Ask to run` race, one inserts, the other violates
     * this, and `enqueueRun` reads the violation as "already queued" -- so the
     * second click lands on the run that exists rather than starting a second
     * container for the same plan.
     *
     * Partial over the two unsettled statuses, so it stays the size of what is in
     * flight rather than the size of the history.
     */
    uniqueIndex('test_executions_one_live_idx')
      .on(t.testPlanId)
      .where(sql`status IN ('pending', 'running')`),
  ],
);

export const testResults = pgTable(
  'test_results',
  {
    ...identity,
    executionId: bigint('execution_id', { mode: 'number' })
      .notNull()
      .references(() => testExecutions.id, { onDelete: 'cascade' }),
    /** The step's id inside `test_plans.plan_json`, not a row id. */
    stepId: varchar('step_id', { length: 255 }).notNull(),
    stepName: varchar('step_name', { length: 255 }).notNull(),
    status: stepStatusEnum('status').notNull().default('pending'),
    /**
     * Which of the three columns below mean anything. A `sql` step has no method
     * and no route; a `shell` step has neither and no status either.
     */
    stepKind: stepKindEnum('step_kind').notNull().default('http'),
    requestMethod: varchar('request_method', { length: 10 }),
    /**
     * What went over the wire, variables substituted. Replayable.
     *
     * For a `sql` or `shell` step it is the interpolated statement or command --
     * the same promise, since that is what actually ran.
     */
    requestUrl: text('request_url'),
    /**
     * The same call as a route pattern -- `/checkout/:id/tax`, not
     * `/checkout/ckt_44e2f8/tax`.
     *
     * Coverage, the endpoint pages and a plan's `covers` list are all keyed this
     * way, so without it a step joins to nothing it exercised. It is recorded
     * rather than derived because only the runner holds the template and the
     * values at the same moment; afterwards the plan has moved on.
     *
     * Null for every non-HTTP step, and strictly so: this is what the coverage
     * grid counts, and a sql step proving a row was written is evidence about an
     * endpoint but is not traffic to one.
     */
    routePattern: text('route_pattern'),
    requestBody: jsonb('request_body'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    /** How long the step took. It times a query and a command too. */
    responseTimeMs: integer('response_time_ms'),

    /**
     * A `sql` step's evidence: rows a verification query returned, or rows a
     * fixture moved.
     *
     * Null rather than 0 for the other kinds, because 0 is a real answer and the
     * interesting one -- "the endpoint returned 201 and nothing was written" is
     * the bug this step type exists to catch.
     */
    rowCount: bigint('row_count', { mode: 'number' }),
    /**
     * A `shell` step's exit status. Deliberately not folded into
     * `responseStatus`: exit 0 is success, and HTTP 0 is nothing.
     */
    exitCode: integer('exit_code'),
    /** Stdout from a `shell` step, masked by the runner before it was sent. */
    output: text('output'),

    assertionResults: jsonb('assertion_results'),
    errorMessage: text('error_message'),

    /**
     * The human's read of the failure, which is not the same fact as the failure.
     *
     * Per step, not per execution: a run with four failures can be one real bug
     * and three bad assertions, and collapsing that to one verdict throws away
     * the only judgement anyone made. The read model already keys it this way --
     * `PlanFailureSeed` carries a `stepId`.
     *
     * Null is not 'undecided'. Null means nobody has looked; 'undecided' means
     * somebody looked and could not tell, which is the more interesting fact.
     */
    verdict: failureVerdictEnum('verdict'),
    verdictNote: text('verdict_note'),
    verdictBy: bigint('verdict_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    verdictAt: timestamp('verdict_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('test_results_execution_idx').on(t.executionId, t.id)],
);

/**
 * What a run moved, which is the fact `test_results` cannot hold: a 201 says the
 * request was accepted, not that a row appeared.
 *
 * One table at two scopes. A row with a `testResultId` is that step's margin,
 * measured after it ran; a row without one is the run's own reading, after the last
 * step against before the first. The second is deliberately not the sum of the
 * first -- margins are only taken after steps that could write, so the run reading
 * is what catches a GET that writes. The hotel API's `guest_wallets +1` on a read
 * was found exactly this way.
 *
 * Rows rather than jsonb on `test_results`, because the question this is kept for is
 * an aggregate: "when anything hits POST /rooms, what moves?" -- a GROUP BY over
 * `unit` joined to `route_pattern` across every run.
 *
 * No `public_id`, following `auditLogs`: nothing addresses a ledger row from
 * outside, and this is the table designed to grow without bound.
 */
export const executionState = pgTable(
  'execution_state',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    executionId: bigint('execution_id', { mode: 'number' })
      .notNull()
      .references(() => testExecutions.id, { onDelete: 'cascade' }),
    /** The step whose margin this is. Null is the run's own reading. */
    testResultId: bigint('test_result_id', { mode: 'number' }).references(() => testResults.id, {
      onDelete: 'cascade',
    }),
    seq: integer('seq').notNull(),
    /** A table name, or a watched path for the filesystem units. */
    unit: text('unit').notNull(),
    /** Signed: a delete moving a count down is as much a finding as an insert. */
    rowsMoved: bigint('rows_moved', { mode: 'number' }).notNull(),
    /**
     * The high-water mark either side. Null for a unit that can only be counted --
     * a UUID key has no MAX, so the runner reports the count and leaves these.
     */
    fromValue: text('from_value'),
    toValue: text('to_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('execution_state_execution_idx').on(t.executionId, t.seq)],
);

/**
 * A project's history, which `test_plans.diff_context` could only show through
 * whichever plans happened to quote it. The generate wizard's range picker needs
 * somewhere to browse from and a way to look a commit up by hash.
 *
 * No short hash column: a prefix of a sha is not a second fact about a commit.
 */
export const commits = pgTable(
  'commits',
  {
    ...identity,
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sha: varchar('sha', { length: 40 }).notNull(),
    subject: text('subject').notNull(),
    author: varchar('author', { length: 255 }).notNull(),
    branch: varchar('branch', { length: 255 }).notNull(),
    authoredAt: timestamp('authored_at', { withTimezone: true }).notNull(),
    files: jsonb('files')
      .$type<CommitFile[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The `files` numbers summed. Stored because every list view shows them. */
    additions: integer('additions').notNull().default(0),
    deletions: integer('deletions').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('commits_project_sha_idx').on(t.projectId, t.sha),
    index('commits_project_authored_idx').on(t.projectId, t.authoredAt),
  ],
);

/**
 * The durable half of the web/CLI seam: approved work that nobody is sitting at
 * a socket waiting for, so a partition here is latency rather than failure.
 * Research goes the other way, synchronously over MCP.
 *
 * No `generate_tests` type. Drafting is a conversation that streams to the
 * browser, so it never becomes queued work.
 */
export const jobs = pgTable(
  'jobs',
  {
    ...identity,
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: jobTypeEnum('type').notNull(),
    status: jobStatusEnum('status').notNull().default('pending'),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    result: jsonb('result'),
    /** Which CLI instance holds it. Kept after the job ends: part of what happened. */
    claimedBy: varchar('claimed_by', { length: 255 }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    ...stamps,
  },
  (t) => [
    /**
     * The poll, exactly: the oldest pending job. Partial, so the index stays the
     * size of the backlog rather than the size of the history.
     */
    index('jobs_pending_idx')
      .on(t.createdAt)
      .where(sql`status = 'pending'`),
    index('jobs_project_idx').on(t.projectId, t.createdAt),
  ],
);

export const mockEndpoints = pgTable(
  'mock_endpoints',
  {
    ...identity,
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    method: httpMethodEnum('method').notNull(),
    path: text('path').notNull(),
    responseStatus: integer('response_status').notNull().default(200),
    responseBody: jsonb('response_body')
      .notNull()
      .default(sql`'{}'::jsonb`),
    delayMs: integer('delay_ms').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...stamps,
  },
  /** One mock per route: two rows for the same one is an ambiguity to guess at. */
  (t) => [uniqueIndex('mock_endpoints_route_idx').on(t.projectId, t.method, t.path)],
);

/**
 * The developer's compose file, as a fact.
 *
 * One row per project, replaced whenever the CLI reads the file again. Nobody
 * approves a fact -- what a service is *for* is the judgement in the next table,
 * and keeping the two apart is what lets a new service appear as one new row
 * instead of throwing away decisions somebody already made.
 *
 * There is no document column on purpose. Compose resolves `${MYSQL_ROOT_PASSWORD}`
 * to its value, so the document it prints holds the developer's real secrets; the
 * CLI puts the `${...}` expressions back before it reports anything, and this table
 * holds only the reported shape.
 */
export const projectCompose = pgTable(
  'project_compose',
  {
    ...identity,
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .unique()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Compose's own project name, which is never the one a GritQA copy runs under. */
    projectName: varchar('project_name', { length: 255 }).notNull().default(''),
    /**
     * Covers the resolved document and every Dockerfile it builds from, so it moves
     * when the environment changes and stays put when a controller is edited.
     */
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    /** The files it was read from, in override order. */
    files: jsonb('files')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<string[]>(),
    services: jsonb('services')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<ComposeService[]>(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
    ...stamps,
  },
);

/**
 * What GritQA does with each of those services.
 *
 * This is the one thing in the product that cannot be recomputed from the
 * codebase. "Never boot my tunnel" is intent; it is written nowhere in the source,
 * and no amount of reading the repository produces it. That is precisely why it is
 * approved by a person once and then persisted, rather than derived per run.
 *
 * Superseded, never deleted -- a row records that somebody decided something, and a
 * later decision does not make the earlier one not have happened. The two partial
 * unique indexes in `drizzle/0011` hold the invariant that matters: one approved row
 * and one open proposal per project, so a boot never picks between two answers.
 */
export const projectEnvironments = pgTable(
  'project_environments',
  {
    ...identity,
    projectId: bigint('project_id', { mode: 'number' })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: environmentStatusEnum('status').notNull(),
    /** `config` | `agent` | `approved`. Never GritQA deciding for itself. */
    author: varchar('author', { length: 32 }).notNull(),
    /**
     * The `sandbox.Environment` the CLI decodes, verbatim. The CLI owns the shape
     * and re-validates it against the compose file before every boot, so this column
     * is transport rather than schema -- the web must not be a second opinion about
     * what a valid environment is.
     */
    spec: jsonb('spec').notNull().$type<EnvironmentSpec>(),
    /**
     * The compose fingerprint this was worked out against. A row whose fingerprint
     * has moved is still approved and still boots -- most compose edits move none of
     * it -- but the screen says so.
     */
    fingerprint: varchar('fingerprint', { length: 64 }).notNull().default(''),
    approvedBy: bigint('approved_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    ...stamps,
  },
  (t) => [index('project_environments_project_idx').on(t.projectId, t.createdAt)],
);

/**
 * Append-only, and enforced by triggers in `drizzle/0001_the_rest.sql` rather
 * than by convention. No `public_id` and no `updated_at`: nothing addresses a
 * log row from outside, and a row that could be updated would not be a log.
 *
 * The value columns hold gzip. `entities.md` said gzip-then-base64, which
 * inflates bytes by a third on their way into a column that is already binary.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: bigint('user_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    action: varchar('action', { length: 255 }).notNull(),
    entityType: varchar('entity_type', { length: 255 }).notNull(),
    entityId: bigint('entity_id', { mode: 'number' }),
    oldValues: bytea('old_values'),
    newValues: bytea('new_values'),
    ipAddress: inet('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId, t.id),
    index('audit_logs_user_idx').on(t.userId, t.id),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  files: many(codebaseIndex),
}));

export const codebaseIndexRelations = relations(codebaseIndex, ({ one }) => ({
  project: one(projects, { fields: [codebaseIndex.projectId], references: [projects.id] }),
}));

export type UserRow = typeof users.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type DeviceCodeRow = typeof deviceCodes.$inferSelect;
export type CliInstanceRow = typeof cliInstances.$inferSelect;
export type CodebaseFileRow = typeof codebaseIndex.$inferSelect;
export type TestingRuleRow = typeof testingRules.$inferSelect;
export type TestPlanRow = typeof testPlans.$inferSelect;
export type PlanRevisionRow = typeof planRevisions.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type ConversationMessageRow = typeof conversationMessages.$inferSelect;
export type TestExecutionRow = typeof testExecutions.$inferSelect;
export type TestResultRow = typeof testResults.$inferSelect;
export type ExecutionStateRow = typeof executionState.$inferSelect;
export type CommitRow = typeof commits.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type MockEndpointRow = typeof mockEndpoints.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type ProjectComposeRow = typeof projectCompose.$inferSelect;
export type ProjectEnvironmentRow = typeof projectEnvironments.$inferSelect;
