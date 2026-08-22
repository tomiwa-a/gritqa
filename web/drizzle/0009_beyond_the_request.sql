-- W7: a step is no longer necessarily a request.
--
-- Every assertion a plan could make was on the response of the thing under test,
-- which is partly circular: it trusts the code's own report of what it did.
-- `POST ...&action=processBag` returning `201` is not evidence that a row landed
-- in `bookings`, and "returned 201, wrote nothing" is exactly the class of bug a
-- QA person is hired to catch and could not.
--
-- Two step kinds close that. A `sql` step is out-of-band evidence -- assertions
-- over a result set, and writes for fixtures, so a plan stops spending its first
-- three steps on a guest login whose failure reads as a failure of the feature
-- under test. A `shell` step is the setup no API exposes: a migration, a cache
-- clear, a seeder. Both run inside GritQA's own container against GritQA's own
-- copy of the database, never the developer's.
--
-- `test_results` already tolerated a non-HTTP step by accident: `request_method`
-- is a plain varchar rather than the enum, and it, `request_url` and
-- `route_pattern` are all nullable. What it had no room for is the evidence.

BEGIN;

CREATE TYPE step_kind AS ENUM ('http', 'sql', 'shell');

-- NOT NULL DEFAULT 'http' backfills truthfully: every row already here was a
-- request, because there was nothing else a step could be.
ALTER TABLE test_results ADD COLUMN step_kind step_kind NOT NULL DEFAULT 'http';

COMMENT ON COLUMN test_results.step_kind IS
  'What this step was. http has a method, a route and a status; sql has rows; shell has an exit code and output.';

-- A sql step's evidence: rows a verification query came back with, or rows a
-- fixture moved. BIGINT to match execution_state.rows_moved, and nullable rather
-- than defaulted to 0, because zero rows is the finding this whole step type
-- exists to surface and must not be indistinguishable from "not a sql step".
ALTER TABLE test_results ADD COLUMN row_count BIGINT;

COMMENT ON COLUMN test_results.row_count IS
  'Rows a sql step queried or moved. NULL for other kinds -- 0 is a real answer and the interesting one.';

-- Deliberately not folded into response_status. An exit code of 0 must never
-- render as HTTP 0, and the coverage query reads response_status.
ALTER TABLE test_results ADD COLUMN exit_code INTEGER;

COMMENT ON COLUMN test_results.exit_code IS
  'A shell step''s exit status. Never response_status: exit 0 is success and HTTP 0 is nothing.';

-- What a shell step printed, already masked by the runner. A column rather than a
-- corner of response_body jsonb, for the same reason route_pattern is one: the run
-- list needs it without decoding a blob.
ALTER TABLE test_results ADD COLUMN output TEXT;

COMMENT ON COLUMN test_results.output IS
  'Stdout from a shell step, masked. stderr is not kept -- its last line becomes error_message.';

-- Two columns that no longer mean quite what their names say, and are not renamed
-- because renaming them would rewrite four read paths for a word:
--
--   response_time_ms is now the measured duration of any step, response or not.
--   request_url now holds the interpolated statement or command for a non-HTTP
--   step -- which is the same promise it always made: what actually went out,
--   variables substituted, replayable.
--
-- route_pattern is the one that stays strict. It is what the coverage grid counts,
-- so it is NULL for every non-HTTP step: a sql step proving a row was written is
-- evidence about an endpoint, but it is not traffic to one.
COMMENT ON COLUMN test_results.request_url IS
  'What went over the wire, variables substituted. For a sql or shell step, the statement or command that ran.';

COMMENT ON COLUMN test_results.response_time_ms IS
  'How long the step took. Named for the HTTP case it was written for; it times a query and a command too.';

COMMIT;
