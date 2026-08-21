-- W8: the CLI's MCP address auto-registers with the web app.
--
-- The MCP server mints a port and bearer token per process. Until now the only
-- way to get them into the web app was to copy them from stderr into .env.local
-- and restart next dev. This migration adds columns so the CLI's poll heartbeat
-- can carry them: every poll writes the current address, and the research agent
-- reads the most recently connected one.

BEGIN;

ALTER TABLE cli_instances ADD COLUMN mcp_url   VARCHAR(512);
ALTER TABLE cli_instances ADD COLUMN mcp_token VARCHAR(255);

COMMIT;
