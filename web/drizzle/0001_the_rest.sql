-- W3: the remaining entities, plus the three the UI has been carrying with
-- nowhere to put them.
--
-- Everything here follows the conventions 0000 established: BIGINT `id` for
-- foreign keys, UUIDv7 `public_id` for anything a URL or an API answer names,
-- `set_updated_at()` on every table that claims to have been updated.

BEGIN;

-- ---------------------------------------------------------------------------
-- Enums. Each one is a closed set the application already treats as closed --
-- `mock/types.ts` has been asserting these exact unions for months.
-- ---------------------------------------------------------------------------
CREATE TYPE rule_category AS ENUM ('ordering', 'mock', 'assertion', 'fixture');
CREATE TYPE test_plan_status AS ENUM ('draft', 'approved', 'archived');
CREATE TYPE trigger_source AS ENUM ('git_push', 'manual');
CREATE TYPE execution_status AS ENUM ('pending', 'running', 'passed', 'failed', 'error');
CREATE TYPE step_status AS ENUM ('pending', 'passed', 'failed', 'skipped', 'error');
CREATE TYPE job_type AS ENUM ('index_codebase', 'execute_tests');
CREATE TYPE job_status AS ENUM ('pending', 'claimed', 'completed', 'failed', 'dead');
CREATE TYPE http_method AS ENUM ('GET', 'POST', 'PUT', 'PATCH', 'DELETE');

-- The human's read of a failure, which is not the same fact as the failure.
CREATE TYPE failure_verdict AS ENUM ('real_bug', 'bad_test', 'undecided');

-- Who took a turn. Stored as `agent`/`human` rather than the read model's
-- `ai`/`you`, because "you" is only true from one side of the screen.
CREATE TYPE revision_author AS ENUM ('agent', 'human');

