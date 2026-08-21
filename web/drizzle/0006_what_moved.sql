-- W6: what moved.
--
-- A run's whole point is the state it changed, and nothing in Postgres records it.
-- `test_results` can say a POST returned 201; it cannot say whether a row appeared.
-- A green run that touched nothing is the failure this closes, and the finding it
-- makes possible is one no amount of reading source produces: M4's live pass against
-- the hotel API turned up `guest_wallets +1` on a **GET**, because that endpoint
-- creates a wallet on read.
--
-- One table at two scopes, told apart by whether `test_result_id` is set. A row with
-- a step is that step's margin, measured after it ran. A row without one is the run's
-- own reading -- after the last step, against before the first. The second is not the
-- sum of the first, and the gap is the interesting part: margins are only taken after
-- steps that could write, so the run reading is what catches a GET that does. Two
-- tables would state the same fact twice and lose that they are one measurement taken
-- at two scales.
--
-- Rows rather than jsonb on `test_results`, because the question this is kept for is
-- "when anything hits POST /rooms, what moves?" -- an aggregate over `unit` joined to
-- `route_pattern` across every run. That is a GROUP BY, and `jsonb_to_recordset` in
-- the middle of one is a worse version of a table.
--
-- No `public_id` and no `updated_at`, following `audit_logs`: nothing addresses a
-- ledger row from outside, it is only ever read as the set belonging to one run, and
-- this is the table in the schema designed to grow without bound.

BEGIN;

CREATE TABLE execution_state (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  execution_id   BIGINT NOT NULL REFERENCES test_executions(id) ON DELETE CASCADE,
  -- The step whose margin this is, or NULL for the run's own reading.
  test_result_id BIGINT REFERENCES test_results(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  -- A table name, or a watched path for the filesystem units.
  unit           TEXT NOT NULL,
  -- Signed: a delete moving a count down is as much a finding as an insert moving
  -- it up.
  rows_moved     BIGINT NOT NULL,
  -- The high-water mark either side. NULL for a unit that can only be counted -- a
  -- UUID key has no MAX, so the runner reports the count and leaves these alone.
  from_value     TEXT,
  to_value       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One index, because there is one read: a run's whole ledger in recorded order. The
-- run view groups it by `test_result_id` in memory rather than asking twice, so a
-- second index would be paid for on every write and used by nothing.
CREATE INDEX execution_state_execution_idx ON execution_state (execution_id, seq);

COMMENT ON TABLE execution_state IS
  'What a run moved. With test_result_id it is that step''s margin; without one it is the whole run''s reading, which is deliberately not their sum.';

-- Why a ledger is empty, when the answer is not "nothing moved".
--
-- A reading can fail: no sandbox watching, a dropped connection, a unit that could
-- not be counted. That never changes the run's status -- the HTTP result stands on
-- its own and the delta is annotation -- but with nowhere to say so, an empty ledger
-- means either "this run changed nothing" or "we could not tell", and those are
-- opposite findings.
ALTER TABLE test_executions ADD COLUMN state_note TEXT;

COMMENT ON COLUMN test_executions.state_note IS
  'Why the state ledger is incomplete, when it is. Never decides the run status.';

COMMIT;
