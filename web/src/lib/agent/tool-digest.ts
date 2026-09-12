import type { AgentStep } from '@/lib/model';

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
export type ContentPart = {
  type: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
};

export function stepsOf(content: readonly unknown[]): AgentStep[] {
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
export function subjectOf(input: unknown): string | undefined {
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
export function digestOf(tool: string, output: unknown): string | undefined {
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

/** The error, in one line. Never a stack, never a payload. */
export function errorDigest(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return clip(error.trim(), 160);
  if (error instanceof Error && error.message.trim()) return clip(error.message.trim(), 160);
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return clip(message.trim(), 160);
  }
  return 'failed';
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
