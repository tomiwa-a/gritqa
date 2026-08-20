-- W3: which endpoint a step called, in the form the rest of the app talks about.
--
-- `request_url` is the URL that went over the wire, with variables substituted:
-- `/checkout/ckt_44e2f8/tax`. That is the right thing to record -- it is what
-- actually happened, and it can be replayed -- but it joins to nothing. Coverage
-- squares, the endpoint pages and a plan's `covers` list are all keyed by route
-- pattern, so a step that ran against `/checkout/ckt_44e2f8/tax` never matches the
-- `/checkout/:id/tax` square it just exercised, and a failing endpoint reads clean.
--
-- The pattern cannot be recovered later. It is a property of the plan text the run
-- executed, and that text moves: `plan_revisions` keeps the narrative of a revision,
-- not the body, so once a plan reaches v2 there is no v1 to read a v1 run's steps
-- out of. The runner is the only party that ever holds both the template and the
-- values, which makes write time the only honest place to record it.
--
-- Nullable, because a row written before this column existed has no answer and
-- guessing one from the substituted URL would mean deciding which segments were
-- variables -- which is exactly the information that was lost.
ALTER TABLE test_results ADD COLUMN route_pattern TEXT;

COMMENT ON COLUMN test_results.route_pattern IS
  'Route pattern the step exercised (POST /checkout/:id/tax), for joining a run to coverage. request_url holds the substituted URL.';
