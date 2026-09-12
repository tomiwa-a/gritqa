import { createMCPClient } from '@ai-sdk/mcp';
import type { MCPClient } from '@ai-sdk/mcp';
import { jsonSchema } from 'ai';
import type { JSONSchema7 } from '@ai-sdk/provider';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { cliInstances } from '@/lib/db/schema';
import { CONNECTED_WITHIN } from '@/lib/db/cli';
import { currentScope } from '@/lib/db/scope';
import { newestDial } from '@/lib/agent/relay';
import type { Held } from '@/lib/agent/relay';
import { DialTransport } from '@/lib/agent/dial-transport';

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
 * Two ways in, and the same tools either way. The CLI binds its MCP server to
 * loopback on purpose -- a tool surface over someone's project is not something to put
 * on a network interface -- so an address only works when the agent and the CLI are on
 * the same machine. It also dials out (decision 24), and a connection it opened works
 * from anywhere, which is what a hosted deployment will use. A held dial is preferred
 * for the same reason: it is proof of reachability, where a `127.0.0.1:PORT` row is a
 * claim, and on a hosted deploy that claim points at the server's own loopback.
 *
 * **The honest limit that remains.** The relay holding a dial is a `Map` in one Node
 * process, so this works across machines but not across server instances. `jobs` is
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
 * How to reach the CLI -- resolved here and nowhere else, so that changing how it is
 * discovered is a change to this function.
 *
 * Order:
 *   1. Environment variables, the manual override for a hand-run `gritqa --serve`
 *   2. A dial this project's CLI has open, held by the relay
 *   3. The loopback address the CLI registers on every poll
 *
 * A dial beats an address because it has already proved it works. The address is a
 * row the CLI wrote about itself, and on a hosted deploy `127.0.0.1:PORT` names the
 * server rather than the laptop.
 */
type Reach =
  | { kind: 'http'; label: string; url: string; token: string }
  | { kind: 'dial'; label: string; conn: Held };

async function endpoint(): Promise<Reach | null> {
  const url = process.env[URL_VAR]?.trim();
  const token = process.env[TOKEN_VAR]?.trim();
  if (url && token) return { kind: 'http', label: url, url, token };

  const scope = await currentScope();
  if (!scope) return null;

  const dial = newestDial(scope.projectId);
  if (dial) {
    return { kind: 'dial', label: `the dial from ${dial.instanceId}`, conn: dial.conn };
  }

  try {
    const [row] = await db
      .select({ mcpUrl: cliInstances.mcpUrl, mcpToken: cliInstances.mcpToken })
      .from(cliInstances)
      .where(
        and(
          eq(cliInstances.projectId, scope.projectId),
          sql`${cliInstances.lastSeenAt} > now() - ${CONNECTED_WITHIN}::interval`,
        ),
      )
      .orderBy(sql`${cliInstances.lastSeenAt} DESC`)
      .limit(1);

    if (row?.mcpUrl && row?.mcpToken) {
      return { kind: 'http', label: row.mcpUrl, url: row.mcpUrl, token: row.mcpToken };
    }
  } catch {
    /* No database is the same answer as no machine: there is nothing to research with. */
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
      `No machine is reachable for this project. Run \`gritqa\` in the project — it registers its address and dials in on every poll — or set ${URL_VAR} and ${TOKEN_VAR} in .env.local to point at one by hand.`,
    );
  }

  let client: MCPClient;
  try {
    client = await withTimeout(
      createMCPClient({
        /* A dial is already connected, so the transport over it is the connection
           rather than a way of making one. Nothing else about the client changes. */
        transport:
          target.kind === 'dial'
            ? new DialTransport(target.conn)
            : {
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
    throw new CliUnavailableError(describe(error, target.label));
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
    throw new CliUnavailableError(describe(error, target.label));
  }
}

/**
 * The CLI's tool schemas, in the dialect every provider can actually read.
 *
 * A model provider's function-calling schema is a *subset* of JSON Schema, and the
 * subsets disagree. The CLI writes valid JSON Schema -- an optional object is
 * `type: ["null", "object"]` -- and the Google provider turns
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
 * the same thing: leave it out. Applied for every provider rather than only for
 * Vertex, because one code path that is always exercised beats a second one that
 * is right only until nobody looks at it.
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

function describe(error: unknown, where: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|unauthor/i.test(message)) {
    return `${where} rejected the bearer. The CLI mints a new one each time it starts, so this is likely a token from a previous run.`;
  }
  return `${where} did not answer (${message}).`;
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
