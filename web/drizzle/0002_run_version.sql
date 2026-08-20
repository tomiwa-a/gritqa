-- W3: which version of a plan a run actually ran.
--
-- `test_executions` records what happened, and `test_plans.version` records where
-- the plan is now. Neither says whether those are the same thing, and a plan moves
-- after it has been run -- that is what refining is. Without this column a run's
-- result is silently attributed to whatever the plan says today, which is the one
-- reading guaranteed to be wrong for every plan that has been revised.
--
-- The read model has been asking for it in words all along: a run shows a bare
-- "yesterday" when it ran the current text, and "v1, yesterday" when it did not.
-- That prefix is the comparison this column makes possible, and the failure a
-- developer is asked to judge is only judgeable against the version that produced
-- it.

BEGIN;

ALTER TABLE test_executions
  ADD COLUMN plan_version INTEGER NOT NULL DEFAULT 1;

-- The default exists only to fill the rows already there. Leaving it in place
-- would let a future writer omit the version and get a plausible 1 instead of an
-- error, which is exactly the silent misattribution the column is here to stop.
ALTER TABLE test_executions
  ALTER COLUMN plan_version DROP DEFAULT;

ALTER TABLE test_executions
  ADD CONSTRAINT test_executions_plan_version_positive CHECK (plan_version >= 1);

COMMENT ON COLUMN test_executions.plan_version IS
  'The test_plans.version this run executed. Compare with the plan''s current version; equal means the result still describes the plan on screen.';

COMMIT;
