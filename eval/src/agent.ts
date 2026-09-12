import { generateText, isStepCount } from "ai";
import { createVertex } from "@ai-sdk/google-vertex";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ToolCall, AgentResult } from "./types.js";
import type { McpSession } from "./mcp.js";

// Carbon copy of web/src/lib/agent/ask.ts ASK_RULES — keep in sync.
// Single source of truth is web/src/lib/agent/ask.ts; eval must match it.
// A build-time check (eval/check-sync.mjs) verifies they are identical.
const ASK_RULES = `
You are GritQA's research agent. You answer questions about one project's codebase by
reading it -- never from the name of a thing.

How to work -- Think, Act, Observe, Repeat:
1. THINK: Break the question into sub-questions. What files, endpoints, tables, or
   permissions do you need to find? What have you already learned in this conversation?
2. ACT: Call tools. Start with get_index for orientation, then read_file/search for
   code, db for data. You can and should make multiple db calls -- list tables,
   describe schema, join roles/permissions, and follow foreign keys.
3. OBSERVE: Read what came back. Does it answer the sub-question? Do you need another
   call? Did a tool fail -- what will you try instead?
4. REPEAT until you have enough evidence to answer completely. Prefer two more tool
   calls over one more paragraph of guessing.

Your tools:
- get_index -- file counts, frameworks, every HTTP endpoint and where it is registered. Start here.
- read_file -- one repo-relative file, up to 128 KB. Project-bounded.
- search -- literal or regex across source. Use to find handlers, permissions, migrations, and where a store key/column is used.
- db -- one read-only query against the project's primary datastore via the sandbox (SQL: SELECT/SHOW/EXPLAIN/DESCRIBE; auto-starts the sandbox if needed, about a minute the first time). For non-SQL stores (MongoDB, Redis, ClickHouse, Kafka, etc.) there is no db query -- use search + read_file instead. Make as many db calls as you need when a SQL store exists: list tables, describe schema, join/filter, and cross-check what the code says.
- read_compose / environment_status / start_sandbox / teardown -- for environment questions only. environment_status is read-only: verdicts live in the project's config file, so point there instead of proposing any.

Data questions -- always do both sides and say so:
- Query the live data when a SQL store exists: use db to list tables/collections, describe schema, and SELECT to join/filter (e.g. which roles have which permissions). For document/KV/stream stores (Mongo, Redis, ClickHouse, Kafka, Grafana, etc.) skip db and read the code: search for collection/table/topic/key definitions, read the model/migration that defines them, and confirm the mapping.
- Read the code second: search for the permission/collection/topic name, read the middleware/guard/model/migration that defines or checks it, and confirm how the code maps to the data.
- Report when the two agree and when they do not. A permission the code checks but no role has, or a row/document in the store with no code path, is worth naming.

Error recovery -- never stop at the first failure:
- If db fails, it will auto-start and retry. If it still fails, fall back to search for migration files and schema definitions in code.
- If read_file says "outside the project" or "not found", use search to locate the correct path, or get_index to list what exists.
- If search returns no matches, try a broader literal, a regex, or a different keyword (permission name, table name, route fragment).
- Always explain what you tried and what you are trying next -- do not silently give up.

Thoroughness:
- Read the route, the handler, and one layer deeper (service/model/query) before claiming you understand a flow.
- For multi-step flows (reservation: bag -> verify -> process -> bookings; booking -> housekeeping), trace each step to its handler and its DB effect.
- Verify every endpoint, file, and permission you mention appeared in a tool result. If you did not read it, say "I could not find where that is registered" -- a guess is worse than no answer.

You do not write test plans and you do not run anything. When someone wants a plan, say what you would test and why -- there is a button that turns this conversation into a draft, and a human approves that draft before anything executes. Never offer to run tests and never claim to have run any.

Never repeat a credential you find in the code. Refer to it by name (e.g. $ADMIN_TOKEN).

Voice -- product first, plumbing second:
- Lead with what the product does and what the person testing will see: "the guest
  picks rooms into a bag, pays once, and gets a booking". Behaviour before mechanism,
  always.
- Plain words by default. A technical name (an endpoint, a table, a permission) earns
  its place only as proof: give it once in brackets after the behaviour it backs --
  never as a list dump, never instead of the story.
- No SQL, no file trees, no schema tours unless the question asked for them. Live
  numbers are product facts and get said plainly: "53 rooms, none occupied right now".
- Structure answers the way a tester thinks: what happens, what must be true first,
  what you see when it is not, where to poke next.

Audience: someone testing this product who usually cannot read its source. Name a file
or line only as evidence for a behaviour, never as the answer itself.
When the question is genuinely ambiguous, ask one question -- the one whose answer changes what you would do -- not a list, and not a request for something you could have looked up. This is a conversation, so a question costs almost nothing here.
`.trim();

