-- M4c: how a project boots stops being a paste into a YAML file.
--
-- Until now the only way to answer "which of these services is the app" was to
-- hand-edit `run.sandbox.environment` in `.gritqa/config.yaml`. That has three
-- costs, and the third is a safety hole rather than an inconvenience.
--
-- One: a hand edit can be malformed. `room-type-management-e2e.json` is unrunnable
-- to this day because an edit left `{{roomTypeName Updated}}` in it.
--
-- Two: the answer is per-project knowledge that lived on one machine, so a second
-- developer on the same repository worked it out again from nothing.
--
-- Three, and the reason this is a migration rather than a refactor: `docker compose
-- up -d --wait` starts *every* service in the file, so a service nobody classified
-- is one GritQA boots because nothing said otherwise. Measured on a real project,
-- that service was `cloudflared` running `tunnel --no-autoupdate run` against a
-- live token -- booting it would have published GritQA's sandbox to the public
-- internet. There was no way to say "never boot this", because `bootProfiles` can
-- only ever *add* a profile.
--
-- So the environment becomes two rows with two different natures, and keeping them
-- apart is the whole design:
--
--   `project_compose` is a FACT. What the developer's compose file declares, as
--   compose itself resolved it. Nobody approves a fact; it is replaced whenever the
--   file is read again.
--
--   `project_environments` is a JUDGEMENT. What GritQA does with each of those
--   services. It cannot be recomputed from the codebase -- "never boot my tunnel"
--   is intent, and it is written nowhere in the source -- which is exactly why it
--   is approved by a human once and then persisted rather than derived per run.
--
-- Superseded, never deleted. A row records that somebody decided something, and a
-- later decision does not make the earlier one not have happened.

BEGIN;

CREATE TYPE environment_status AS ENUM ('proposed', 'approved', 'superseded');

COMMENT ON TYPE environment_status IS
  'proposed: the agent worked it out and nobody has looked. approved: what a boot reads. superseded: a decision that was replaced, kept for the record.';

-- The compose file, as a fact. One row per project, replaced on push.
--
-- No document column, deliberately. Compose resolves `${MYSQL_ROOT_PASSWORD}` to
-- its value, so the resolved document holds the developer's real secrets; the CLI
-- already puts the `${...}` expressions back before it reports anything, and this
-- table holds only the reported shape. What the screen needs is the service names.
CREATE TABLE project_compose (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id     UUID NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  project_id    BIGINT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  -- Compose's own project name, which is not GritQA's: a copy runs under its own.
  project_name  VARCHAR(255) NOT NULL DEFAULT '',
  -- Covers the resolved document and every Dockerfile it builds from, so it moves
  -- when the environment changes and stays put when source does.
  fingerprint   VARCHAR(64) NOT NULL,
  -- The files it was read from, in override order.
  files         JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{ name, image, build, command, ports, profiles }] -- enough for a human to
  -- recognise a service and for the agent to guess at what it is for.
  services      JSONB NOT NULL DEFAULT '[]'::jsonb,
  read_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER project_compose_set_updated_at BEFORE UPDATE ON project_compose
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The judgement.
CREATE TABLE project_environments (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id     UUID NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  project_id    BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status        environment_status NOT NULL,
  -- config | agent | approved. Never GritQA deciding for itself.
  author        VARCHAR(32) NOT NULL,
  -- The `sandbox.Environment` the CLI decodes, verbatim. The CLI owns this shape
  -- and validates it against the compose file before a boot, so the column is the
  -- transport and not the schema.
  spec          JSONB NOT NULL,
  -- The compose fingerprint this was worked out against. A row whose fingerprint
  -- no longer matches is still approved and still boots -- most compose edits move
  -- none of it -- but the screen says so, and a new service shows up as one new row
  -- rather than as a reason to throw the decision away.
  fingerprint   VARCHAR(64) NOT NULL DEFAULT '',
  approved_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER project_environments_set_updated_at BEFORE UPDATE ON project_environments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX project_environments_project_idx ON project_environments(project_id, created_at DESC);

-- One live answer and one open proposal per project, enforced rather than assumed.
-- Two approved rows would mean a boot picking whichever the planner returned first,
-- and two proposals would mean approving one and leaving the other on screen.
CREATE UNIQUE INDEX project_environments_one_approved_idx
  ON project_environments(project_id) WHERE status = 'approved';
CREATE UNIQUE INDEX project_environments_one_proposed_idx
  ON project_environments(project_id) WHERE status = 'proposed';

COMMIT;
