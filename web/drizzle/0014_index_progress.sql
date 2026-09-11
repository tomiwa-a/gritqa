-- W14: the machine narrates its index pass while it runs.
--
-- The poll already arrives every two seconds and the heartbeat every thirty;
-- both are liveness signals being sent and thrown away. The CLI's index pass
-- reports staged counters into a live object anyway (list, hash, static, AI,
-- link, plus current file and failures with reasons), so the latest label
-- rides on traffic that already exists rather than inventing a new timer.
--
-- One JSONB column, overwritten on every sighting, never read for correctness:
-- the mirror stays the record and this is only the narration. A machine that
-- stops polling keeps its last label until it polls again, which is exactly
-- what "last seen" already means for every other column on this row.

BEGIN;

ALTER TABLE cli_instances ADD COLUMN progress JSONB;

COMMENT ON COLUMN cli_instances.progress IS
  'Latest index-pass label from this machine: stage, counters, current file, failures. Narration only, never correctness-bearing.';

COMMIT;
