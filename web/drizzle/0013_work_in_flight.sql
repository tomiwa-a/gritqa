-- Step 3: work that outlives the click that started it.
--
-- Drafting a plan takes a research pass over the developer's code, a write, and a
-- verify -- a minute or two of model calls. Today all three happen inside
-- `draftPlanAction`, which means the browser holds a request open for the whole
-- thing and the developer sits on a spinner. Navigate away and the work is gone
-- along with the answer. `refinePlanAction` and `askAction` are the same shape.
--
-- So the agent's work becomes queued work, like a run already is. That needs two
-- things the `jobs` table cannot express yet.
--
-- First, the types. `job_type` has exactly the two kinds of errand a CLI on a
-- developer's machine can carry out, and `claimNextJob` selects the oldest pending
-- job with no filter on type at all -- so an agent job sitting in this table would
-- be handed to the poller, refused by `attach.go`'s "this machine does not know
-- what a X job is", and dead after three attempts. Naming the new types here is
-- half the fix; the other half is the filter, which belongs in the query.
--
-- Second, the record of what the agent did while it was working. A job in flight is
-- currently opaque -- pending or claimed, and nothing else until a result lands --
-- and for a run that is fine, because the CLI streams its steps over a separate
-- channel. The agent has no such channel, and the whole point of moving the work off
-- the request is that somebody can close the tab. `job_events` is what they come back
-- to: one row per thing that happened, written as it happened.
--
-- It is also the resume path, which is why it is a table rather than a log line.
-- Research is the expensive phase and its entire output is one block of text, so a
-- job whose web process died after reading the code but before writing the plan can
-- be picked up and finished from the event that recorded it -- instead of paying for
-- the reading twice.

BEGIN;

-- The three things the agent does. `answer_question` is one turn of the ask panel;
-- the other two are the drafting paths. Added as values rather than a second enum
-- because they are queued work in the same table, competing for nothing: a machine
-- claims by type and so does the web.
--
-- Not used anywhere in this transaction, which is the condition Postgres puts on
-- adding an enum value inside one.
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'draft_plan';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'refine_plan';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'answer_question';

-- Who asked. A machine job has no requester -- it is the poller's own errand -- so
-- this is nullable rather than defaulted, and `ON DELETE SET NULL` because the work
-- and what it produced outlive the account that asked for it.
ALTER TABLE jobs
  ADD COLUMN requested_by bigint REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN jobs.requested_by IS
  'The person who asked for this work. Null for a machine''s own errand.';

CREATE TABLE job_events (
  id         bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  public_id  uuid NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  job_id     bigint NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  -- Ordering within the job. `created_at` cannot do this job on its own: two tool
  -- calls can land in the same millisecond, and the order they ran in is the thing
  -- a reader is trying to follow.
  seq        integer NOT NULL,
  -- Which part of the agent's work this came out of: research, write, verify, save.
  -- A varchar rather than an enum, because the phases are the agent loop's shape
  -- and that shape is still moving -- a new phase should not need a migration.
  phase      varchar(24) NOT NULL,
  -- What kind of thing happened: a tool call, a model turn, a note, or the findings
  -- block a resume reads back.
  kind       varchar(24) NOT NULL,
  -- One line, in the words a developer reads. "Searched for refund handlers".
  label      text NOT NULL,
  -- Whatever the line does not carry: a tool's arguments, an error, the findings
  -- text itself. Shapes are the writer's business, same as `jobs.payload`.
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Both reads this table has: everything for one job, in order. Unique because `seq`
-- is assigned from the count of rows already there, so a duplicate would mean two
-- writers on one job -- which is exactly the condition the lease exists to prevent,
-- and worth a constraint violation rather than a silently interleaved transcript.
CREATE UNIQUE INDEX job_events_seq_idx ON job_events (job_id, seq);

COMMENT ON TABLE job_events IS
  'What the agent did while a job ran, written as it happened. Read by the work page, and by a resume.';

COMMIT;
