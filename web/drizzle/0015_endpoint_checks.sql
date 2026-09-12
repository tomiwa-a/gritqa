-- W15: endpoints carry proof, not just claims.
--
-- Coverage used to know three things: plans that claim an endpoint and runs
-- that broke it. Nothing recorded whether the endpoint itself is real -- a
-- well-formed plan step naming a route that does not exist saved as cleanly
-- as one naming a route that does, and the grid could not tell them apart.
--
-- One row per endpoint, overwritten on every proof: the latest trial call or
-- recheck, what it saw, and what that means. History would be a second ledger
-- nobody reads; the note says enough about where the verdict came from.
-- A failed probe writes nothing -- no connection is not evidence either way.

BEGIN;

CREATE TABLE endpoint_checks (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id    UUID NOT NULL UNIQUE DEFAULT uuid_generate_v7(),
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  method       VARCHAR(16) NOT NULL,
  path         TEXT NOT NULL,
  -- 'real' answered like an endpoint (any status that proves a handler ran,
  -- including 401s and 500s); 'fake' answered like nothing lives there (404).
  verdict      VARCHAR(16) NOT NULL,
  status_code  INTEGER,
  -- 'trial' from a sandbox probe, 'recheck' from a Look-again.
  source       VARCHAR(16) NOT NULL,
  note         TEXT,
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The upsert target: one proof per endpoint, so a re-probe replaces rather
-- than piles up.
CREATE UNIQUE INDEX endpoint_checks_proof_idx ON endpoint_checks (project_id, method, path);

COMMENT ON TABLE endpoint_checks IS
  'Latest proof per endpoint: trial calls and rechecks overwrite, runs and plans read.';

COMMIT;
