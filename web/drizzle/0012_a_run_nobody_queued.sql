-- Step 2: a run nobody queued, and where it came from.
--
-- Every run in `test_executions` today arrived the same way: somebody clicked
-- `Ask to run`, a job was queued, a machine claimed it, and `completeJob` settled
-- the row that click created. A run started in a terminal -- `gritqa --run
-- some-plan.json` -- goes through `app/run.go`'s `record()` into the CLI's own
-- SQLite and stops there. Delete `.gritqa/cache.db` and it is gone, which is
-- exactly backwards from decision 36: history is shared across a team, it is what
-- the review desk verdicts against, and a per-machine copy cannot see anyone
-- else's runs.
--
-- So the CLI gets a route that records a finished run directly. That makes "how
-- did this run start" a real question for the first time, and one worth answering
-- per row rather than by inference -- especially once Step 4 lets a plan re-run
-- itself on a code change, where the difference between "a person asked for this"
-- and "GritQA asked for this" is the difference between a result and a regression.
--
-- Not `trigger_source`, which already exists and belongs to the plan: that column
-- says how the *plan* came to be written, and it is a different question with a
-- different answer set. A plan drafted from a git push can still be run by hand.

BEGIN;

-- `queued` is the dashboard's own path, and it backfills every row already here.
-- `terminal` is a developer running a plan on their own machine, reported after
-- the fact. `auto` is Step 4: a run GritQA started because the code moved. It has
-- no writer yet and is declared now so the enum does not need altering inside the
-- transaction that first writes one.
CREATE TYPE run_trigger AS ENUM ('queued', 'terminal', 'auto');

ALTER TABLE test_executions
  ADD COLUMN trigger run_trigger NOT NULL DEFAULT 'queued';

COMMENT ON COLUMN test_executions.trigger IS
  'How this run started: queued from the dashboard, terminal on a developer''s machine, or auto because the code moved.';

-- A terminal run is inserted already settled -- it is reported after it finished,
-- so there is no unsettled state to hold. That is what keeps it clear of
-- `test_executions_one_live_idx`, and it is why `started_at` and `completed_at`
-- both arrive in the insert rather than one being filled in later.

COMMIT;