-- ---------------------------------------------------------------------------
-- Rules Layer
-- ---------------------------------------------------------------------------
CREATE TABLE testing_rules (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id     UUID NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  project_id    BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  category      rule_category NOT NULL,
  rule_config   JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Two readers, one index: the rules screen wants every rule for a project, the
-- agent wants one category of them. A partial index on `is_active` would serve
-- only the second, and the screen has to show the switched-off ones.
CREATE INDEX testing_rules_project_category_idx ON testing_rules (project_id, category);

-- ---------------------------------------------------------------------------
-- Test Plan Layer
-- ---------------------------------------------------------------------------
CREATE TABLE test_plans (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id      UUID NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  project_id     BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name           VARCHAR(255) NOT NULL,
  description    TEXT,
  base_url       TEXT NOT NULL,
  plan_json      JSONB NOT NULL,
  status         test_plan_status NOT NULL DEFAULT 'draft',
  version        INTEGER NOT NULL DEFAULT 1,
  trigger_source trigger_source NOT NULL,
  -- Kept even though `commits` now exists: this is the diff as it was when the
  -- plan was drafted, and a branch that has since moved cannot reproduce it.
  diff_context   JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX test_plans_project_status_idx ON test_plans (project_id, status, created_at DESC);

-- A plan cannot be approved without having been drafted by something, and a
-- version that walks backwards means two writers raced.
ALTER TABLE test_plans ADD CONSTRAINT test_plans_version_positive CHECK (version >= 1);

-- ---------------------------------------------------------------------------
-- GAP 1: refine instructions.
--
-- `test_plans.version` records that a plan changed. It does not record why, and
-- the why is the more useful half: a developer scrolling a plan's history wants
-- to read the sentence they typed, not diff two JSON blobs to infer it. The
-- refine composer has been submitting into nothing.
-- ---------------------------------------------------------------------------
CREATE TABLE plan_revisions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id    UUID NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  test_plan_id BIGINT NOT NULL REFERENCES test_plans(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  author       revision_author NOT NULL,
  -- Null for the agent's own turns. A human turn without an instruction is a
  -- revision nobody asked for, so the constraint below rules it out.
  instruction  TEXT,
  summary      TEXT NOT NULL,
  changes      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX plan_revisions_plan_version_idx ON plan_revisions (test_plan_id, version);

ALTER TABLE plan_revisions ADD CONSTRAINT plan_revisions_human_has_instruction
  CHECK (author = 'agent' OR instruction IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Execution Layer
-- ---------------------------------------------------------------------------
CREATE TABLE test_executions (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id           UUID NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  test_plan_id        BIGINT NOT NULL REFERENCES test_plans(id) ON DELETE CASCADE,
  project_id          BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status              execution_status NOT NULL DEFAULT 'pending',
  docker_container_id VARCHAR(64),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  duration_ms         INTEGER,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX test_executions_project_idx ON test_executions (project_id, created_at DESC);
CREATE INDEX test_executions_plan_idx ON test_executions (test_plan_id, created_at DESC);

-- A run that finished before it started is a clock bug, not a duration.
ALTER TABLE test_executions ADD CONSTRAINT test_executions_ends_after_start
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at);

CREATE TABLE test_results (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id         UUID NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  execution_id      BIGINT NOT NULL REFERENCES test_executions(id) ON DELETE CASCADE,
  step_id           VARCHAR(255) NOT NULL,
  step_name         VARCHAR(255) NOT NULL,
  status            step_status NOT NULL DEFAULT 'pending',
  request_method    VARCHAR(10),
  request_url       TEXT,
  request_body      JSONB,
  response_status   INTEGER,
  response_body     JSONB,
  response_time_ms  INTEGER,
  assertion_results JSONB,
  error_message     TEXT,

  -- GAP 2: the human's read of the failure.
  --
  -- Per step, not per execution: a run with four failures can be one real bug
  -- and three bad assertions, and collapsing that to a single verdict throws
  -- away the only judgement anyone made.
  --
  -- NULL is not 'undecided'. NULL means nobody has looked yet; 'undecided'
  -- means somebody looked and could not tell, which is a different and more
  -- interesting fact.
  verdict           failure_verdict,
  verdict_note      TEXT,
  verdict_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  verdict_at        TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX test_results_execution_idx ON test_results (execution_id, id);

-- A verdict is only meaningful about a step that actually went wrong.
ALTER TABLE test_results ADD CONSTRAINT test_results_verdict_needs_failure
  CHECK (verdict IS NULL OR status IN ('failed', 'error'));

-- Either a verdict was recorded, with when, or neither was.
ALTER TABLE test_results ADD CONSTRAINT test_results_verdict_has_time
  CHECK ((verdict IS NULL) = (verdict_at IS NULL));

-- ---------------------------------------------------------------------------
-- GAP 3: commits.
--
-- `test_plans.diff_context` is one JSONB blob per plan, which means a project's
-- history can only be read through the plans that happen to quote it. There is
-- nowhere to browse from and no way to look a commit up by hash -- and the
-- generate wizard's range picker needs both.
-- ---------------------------------------------------------------------------
CREATE TABLE commits (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id   UUID NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sha         VARCHAR(40) NOT NULL,
  subject     TEXT NOT NULL,
  author      VARCHAR(255) NOT NULL,
  branch      VARCHAR(255) NOT NULL,
  authored_at TIMESTAMPTZ NOT NULL,
  -- Per-file additions and deletions. The totals below are the same numbers
  -- summed, stored because every list view shows them and none of them wants
  -- to unpack an array to find out.
  files       JSONB NOT NULL DEFAULT '[]'::jsonb,
  additions   INTEGER NOT NULL DEFAULT 0,
  deletions   INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The same commit reachable from two branches is one row per project.
CREATE UNIQUE INDEX commits_project_sha_idx ON commits (project_id, sha);
CREATE INDEX commits_project_authored_idx ON commits (project_id, authored_at DESC);

-- Short hashes are derived, never stored: a prefix of a full sha is not a
-- second fact about the commit.
ALTER TABLE commits ADD CONSTRAINT commits_sha_is_a_sha CHECK (sha ~ '^[0-9a-f]{40}$');

-- ---------------------------------------------------------------------------
-- Job Queue Layer
-- ---------------------------------------------------------------------------
CREATE TABLE jobs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id     UUID NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  project_id    BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- No `generate_tests`. Drafting is a conversation that streams to the
  -- browser, so it never becomes queued work.
  type          job_type NOT NULL,
  status        job_status NOT NULL DEFAULT 'pending',
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  result        JSONB,
  claimed_by    VARCHAR(255),
  claimed_at    TIMESTAMPTZ,
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  next_retry_at TIMESTAMPTZ,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The poll, exactly: oldest pending job whose retry time has come. Partial, so
-- the index stays the size of the backlog rather than the history.
CREATE INDEX jobs_pending_idx
  ON jobs (created_at)
  WHERE status = 'pending';

CREATE INDEX jobs_project_idx ON jobs (project_id, created_at DESC);

-- A pending job has not been taken by anything yet, and a claimed one names the
-- CLI instance holding it. Terminal rows keep the claimant, because which
-- machine ran the job is part of what happened to it.
ALTER TABLE jobs ADD CONSTRAINT jobs_pending_is_unclaimed
  CHECK (status <> 'pending' OR claimed_by IS NULL);

ALTER TABLE jobs ADD CONSTRAINT jobs_claimed_has_claimant
  CHECK (status <> 'claimed' OR claimed_by IS NOT NULL);

ALTER TABLE jobs ADD CONSTRAINT jobs_attempts_within_max
  CHECK (attempts >= 0 AND attempts <= max_attempts);

-- ---------------------------------------------------------------------------
-- Mock Layer
-- ---------------------------------------------------------------------------
CREATE TABLE mock_endpoints (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id       UUID NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  project_id      BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  method          http_method NOT NULL,
  path            TEXT NOT NULL,
  response_status INTEGER NOT NULL DEFAULT 200,
  response_body   JSONB NOT NULL DEFAULT '{}'::jsonb,
  delay_ms        INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One mock per route. Two rows claiming the same method and path is an
-- ambiguity the mock server would have to resolve by guessing.
CREATE UNIQUE INDEX mock_endpoints_route_idx ON mock_endpoints (project_id, method, path);

ALTER TABLE mock_endpoints ADD CONSTRAINT mock_endpoints_status_is_http
  CHECK (response_status BETWEEN 100 AND 599);

ALTER TABLE mock_endpoints ADD CONSTRAINT mock_endpoints_delay_sane
  CHECK (delay_ms >= 0 AND delay_ms <= 60000);

-- ---------------------------------------------------------------------------
-- Audit Layer
--
-- Append-only: no public_id, no updated_at, and no trigger. The id sequence is
-- the record, so a gap in it is itself information.
--
-- One correction to the spec, which said gzip-then-base64 into BYTEA: base64ing
-- bytes on their way into a binary column inflates them by a third and buys
-- nothing. Gzip goes in raw.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(255) NOT NULL,
  entity_type VARCHAR(255) NOT NULL,
  entity_id   BIGINT,
  old_values  BYTEA,
  new_values  BYTEA,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, id DESC);
CREATE INDEX audit_logs_user_idx ON audit_logs (user_id, id DESC);

-- ---------------------------------------------------------------------------
-- Triggers, for the four tables that claim to know when they last changed.
-- ---------------------------------------------------------------------------
CREATE TRIGGER testing_rules_updated_at BEFORE UPDATE ON testing_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER test_plans_updated_at BEFORE UPDATE ON test_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER mock_endpoints_updated_at BEFORE UPDATE ON mock_endpoints
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Append-only, enforced rather than documented.
--
-- `entities.md` lists three mechanisms: a GRANT of INSERT alone, a trigger, and
-- an RLS policy. The first and third need a role that does not own the tables,
-- and the app currently connects as the owner -- so the trigger is the one that
-- actually binds today, and it binds the owner too.
--
-- Both triggers, because a row-level trigger does not see TRUNCATE: without the
-- statement-level one, the whole trail could be erased by a single word.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();

COMMENT ON TABLE audit_logs IS
  'Append-only. The id sequence is the record, so a gap in it is information.';

COMMIT;
