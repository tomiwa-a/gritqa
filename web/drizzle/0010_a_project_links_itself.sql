-- Adding a project is a thing a developer does from their terminal.
--
-- Nothing in the app has ever inserted a `projects` row: the device flow could
-- only link a machine to a project that already existed, so a second checkout on
-- the same machine had nowhere to go and quietly reported into the first one.
--
-- The CLI already knows everything a project row needs -- it read the config and
-- the git remote to get here -- so it sends them with the link request and the
-- approval screen shows a human what it is about to add. These three columns are
-- what it sends: a proposal attached to a code, worth nothing until someone
-- signed in says yes.

BEGIN;

ALTER TABLE device_codes ADD COLUMN project_name   VARCHAR(255);
ALTER TABLE device_codes ADD COLUMN repo_url       TEXT;
ALTER TABLE device_codes ADD COLUMN default_branch VARCHAR(255);

COMMIT;
