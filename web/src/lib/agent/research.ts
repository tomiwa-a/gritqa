import { createMCPClient } from '@ai-sdk/mcp';
import type { MCPClient } from '@ai-sdk/mcp';
import { jsonSchema } from 'ai';
import type { JSONSchema7 } from '@ai-sdk/provider';
import { db } from '@/lib/db';
import { cliInstances } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { CONNECTED_WITHIN } from '@/lib/db/cli';

/**
 * The agent's read access to the codebase, over the CLI's MCP server.
 *
 * This is the second of the two channels between the halves, and it runs the
 * opposite way round from the first. Approved work goes out through `jobs`: the
 * web app writes a row and the CLI polls for it, which is the only direction that
 * survives a laptop behind NAT. Research comes back through here: the web app
 * dials the CLI and waits, because an agent mid-draft has a question and cannot
 * proceed without the answer.
 *
 * **The honest limit.** The CLI binds its MCP server to loopback on purpose -- a
 * tool surface over someone's project is not something to put on a network
 * interface -- so this channel only exists when the agent and the CLI are on the
 * same machine. That is true in development and it is not true of a hosted
 * deployment, which will need a tunnel or a research-over-jobs fallback that
 * `CAP.md` has already ruled out on latency grounds. Naming it here rather than
 * discovering it later: nothing below pretends otherwise, and `jobs` is
 * unaffected either way.
 */

/** The URL and bearer the CLI prints when it starts. See `endpoint()` below. */
const URL_VAR = 'GRITQA_MCP_URL';
const TOKEN_VAR = 'GRITQA_MCP_TOKEN';

/** A connect that has not answered in this long is a CLI that is not there. */
const CONNECT_TIMEOUT_MS = 5_000;

/**
 * Carries the code the draft surfaces. `CAP.md` fixes both the code and the
 * behaviour: research is strongly consistent or it fails, because a cached answer
 * from a previous state of the tree produces a plan that is confidently wrong
 * about code that has since changed. There is no degraded mode to fall back to.
 */
export class CliUnavailableError extends Error {
  readonly code = 'CLI_UNAVAILABLE';

  constructor(readonly detail: string) {
    super(`CLI_UNAVAILABLE: ${detail}`);
    this.name = 'CliUnavailableError';
  }
}

/**
 * Where the CLI is, and the bearer for it -- resolved here and nowhere else, so
 * that changing how it is discovered is a change to this function.
 *
 * Resolution order:
 *   1. Environment variables (manual override, always wins)
 *   2. Database (auto-registered by the CLI's poll heartbeat)
 *
 * The env vars exist for remote setups where the CLI and web app are on different
 * machines. In the common case (same machine), the CLI auto-registers its MCP
 * address on every poll and the database is the source of truth.
 */
async function endpoint(): Promise<{ url: string; token: string } | null> {
  // 1. Env vars — manual override.
  const url = process.env[URL_VAR]?.trim();
  const token = process.env[TOKEN_VAR]?.trim();
  if (url && token) return { url, token };

  // 2. Database — auto-registered by the CLI's poll heartbeat.
  try {
    const [row] = await db
      .select({ mcpUrl: cliInstances.mcpUrl, mcpToken: cliInstances.mcpToken })
      .from(cliInstances)
      .where(sql`${cliInstances.lastSeenAt} > now() - ${CONNECTED_WITHIN}::interval`)
      .orderBy(sql`${cliInstances.lastSeenAt} DESC`)
      .limit(1);

    if (row?.mcpUrl && row?.mcpToken) {
      return { url: row.mcpUrl, token: row.mcpToken };
    }
  } catch {
    // Database unavailable — fall through to null.
  }

  return null;
}

/** Whether drafting can even be attempted, without opening a connection to find out. */
export async function researchConfigured(): Promise<boolean> {
  return (await endpoint()) !== null;
}

export type Research = {
  /** The CLI's tools, as an AI SDK tool set, ready to hand to the agent. */
  tools: Awaited<ReturnType<MCPClient['tools']>>;
  /** What the server called itself, for the transcript. */
  serverName: string;
  /**
   * Always call this, including on the failure path. An open session holds the
   * project's SQLite handle and possibly a sandbox on the developer's machine,
   * and neither should outlive the draft that asked for it.
   */
  close: () => Promise<void>;
};

/**
 * Connects at read scope, which is the whole of what drafting needs.
 *
 * MCP has no per-tool authorization, so the CLI decides by scope which tools it
 * *advertises*: a read bearer is not refused `run_plan`, it never learns the tool
 * exists. That is the property worth having here -- an agent cannot be talked into
 * calling something it was never shown, so the boundary does not depend on the
 * prompt holding.
 */
