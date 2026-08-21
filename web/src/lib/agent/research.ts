import { createMCPClient } from '@ai-sdk/mcp';
import type { MCPClient } from '@ai-sdk/mcp';

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
 * From the environment, deliberately, and not from a column on `cli_instances`
 * beside `last_seen_at`. The CLI mints these tokens per process and never writes
 * them to disk, so that a restart invalidates them; storing one in Postgres would
 * undo that and leave a credential at rest for a surface that only loopback can
 * reach anyway. The cost is that `next dev` has to be restarted when the CLI is,
 * which is the same shape of inconvenience the CLI already accepted.
 */
function endpoint(): { url: string; token: string } | null {
  const url = process.env[URL_VAR]?.trim();
  const token = process.env[TOKEN_VAR]?.trim();
  return url && token ? { url, token } : null;
}

/** Whether drafting can even be attempted, without opening a connection to find out. */
export function researchConfigured(): boolean {
  return endpoint() !== null;
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
  const target = endpoint();
  if (!target) {
    throw new CliUnavailableError(
      `${URL_VAR} and ${TOKEN_VAR} are not set. Start the CLI with \`gritqa serve\` and copy the URL and read bearer it prints.`,
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
      tools: await client.tools(),
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
