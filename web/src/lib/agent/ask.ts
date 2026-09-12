import { generateObject, generateText, isStepCount } from 'ai';
import { z } from 'zod';
import { resolveModel, type Session } from './model';
import { openResearch } from './research';
import { unwatched, watching } from './watch';
import type { Watcher } from './watch';
import type { AgentStep } from '@/lib/model';

/**
 * Asking about the codebase, which is one pass rather than two.
 *
 * `draftPlan` researches and then shapes, because a plan has to come back as an
 * object. An answer does not: the prose *is* the output, so there is no second call
 * and no schema forbidding the honest reply. That is the whole reason this file is
 * small, and the reason an ask turn costs a fraction of a draft.
 *
 * It is also the missing branch. Both existing agent paths end in `generateObject`
 * against a schema whose only legal value is a finished plan, so a model that wanted
 * to ask "which guest?" had exactly one legal move: invent one. Here it can ask,
 * because a question is a valid answer.
 */

/**
 * Same budget as a draft's research pass, and for the same reason: a question about a
 * codebase is answered by reading it. Twelve was eight or nine file reads once the
 * sandbox boot and a schema query came out of it, which is where an answer that had
 * only skimmed came from -- turn 6 of the LoanApp conversation returned ten thousand
 * characters about a KYC provider having made no tool calls at all.
 *
 * Forty is not a claim that forty is right. It is enough to read fifteen files, and a
 * model that has not found the answer by then is stuck rather than short of budget.
 */
const RESEARCH_STEPS = 40;

/* One model request may take this long before it is judged hung and tried once
   more. A healthy turn finishes well inside it; the cases that blew past were
   silent the whole way. */
const ATTEMPT_TIMEOUT_MS = 150_000;

const FINAL_ANSWER_NUDGE =
  'You have gathered enough. Stop calling tools and write your final answer now, in plain product language.';

/**
 * What the agent is for on this path, and what it must not do.
 *
 * The developer's standing rules are deliberately absent. They govern how a plan is
 * written -- ordering, mocks, assertion style -- and they bind at the moment a plan
 * is written, which is `draftPlan`. Sending them here would spend prompt on
 * instructions that have nothing to answer.
 *
 * The audience line is load-bearing. This exists because QA cannot read the code
 * they are testing, and an answer full of PHP is an answer they cannot use.
 */
