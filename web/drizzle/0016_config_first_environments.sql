-- W16: verdicts move into the config file.
--
-- Environments used to be judged in the dashboard: the compose fact in
-- `project_compose`, the judgement in `project_environments`, proposed by an
-- agent and approved by a person. That loop is gone. Verdicts live in
-- `.gritqa/config.yaml` beside the compose file they judge, written by the
-- human who owns both, checked on every boot. Nothing in the browser proposes,
-- approves, or stores them any more, so neither table has a reader left.

BEGIN;

DROP TABLE IF EXISTS project_environments;
DROP TABLE IF EXISTS project_compose;
DROP TYPE IF EXISTS environment_status;

COMMIT;
