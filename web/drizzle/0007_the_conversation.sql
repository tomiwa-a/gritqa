-- Conversation: asking about the codebase, and drafting as something you arrive at.
--
-- Until now the agent's tools -- get_index, read_file, search, db -- could only be
-- spent on one thing: producing a plan. Both draft paths end in a structured-output
-- call whose only legal value is a complete plan, so a question has no way to be
-- asked and an ambiguous brief has exactly one legal answer, which is a confident
-- guess. That is where `guest@example.com` came from: asked to sign in as a guest,
-- with no channel to ask *which* guest, inventing one was the only move the format
-- allowed.
--
-- These two tables are the channel. A conversation is prose in and prose out over
-- the same read-only tools, and drafting becomes something a conversation can
-- produce rather than the only thing the agent can do.

BEGIN;

CREATE TABLE conversations (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id   UUID NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Written from the first exchange, never typed. Nobody names a question before
  -- they have asked it, and an untitled row in a history list is unfindable.
  title       TEXT NOT NULL,
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The history list is "my conversations, most recently spoken in first", which is
-- `updated_at` and not `created_at`: a thread returned to after a week belongs at
-- the top, and one started and abandoned does not.
CREATE INDEX conversations_project_idx ON conversations (project_id, updated_at DESC);

CREATE TRIGGER conversations_set_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE conversations IS
  'A thread of questions about one project''s codebase. Plans can come out of one; nothing here runs anything.';

CREATE TABLE conversation_messages (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id       UUID NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  -- Ordering, and not `created_at`: two messages can land in the same millisecond,
  -- and a conversation read back in the wrong order is worse than one that failed
  -- to save. Same reasoning as execution_state.seq.
  seq             INTEGER NOT NULL,
  -- Reuses `revision_author`. plan_revisions already carries the argument for why
  -- this is agent/human and not the read model's ai/you -- "you" is only true from
  -- one side of the screen -- and one vocabulary across both tables is worth more
  -- than their independence.
  author          revision_author NOT NULL,
  body            TEXT NOT NULL,
  -- What the agent did to answer, in the order it did it: the tool it called, the
  -- arguments, and a one-line digest of what came back.
  --
  -- The digest, and never the payload. `read_file` returns whole files, so a
  -- transcript that stored tool *results* would copy the developer's source into
  -- Postgres once per turn and keep it -- a table that is a liability rather than a
  -- record. The path, the byte count and the row count are the whole of what makes
  -- an answer inspectable: "read api/routes.php, searched for reservation".
  steps           JSONB,
  -- Which model wrote it. Never a key. NULL on a human turn, like `steps`.
  model_label     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX conversation_messages_seq_idx
  ON conversation_messages (conversation_id, seq);

-- A human turn is somebody typing, so it has no tools and no model. An agent turn
-- has both. Stated as a constraint because the panel branches on it: a row with a
-- model label and the author 'human' would render a person's question as GritQA's
-- answer.
ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_author_shape
  CHECK (
    (author = 'human' AND steps IS NULL AND model_label IS NULL)
    OR (author = 'agent' AND model_label IS NOT NULL)
  );

COMMENT ON COLUMN conversation_messages.body IS
  'The turn itself. On an agent turn this is its account of what it read, which is what a draft started from this conversation is handed as prior context.';

-- Where a plan came from, when it came from a conversation.
--
-- One direction only. A plan knowing its origin is useful now; a conversation
-- knowing which plan it is *about* is the hook for folding the refine thread into
-- this substrate later, and a column nothing reads is a column that goes stale.
-- Add it when that merge happens.
--
-- `trigger_source` stays `manual`: a person still asked. This carries the nuance
-- that they arrived at it by talking rather than by filling in a box.
ALTER TABLE test_plans
  ADD COLUMN conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL;

COMMENT ON COLUMN test_plans.conversation_id IS
  'The conversation this plan was drafted out of, when it was. NULL for the wizard and for pushes.';

COMMIT;