export const ASK_RULES = `
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

export type AskTurn = {
  /** The answer, as prose. This is what lands in `conversation_messages.body`. */
  body: string;
  /** What it did to answer, one line per call. Never the results themselves. */
  steps: AgentStep[];
  /** Which model answered, for the record. Never a key. */
  modelLabel: string;
};

/** A turn of the conversation so far, oldest first, as stored. */
export type PriorTurn = { author: 'agent' | 'human'; body: string };

/**
 * One answer.
 *
 * The history goes in as real messages rather than as a transcript pasted into the
 * prompt, so the model sees its own previous answers as its own -- which is what
 * makes "and what about the admin side?" resolvable. This is the thing `refinePlan`
 * cannot do: it takes an instruction and the current plan and has no memory of the
 * two turns before it.
 */
/**
 * Lightweight goal tracking for multi-turn conversations (StateAct-style
 * self-prompting). The history is already sent as messages, so this does not
 * repeat it -- it reminds the model what the goal is and what it has already
 * covered, so a "and what about X?" follow-up does not start from scratch or
 * drift from the original task.
 */
function goalTracking(history: PriorTurn[], question: string): string {
  if (history.length === 0) return ASK_RULES;
  const summary = history
    .map((t, i) => {
      const who = t.author === 'human' ? 'User' : 'You';
      const snippet = t.body.replace(/\s+/g, ' ').trim().slice(0, 220);
      return `${i + 1}. ${who}: ${snippet}${t.body.length > 220 ? '...' : ''}`;
    })
    .join('\n');
  return [
    ASK_RULES,
    '',
    '## Conversation memory -- what you have already covered',
    summary,
    '',
    `The user now asks: "${question.replace(/\s+/g, ' ').trim().slice(0, 300)}"`,
    'Use history as context and build on what you already read. Do not re-fetch',
    'what you already have unless you need to verify it. Answer the latest question,',
    'not the whole thread again.',
  ].join('\n');
}

export async function askAgent(input: {
  question: string;
  /** Everything said before this question, oldest first. Empty on the first turn. */
  history: PriorTurn[];
  /**
   * Where to narrate the reading, when this is queued work.
   *
   * No `findings` note is written here and `resumeFrom` is ignored, which is the
   * honest thing rather than an omission: the reading and the answer are one call, so
   * there is no half of this to resume from. An abandoned ask runs again whole.
   */
  watch?: Watcher;
  /** Pre-read session to avoid `cookies()` inside `after()`. */
  session?: Session | null;
}): Promise<AskTurn> {
  const watch = input.watch ?? unwatched;
  const { model, label } = await resolveModel(input.session);
  const research = await openResearch();

  try {
    const systemWithMemory = goalTracking(input.history, input.question);
    const baseMessages = [
      ...input.history.map((turn) => ({
        role: turn.author === 'human' ? ('user' as const) : ('assistant' as const),
        content: turn.body,
      })),
      { role: 'user' as const, content: input.question },
    ];

    /* A request that hangs would spin this turn until something upstream gives up,
       and gemini sometimes stops after tool calls with no prose at all. One hard
       timeout per attempt, one retry -- nudged when the failure was silence. The
       same guard lives in eval/src/agent.ts; keep the two in step. */
    let body = '';
    let steps: AgentStep[] | undefined;
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
              ? [{ role: 'user' as const, content: FINAL_ANSWER_NUDGE }]
              : []),
          ],
          tools: research.tools,
          stopWhen: isStepCount(RESEARCH_STEPS),
          abortSignal: controller.signal,
          ...watching(watch, 'research'),
        });
        const trimmed = result.text.trim();
        if (trimmed || attempt === 1) {
          body = trimmed;
          steps = stepsOf(result.content);
          break;
        }
      } catch (e) {
        if (attempt === 1) throw e instanceof Error ? e : new Error(String(e));
      } finally {
        clearTimeout(timer);
      }
    }

    return { body, steps: steps ?? [], modelLabel: label };
  } finally {
    /* Always, including on the throw. An open session holds the project's SQLite
       handle and possibly a sandbox on the developer's machine. */
    await research.close().catch(() => {});
  }
}

/**
 * The conversation's research, for handing to a draft.
 *
 * Every agent turn's prose is what it found when it looked, which is exactly what
 * `draftPlan.findings` was and threw away. Joined oldest first so the draft reads the
 * understanding in the order it was built.
 */
export function priorFindingsOf(history: PriorTurn[]): string | undefined {
  const found = history.filter((turn) => turn.author === 'agent').map((turn) => turn.body);
  return found.length ? found.join('\n\n') : undefined;
}

/**
 * A brief, from a conversation, for the developer to edit before drafting.
 *
 * A cheap call: no tools and no research, because everything it needs was already
 * said. It is shown rather than used directly -- the conversation may have wandered
 * across four topics and only one of them is the test, and the person who was there
 * knows which. A synthesis nobody could correct would be the wizard's one-shot with
 * extra steps.
 */
const briefSchema = z.object({
  brief: z
    .string()
    .describe(
      'What the plan should prove, in one or two plain sentences, addressed to the ' +
        "agent that will write it. The developer's own words where they said it well.",
    ),
  name: z.string().describe('A short name for the plan, after what it proves.'),
});

export async function proposeBrief(input: {
  title: string;
  history: PriorTurn[];
}): Promise<{ brief: string; name: string }> {
  const { model } = await resolveModel();

  const transcript = input.history
    .map((turn) => `${turn.author === 'human' ? 'Them' : 'You'}: ${turn.body}`)
    .join('\n\n');

  const shaped = await generateObject({
    model,
    schema: briefSchema,
    system: ASK_RULES,
    prompt: [
      `A conversation about this project, titled "${input.title}":`,
      '',
      transcript,
      '',
      'They now want a test plan out of this. Write the brief it should be drafted',
      'from: what the plan has to prove, in behaviour, in one or two sentences. Take',
      'the part of the conversation that is about testing something and leave the rest.',
      'Do not write the plan and do not list steps -- the brief is the sentence the',
      'plan gets written from, and they will edit it before anything runs.',
    ].join('\n'),
  });

  return shaped.object;
}

/**
 * What the agent did, as a line each.
 *
 * Read off `content` rather than `toolCalls`, because `content` spans every step in
 * order and carries the failures too -- a call that errored is part of the account of
 * how an answer was reached, and often the most informative part of it.
 *
 * Results are measured, never stored. `read_file` hands back whole files and `db`
 * hands back rows of the developer's data; a transcript that kept those would put a
 * copy of someone's source and someone's records into Postgres on every turn. A row
 * count and a line count are what make an answer inspectable, and they are all of it
 * that is safe to keep.
 */
type ContentPart = { type: string; toolName?: string; input?: unknown; output?: unknown };

function stepsOf(content: readonly unknown[]): AgentStep[] {
  const steps: AgentStep[] = [];

  for (const raw of content) {
    const part = raw as ContentPart;
    if (part.type === 'tool-call') {
      steps.push({ tool: part.toolName ?? 'tool', subject: subjectOf(part.input) });
      continue;
    }
    /* A result belongs to the call before it, which is how the model got it: it asked,
       it was answered, it asked again. Attaching by position rather than by
       `toolCallId` keeps this readable and costs nothing, because the only ordering
       that exists here is the one the model produced. */
    const last = steps[steps.length - 1];
    if (!last || last.digest !== undefined) continue;
    if (part.type === 'tool-result') last.digest = digestOf(last.tool, part.output);
    else if (part.type === 'tool-error') last.digest = 'failed';
  }

  return steps;
}

/** What it asked for, flattened to one line. A path, a query, a statement. */
function subjectOf(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const args = input as Record<string, unknown>;

  const sql = text(args.sql);
  if (sql) return clip(sql.replace(/\s+/g, ' '), 120);

  const query = text(args.query);
  const path = text(args.path);
  if (query) return path ? `${clip(query, 80)} in ${path}` : clip(query, 100);
  if (path) return path;

  /* Anything else: the first thing it said, so a tool nobody anticipated still
     reports something rather than an unexplained name. */
  const first = Object.values(args).find((value) => text(value));
  return first ? clip(text(first)!, 100) : undefined;
}

/** What came back, as a measurement. */
function digestOf(tool: string, output: unknown): string | undefined {
  const value = unwrap(output);
  if (!value || typeof value !== 'object') return undefined;
  const out = value as Record<string, unknown>;

  if (Array.isArray(out.matches)) {
    const files = typeof out.files_searched === 'number' ? ` in ${out.files_searched} files` : '';
    return out.matches.length
      ? `${count(out.matches.length, 'match', 'matches')}${files}`
      : 'no matches';
  }
  if (Array.isArray(out.rows)) {
    return out.rows.length ? count(out.rows.length, 'row', 'rows') : 'no rows';
  }
  if (typeof out.content === 'string') {
    const lines = out.content ? out.content.split('\n').length : 0;
    return count(lines, 'line', 'lines');
  }
  if (Array.isArray(out.endpoints)) {
    return count(out.endpoints.length, 'endpoint', 'endpoints');
  }
  if (typeof out.base_url === 'string') return 'sandbox up';

  /* A shape this does not know. `read_file` truncating, `environment_status`
     reporting the verdicts -- the tool ran and said something, and that is the honest
     digest for a tool added after this function was written. */
  return tool === 'get_index' ? 'read the index' : undefined;
}

/**
 * The MCP client returns the typed output when the tool declares an output schema,
 * and the raw `CallToolResult` when it does not. The second case is one text part
 * holding JSON, so it is unwrapped here rather than handled at every branch above.
 */
function unwrap(output: unknown): unknown {
  if (!output || typeof output !== 'object') return output;
  const result = output as { content?: unknown; structuredContent?: unknown };
  if (result.structuredContent) return result.structuredContent;
  if (!Array.isArray(result.content)) return output;

  const first = result.content.find(
    (part): part is { type: string; text: string } =>
      !!part && typeof part === 'object' && (part as { type?: string }).type === 'text',
  );
  if (!first) return output;
  try {
    return JSON.parse(first.text);
  } catch {
    return { content: first.text };
  }
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