export async function openResearch(): Promise<Research> {
  const target = await endpoint();
  if (!target) {
    throw new CliUnavailableError(
      `No MCP server found. Set ${URL_VAR} and ${TOKEN_VAR} in .env.local, or start the CLI with \`gritqa --serve\` — it registers automatically on every poll.`,
    );
  }

  let client: MCPClient;
  try {
    client = await withTimeout(
      createMCPClient({
        transport: {
          type: 'http',
          url: target.url,
          headers: { Authorization: `Bearer ${target.token}` },
        },
        clientName: 'gritqa-web',
        /* One attempt. A retry only helps a server that is briefly busy, and the
           failure this actually sees is a process that is not running -- which
           three more connections will not change, while the developer waits. */
        maxRetries: 0,
      }),
      CONNECT_TIMEOUT_MS,
    );
  } catch (error) {
    /* Every way this fails is the same fact to a developer: the machine is not
       answering. The reason is kept on `detail` for the log, and the surface gets
       one state with one fix. A 401 is the exception worth spelling out, because
       it means the CLI *is* running and the bearer is from a previous process. */
    throw new CliUnavailableError(describe(error, target.url));
  }

  try {
    return {
      tools: portable(await client.tools()),
      serverName: client.serverInfo?.name ?? 'gritqa',
      close: () => client.close(),
    };
  } catch (error) {
    /* The handshake succeeded and listing tools did not, so this session is open
       and nobody else holds a reference to it. */
    await client.close().catch(() => {});
    throw new CliUnavailableError(describe(error, target.url));
  }
}

/**
 * The CLI's tool schemas, in the dialect every provider can actually read.
 *
 * A model provider's function-calling schema is a *subset* of JSON Schema, and the
 * subsets disagree. The CLI writes valid JSON Schema -- `derive_environment.recipe`
 * is `type: ["null", "object"]`, an optional object -- and the Google provider turns
 * a nullable type array into `anyOf` while leaving `properties`, `required` and
 * `description` beside it. Vertex rejects the request outright: when `anyOf` is
 * present it must be the only field set. The 400 names the CLI's tool, which sends
 * you looking in the wrong repository.
 *
 * So the seam between the two halves is where this gets absorbed. The CLI is not
 * going to grow a list of which model vendors mangle which keyword, and it should
 * not have to -- it describes its tools once, correctly, and the brain adapts them
 * to whatever it is thinking with today.
 *
 * `["null", T]` becomes `T`, which for an argument that is not in `required` says
 * the same thing: leave it out. `derive_environment`'s own description already
 * words it that way -- "omit to read the current one" -- so nothing is lost that
 * the model was using. Applied for every provider rather than only for Vertex,
 * because one code path that is always exercised beats a second one that is right
 * only until nobody looks at it.
 */
type ToolSet = Awaited<ReturnType<MCPClient['tools']>>;

function portable(tools: ToolSet): ToolSet {
  const out: Record<string, unknown> = {};

  for (const [name, tool] of Object.entries(tools)) {
    const schema = tool.inputSchema as {
      jsonSchema?: JSONSchema7;
      validate?: Parameters<typeof jsonSchema>[1] extends { validate?: infer V } ? V : never;
    };

    /* A Zod-backed tool would have no `jsonSchema` to rewrite. MCP always gives us
       the JSON Schema one, and passing anything else through unchanged is the right
       answer rather than something to guard against. */
    out[name] =
      schema && typeof schema === 'object' && schema.jsonSchema
        ? {
            ...tool,
            inputSchema: jsonSchema(collapseNullables(schema.jsonSchema) as JSONSchema7, {
              validate: schema.validate,
            }),
          }
        : tool;
  }

  return out as ToolSet;
}

/**
 * Depth-first, because the union can be on any property at any level -- `recipe` is
 * nullable and so are three of its own fields.
 *
 * A type array with more than one non-null member is a genuine union and is left
 * alone: narrowing it would change what the tool accepts, and the honest failure is
 * the provider saying it cannot represent it. Nothing the CLI advertises is one.
 */
function collapseNullables(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(collapseNullables);
  if (node === null || typeof node !== 'object') return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' && Array.isArray(value)) {
      const real = value.filter((t) => t !== 'null');
      out.type = real.length === 1 ? real[0] : real.length === 0 ? 'null' : real;
      continue;
    }
    out[key] = collapseNullables(value);
  }
  return out;
}

function describe(error: unknown, url: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|unauthor/i.test(message)) {
    return `${url} rejected the bearer. The CLI mints a new one each time it starts, so this is likely a token from a previous run.`;
  }
  return `${url} did not answer (${message}).`;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer in ${ms}ms`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
