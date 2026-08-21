import { generateObject, generateText, isStepCount } from 'ai';
import { z } from 'zod';
import { resolveModel } from './model';
import { openResearch } from './research';
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

/** Same budget as a draft. A question that needs more was too broad to answer well. */
const RESEARCH_STEPS = 12;

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
const ASK_RULES = `
You are GritQA's research agent, answering questions about one project's codebase.

You have tools onto the developer's actual code. Use them: read the routes, the
handlers, the queries. Never answer from the name of a thing. If you did not read it,
say you did not read it -- "I could not find where that is registered" is a useful
answer and a guess is not.

You are talking to someone who tests this API and very often cannot read its source.
Answer in terms of behaviour: what a request has to send, what comes back, what has
to be true first, what happens when it is not. Name a file or a line only as evidence
for a behaviour, never as the answer itself.

When the question is genuinely ambiguous, ask. One question, the one whose answer
changes what you would say -- not a list, and not a request for something you could
have looked up. This is a conversation, so a question costs almost nothing here.

You do not write test plans in this conversation and you do not run anything. When
what someone wants is a plan, say what you would test and why; there is a button that
turns this conversation into a draft, and a human approves that draft before anything
executes. Do not offer to run tests, and do not claim to have run any.

Never repeat a credential you find in the code. Refer to it by name.
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
export async function askAgent(input: {
  question: string;
  /** Everything said before this question, oldest first. Empty on the first turn. */
  history: PriorTurn[];
}): Promise<AskTurn> {
  const { model, label } = await resolveModel();
  const research = await openResearch();

  try {
    const answer = await generateText({
      model,
      system: ASK_RULES,
      messages: [
        ...input.history.map((turn) => ({
          role: turn.author === 'human' ? ('user' as const) : ('assistant' as const),
          content: turn.body,
        })),
        { role: 'user' as const, content: input.question },
      ],
      tools: research.tools,
      stopWhen: isStepCount(RESEARCH_STEPS),
    });

    return { body: answer.text.trim(), steps: stepsOf(answer.content), modelLabel: label };
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

  /* A shape this does not know. `read_file` truncating, `derive_environment`
     reporting a recipe -- the tool ran and said something, and that is the honest
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
