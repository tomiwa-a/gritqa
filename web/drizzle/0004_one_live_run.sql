-- W5: one live run per plan.
--
-- Approving a plan now writes a run, and a run starts life `pending` -- asked for,
-- not yet picked up. That makes double-submitting a real hazard for the first time:
-- a click, a slow round trip, a second click, and the CLI has two containers to
-- start for the same plan and two rows that will each claim to be its last run.
--
-- The guard is an index rather than a check in the writer, for the same reason
-- `movePlanStatus` puts its `from` in the WHERE: two requests that never see each
-- other cannot cooperate, and Postgres is the only thing both of them touch. The
-- writer reads the violation as "already queued" and reports the run that exists,
-- so a second click lands you on the run instead of on an error.
--
-- Partial, over the two unsettled statuses. A plan that has run four hundred times
-- has four hundred settled rows and this index has never held more than one of
-- them; it is the size of what is in flight, not of the history.
--
-- `running` is in the predicate as well as `pending` because the constraint is
-- about the machine, not the queue: a plan already executing must not be handed
-- out again while it holds a container.

BEGIN;

CREATE UNIQUE INDEX test_executions_one_live_idx
  ON test_executions (test_plan_id)
  WHERE status IN ('pending', 'running');

COMMENT ON INDEX test_executions_one_live_idx IS
  'At most one unsettled run per plan. Enqueue reads a violation here as "already queued".';

COMMIT;
