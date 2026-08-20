-- W5: the machine can be seen, and abandoned work can come back.
--
-- Two problems, one migration, because they are the same problem from either end.
--
-- The first is that `cliConnected` is a lie everywhere it appears. Four places read
-- `projects.last_indexed_at` and render "your machine is connected", which is not
-- what that column knows -- it knows the machine was here *once*. A poll every two
-- seconds is a liveness signal already being sent and thrown away; this is somewhere
-- to keep it.
--
-- The second is a debt `0004` created. A partial unique index over the unsettled
-- statuses means a run stuck `running` blocks its plan from ever being queued again.
-- That is correct while a container is really running and wrong the moment the CLI
-- holding it dies -- which turns a crash into a plan nobody can ever run. So a
-- claimed job has to be able to time out, and timing out needs something to measure
-- against: `jobs.claimed_at`, bumped by every heartbeat.
--
-- One row per machine per project rather than a column on `projects`, because a
-- developer with a laptop and a desktop has two, and a column would have to pick one
-- and call it "the" CLI. It also lets the dashboard say *which* machine, and
-- "connected from studio-mbp, 3s ago" is a better sentence than "connected".

BEGIN;

CREATE TABLE cli_instances (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id    UUID NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- The CLI's own stable name for the machine it runs on, sent on every poll. Not a
  -- secret and not a credential: the bearer token is what authorises the request, and
  -- this only says which of a developer's machines sent it. A CLI that lies about it
  -- can at most impersonate another of the same developer's own machines.
  instance_id  VARCHAR(255) NOT NULL,
  hostname     VARCHAR(255),
  version      VARCHAR(64),
  -- Every authenticated poll moves this. The dashboard's question is "now?", and the
  -- answer is this column against an interval rather than a stored boolean -- nothing
  -- has to write `false` when a laptop lid closes, which is the event nobody gets to
  -- observe.
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The upsert target: one row per machine per project, so a poll is an UPDATE after
-- the first one rather than a growing pile of sightings.
CREATE UNIQUE INDEX cli_instances_identity_idx ON cli_instances (project_id, instance_id);

-- "Is anything connected to this project, and what was it?" -- newest first.
CREATE INDEX cli_instances_seen_idx ON cli_instances (project_id, last_seen_at DESC);

COMMENT ON TABLE cli_instances IS
  'Last-seen per machine per project. Liveness is this column against an interval, never a stored boolean.';

COMMIT;
