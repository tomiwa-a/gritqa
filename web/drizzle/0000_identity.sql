-- W2: identity. Users, the projects they own, the index mirror those projects
-- get counted from, and one row per CLI sign-in attempt.
--
-- Written by hand rather than generated. Three things here cannot come out of
-- `drizzle-kit generate`: the UUIDv7 default, the `updated_at` triggers, and the
-- comments explaining why a column exists. Generated SQL would drop all three on
-- the next regeneration.

BEGIN;

-- ---------------------------------------------------------------------------
-- UUIDv7, because this is Postgres 16
--
-- Postgres ships `uuidv7()` from 18 onward. Until then the dual-ID pattern needs
-- its own, and v4 will not do: a public id is the primary key of every URL and
-- API response, so it is read and written constantly, and a random id scatters
-- inserts across the whole B-tree. v7 puts a millisecond timestamp in the leading
-- 48 bits, so ids sort by creation and new rows land at the right edge of the
-- index instead of dirtying a random page each time.
--
-- Built by taking a v4 from `gen_random_uuid()` -- which already has a
-- cryptographic random tail and correct variant bits -- overlaying the timestamp
-- over its first six bytes, and rewriting the version nibble from 4 to 7.
--
-- On the bit numbers: for bytea, `set_bit` numbers bit 0 as the *least*
-- significant bit of byte 0, so byte 6 spans bits 48..55 and the version nibble
-- sits in 52..55. v4 leaves that nibble as 0100; setting bits 52 and 53 makes it
-- 0111, which is 7.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid AS $$
BEGIN
  RETURN encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(
            int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint)
            FROM 3
          )
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
END
$$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION uuid_generate_v7() IS
  'Time-ordered UUID for public_id columns. Replace with the built-in uuidv7() on Postgres 18+.';

-- `updated_at` maintained by the database, not by the application. An UPDATE that
-- forgets to touch it is the normal way this column goes stale, and every write
-- path would have to remember. One trigger cannot forget.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
CREATE TYPE provider AS ENUM ('github', 'gitlab');
CREATE TYPE project_status AS ENUM ('active', 'archived');
CREATE TYPE device_code_status AS ENUM ('pending', 'approved', 'denied', 'claimed');

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id    uuid NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  email        varchar(255) NOT NULL UNIQUE,
  name         varchar(255) NOT NULL,
  avatar_url   text,
  provider     provider NOT NULL,
  provider_id  varchar(255) NOT NULL,
  ai_api_key   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The identity a provider hands back is (provider, provider_id), not the email:
-- emails change and can be reassigned, provider ids cannot. Unique on the pair,
-- so the same account arriving twice updates one row instead of forking into two.
CREATE UNIQUE INDEX users_provider_identity_idx ON users (provider, provider_id);

COMMENT ON COLUMN users.ai_api_key IS
  'AES-256-GCM ciphertext. Never selected into a page -- only hasAiKey and a masked tail.';

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
CREATE TABLE projects (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id       uuid NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  user_id         bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name            varchar(255) NOT NULL,
  repo_url        text,
  local_path      text NOT NULL,
  default_branch  varchar(255) NOT NULL DEFAULT 'main',
  status          project_status NOT NULL DEFAULT 'active',
  last_indexed_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX projects_user_idx ON projects (user_id);

-- A project is identified by where it lives on disk. Registering the same
-- directory twice is the CLI being run twice in the same repo, not a new project.
CREATE UNIQUE INDEX projects_user_local_path_idx ON projects (user_id, local_path);

COMMENT ON COLUMN projects.local_path IS
  'Absolute path on the developer machine. Stored to match the CLI to a project; the web app never reads from it.';

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- codebase_index
--
-- A mirror, not a source. The CLI's SQLite sits beside the files and can answer
-- about the working tree as it is right now; this table is what it pushed the
-- last time it ran. Nothing correctness-bearing reads from it -- it exists so the
-- dashboard has something to render, and so a project's file count is a count
-- rather than a stored number that drifts.
-- ---------------------------------------------------------------------------
CREATE TABLE codebase_index (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id       uuid NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  project_id      bigint NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  file_path       text NOT NULL,
  file_hash       varchar(64) NOT NULL,
  language        varchar(50) NOT NULL,
  symbols         jsonb NOT NULL DEFAULT '[]'::jsonb,
  dependencies    jsonb NOT NULL DEFAULT '[]'::jsonb,
  endpoints       jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_indexed_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX codebase_index_project_file_idx ON codebase_index (project_id, file_path);

COMMENT ON COLUMN codebase_index.file_hash IS
  'SHA-256 of file contents. The CLI compares it to decide what to re-parse.';

CREATE TRIGGER codebase_index_set_updated_at
  BEFORE UPDATE ON codebase_index
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- device_codes
--
-- One CLI sign-in attempt. Two codes, and the split is the security of it:
--
--   user_code    short enough to read off a terminal and type into a browser.
--                Guessable, and worth nothing on its own -- approving it requires
--                an authenticated session, and approval is what grants anything.
--   device_code  the long secret only the CLI holds. Stored as a SHA-256, so a
--                dump of this table cannot be replayed to claim a token.
--
-- Rows are short-lived: expires_at is minutes out, and a claimed row is spent.
-- ---------------------------------------------------------------------------
CREATE TABLE device_codes (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id        uuid NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  user_code        varchar(12) NOT NULL UNIQUE,
  device_code_hash varchar(64) NOT NULL UNIQUE,
  status           device_code_status NOT NULL DEFAULT 'pending',
  user_id          bigint REFERENCES users (id) ON DELETE CASCADE,
  project_id       bigint REFERENCES projects (id) ON DELETE SET NULL,
  hostname         varchar(255),
  local_path       text,
  expires_at       timestamptz NOT NULL,
  approved_at      timestamptz,
  claimed_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_codes_expires_idx ON device_codes (expires_at);

-- A pending row must have no user attached, and an approved one must have one.
-- The approval is the whole point of the table, so the invariant belongs here
-- rather than only in the handler that writes it.
ALTER TABLE device_codes ADD CONSTRAINT device_codes_approval_has_user
  CHECK ((status IN ('pending', 'denied')) = (user_id IS NULL));

CREATE TRIGGER device_codes_set_updated_at
  BEFORE UPDATE ON device_codes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security is deliberately not here yet.
--
-- A policy on these tables would be silently bypassed today: the app connects as
-- the database owner, and an owner is exempt unless the table is FORCE'd. Doing
-- it properly means a second, non-owning role for the application and a
-- `current_setting('app.user_id')` convention that every connection sets --
-- which is a change to how the app connects, not a change to a table. It lands
-- in W3 alongside the tables that actually fan out per user.
--
-- Until then, scoping is the query's job: every read in `src/lib/data/` filters
-- by the user id on the session, and there is no path that takes an id from a URL
-- without checking who owns it.
-- ---------------------------------------------------------------------------

COMMIT;