const RESEARCH_STEPS = 40;

// A model request that hangs burns the whole case budget in silence, and gemini
// sometimes returns tool calls but no final prose at all. One hard timeout per
// attempt and one retry — nudged, when the failure was silence — turn both into
// recoverable stumbles instead of dead cases.
const ATTEMPT_TIMEOUT_MS = 150_000;

const FINAL_ANSWER_NUDGE =
  "You have gathered enough. Stop calling tools and write your final answer now, in plain product language.";

type ModelKind = "vertex" | "openai";

function resolveModel() {
  // Prefer user's API key if set (GRITQA_MODEL + key), else Vertex dev path
  const gcpProject = process.env.GCP_PROJECT_ID?.trim() || process.env.GOOGLE_VERTEX_PROJECT?.trim();
  const gcpEmail = process.env.GCP_CLIENT_EMAIL?.trim();
  const gcpKey = process.env.GCP_PRIVATE_KEY?.trim();

  // If OpenAI-compatible env is set, use it
  const openAiKey = process.env.OPENAI_API_KEY?.trim() || process.env.GRITQA_AI_KEY?.trim();
  const openAiBase = process.env.GRITQA_MODEL_BASE_URL?.trim() || process.env.OPENAI_BASE_URL?.trim();
  const openAiModel = process.env.GRITQA_MODEL?.trim();

  if (openAiKey && openAiModel) {
    const provider = createOpenAICompatible({
      name: "gritqa-eval",
      baseURL: openAiBase || "https://api.openai.com/v1",
      apiKey: openAiKey,
    });
    return { model: provider(openAiModel), label: openAiModel, kind: "openai" as ModelKind };
  }

  // Vertex path (dev)
  if (!gcpProject) {
    throw new Error(
      "No model configured. Set GCP_PROJECT_ID (for Vertex gemini) or OPENAI_API_KEY + GRITQA_MODEL (for OpenAI-compatible)."
    );
  }
  const credentials =
    gcpEmail && gcpKey
      ? { client_email: gcpEmail, private_key: gcpKey.replace(/\\n/g, "\n").replace(/^"|"$/g, "") }
      : undefined;

  const vertex = createVertex({
    project: gcpProject,
    location: process.env.GOOGLE_VERTEX_LOCATION?.trim() || "us-central1",
    ...(credentials ? { googleAuthOptions: { credentials } } : {}),
  });
  const modelName = process.env.GRITQA_MODEL?.trim() || "gemini-2.5-flash";
  return { model: vertex(modelName), label: `${modelName} (vertex)`, kind: "vertex" as ModelKind };
}

function goalTracking(history: { author: "human" | "agent"; body: string }[], question: string): string {
  if (history.length === 0) return ASK_RULES;
  const summary = history
    .map((t, i) => {
      const who = t.author === "human" ? "User" : "You";
      const snippet = t.body.replace(/\s+/g, " ").trim().slice(0, 220);
      return `${i + 1}. ${who}: ${snippet}${t.body.length > 220 ? "..." : ""}`;
    })
    .join("\n");
  return [
    ASK_RULES,
    "",
    "## Conversation memory -- what you have already covered",
    summary,
    "",
    `The user now asks: "${question.replace(/\s+/g, " ").trim().slice(0, 300)}"`,
    "Use history as context and build on what you already read. Do not re-fetch",
    "what you already have unless you need to verify it. Answer the latest question,",
    "not the whole thread again.",
  ].join("\n");
}

export async function runAgent(input: {
  question: string;
  history?: { author: "human" | "agent"; body: string }[];
  mcp: McpSession;
  mcpStartupMs: number;
  modelOverride?: string;
}): Promise<AgentResult> {
  const { model, label } = input.modelOverride
    ? (() => {
        // Allow override like "gemini-2.5-flash" or "gpt-4o-mini"
        const gcpProject = process.env.GCP_PROJECT_ID?.trim() || process.env.GOOGLE_VERTEX_PROJECT?.trim();
        if (gcpProject) {
          const v = createVertex({
            project: gcpProject,
            location: process.env.GOOGLE_VERTEX_LOCATION?.trim() || "us-central1",
          });
          return { model: v(input.modelOverride!), label: input.modelOverride! };
        }
        throw new Error("No GCP project for model override");
      })()
    : resolveModel();

  const history = input.history ?? [];
  const systemWithMemory = goalTracking(history, input.question);
  const toolCalls: ToolCall[] = [];
  let seq = 0;

  // Wrap tools to time each call
  const timedTools = wrapToolsWithTiming(input.mcp.tools as Record<string, unknown>, (name, input, result, error, startedAt, endedAt) => {
    toolCalls.push({
      seq: ++seq,
      name,
      input,
      result,
      error,
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
    });
  });

  const agentStartedAt = Date.now();
  let stoppedReason: string | undefined;
  console.log(`    [agent] calling ${label} with ${Object.keys(input.mcp.tools).length} tools...`);

  const baseMessages = [
    ...history.map((turn) => ({
      role: turn.author === "human" ? ("user" as const) : ("assistant" as const),
      content: turn.body,
    })),
    { role: "user" as const, content: input.question },
  ];

  let answerText = "";
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const result = await generateText({
        model,
        system: systemWithMemory,
        messages: [
          ...baseMessages,
          ...(attempt > 0
            ? [{ role: "user" as const, content: FINAL_ANSWER_NUDGE }]
            : []),
        ],
        tools: timedTools,
        stopWhen: isStepCount(RESEARCH_STEPS),
        abortSignal: controller.signal,
      });
      answerText = result.text.trim();
      if (answerText) break;
      console.log("    [agent] model returned no prose; retrying with a nudge...");
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`    [agent] attempt ${attempt + 1} failed (${msg}); retrying...`);
    } finally {
      clearTimeout(timer);
    }
  }
  if (!answerText && lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  const agentMs = Date.now() - agentStartedAt;

  return {
    answer: answerText,
    toolCalls,
    totalSteps: toolCalls.length,
    mcpStartupMs: input.mcpStartupMs,
    mcpConnectMs: input.mcp.connectMs,
    agentMs,
    totalMs: input.mcpStartupMs + input.mcp.connectMs + agentMs,
    modelLabel: label,
    stoppedReason,
    stepsBudget: RESEARCH_STEPS,
  };
}

function wrapToolsWithTiming(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: Record<string, any>,
  onCall: (name: string, input: unknown, result: unknown, error: string | undefined, startedAt: number, endedAt: number) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  // Log tool definitions for debugging
  console.log(`    [agent] tools: ${Object.keys(tools).join(", ")}`);
  const wrapped: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(tools)) {
    const t = tool as { execute?: (input: unknown, opts: unknown) => Promise<unknown> };
    if (!t.execute) {
      wrapped[name] = tool;
      continue;
    }
    const originalExecute = t.execute.bind(t);
    wrapped[name] = {
      ...t,
      execute: async (input: unknown, opts: unknown) => {
        const startedAt = Date.now();
        try {
          const result = await originalExecute(input, opts);
          const endedAt = Date.now();
          // MCP reports tool failures as isError results, not thrown errors.
          // Recording those as success made every failed db call look "ok".
          const r = result as { isError?: boolean; content?: { text?: string }[] } | undefined;
          const errText =
            r?.isError && Array.isArray(r.content)
              ? r.content.map((c) => c.text ?? "").join(" ")
              : undefined;
          onCall(name, input, result, errText, startedAt, endedAt);
          return result;
        } catch (e) {
          const endedAt = Date.now();
          const msg = e instanceof Error ? e.message : String(e);
          onCall(name, input, undefined, msg, startedAt, endedAt);
          throw e;
        }
      },
    };
  }
  return wrapped;
}

/** Run a full conversation: question + followUps, threading history and accumulating timing. */
export async function runConversation(input: {
  question: string;
  followUps?: string[];
  mcp: McpSession;
  mcpStartupMs: number;
}): Promise<{ turns: AgentResult[]; totalToolCalls: ToolCall[] }> {
  const turns: AgentResult[] = [];
  const history: { author: "human" | "agent"; body: string }[] = [];

  const first = await runAgent({
    question: input.question,
    history: [],
    mcp: input.mcp,
    mcpStartupMs: input.mcpStartupMs,
  });
  turns.push(first);
  history.push({ author: "human", body: input.question });
  history.push({ author: "agent", body: first.answer });

  for (const q of input.followUps ?? []) {
    const res = await runAgent({
      question: q,
      history: [...history],
      mcp: input.mcp,
      mcpStartupMs: 0, // only count startup on first turn
    });
    turns.push(res);
    history.push({ author: "human", body: q });
    history.push({ author: "agent", body: res.answer });
  }

  const totalToolCalls = turns.flatMap((t) => t.toolCalls);
  return { turns, totalToolCalls };
}
