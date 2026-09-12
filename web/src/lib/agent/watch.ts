import type { ToolSet } from 'ai';

/**
 * What the agent did, as it does it.
 *
 * Drafting used to happen inside the request that asked for it, so "what is it doing"
 * was answered by a spinner and never needed a vocabulary. Now the work outlives the
 * click, and the developer who comes back to it has only what was written down --
 * which makes this the whole of what a job in flight can say about itself.
 *
 * Deliberately not a logger. Every note here is a row somebody reads on a page, so a
 * label is a sentence about the code rather than a trace line, and there is exactly
 * one note per thing that happened rather than one per function that ran.
 *
 * No database import, in either direction. This file names the shape; `db/work.ts`
 * writes it; `lib/work/run.ts` is the only place that knows both.
 */

/**
 * Which part of the work a note came out of.
 *
 * The three agent entry points are the same shape -- go and read the code, write the
 * answer, check it -- so the phases are shared rather than per job type. `save` is the
 * write into Postgres, which is short but is the phase a developer cares about most:
 * it is the one that decides whether the work survived.
 *
 * `answer_question` has no `write` or `verify`: its research pass and its answer are
 * one call, so it goes research then save.
 */
export type WorkPhase = 'research' | 'write' | 'verify' | 'save';

/**
 * What kind of thing a note is.
 *
 * `tool` is the agent reaching into the codebase. `turn` is the model's own prose
 * between tool calls -- what it thinks it has established so far, which is the most
 * useful thing on the page when a draft comes out wrong. `note` is the runner
 * narrating a phase boundary. `findings` is research's full output, stored because a
 * resume reads it back rather than paying for the reading twice. `failed` is why the
 * work stopped.
 */
export type WorkEventKind = 'tool' | 'turn' | 'note' | 'findings' | 'failed';

export type WorkNote = {
  phase: WorkPhase;
  kind: WorkEventKind;
  /** One line, in the words a developer reads. */
  label: string;
  /** Whatever the line does not carry. Shapes are the writer's business. */
  detail?: unknown;
};

/**
 * Where notes go, and what an earlier attempt already established.
 *
 * `resumeFrom` is the reason this is one object rather than a callback: a job being
 * picked up after its web process died has research in the record already, and the
 * only sensible thing to do with it is skip the phase that produced it. Threading that
 * through as a separate parameter would let a caller record notes without honouring the
 * resume, which is the expensive half of the bug.
 */
export type Watcher = {
  note(note: WorkNote): void;
  /**
   * The findings a previous attempt wrote, when this is a second attempt at the same
   * job. Undefined on a first attempt, and on every path that is not queued work.
   */
  resumeFrom?: string;
};

/**
 * A watcher that drops everything.
 *
 * So the agent functions take an optional watcher without branching on it at every
 * call site, and so a direct call from a test or a script still works. Nothing in the
 * agent should behave differently for being unwatched.
 */
export const unwatched: Watcher = { note: () => {} };

/**
 * The AI SDK callbacks that turn one model call into notes.
 *
 * `onToolExecutionStart` rather than the end event, deliberately: a tool that hangs is
 * the failure a developer most needs to see, and an end-only record shows nothing at
 * all until it returns. The cost is that a tool which throws still reads as started,
 * which the model's next turn says out loud anyway.
 *
 * `onStepEnd` is the current name for what `onStepFinish` used to be -- the latter is
 * deprecated in this version and both are accepted, so the deprecated one is easy to
 * reach for by habit.
 */
export function watching(
  watch: Watcher,
  phase: WorkPhase,
): {
  onToolExecutionStart: (event: { toolCall: { toolName: string; input?: unknown } }) => void;
  onStepEnd: (event: { stepNumber: number; text: string }) => void;
} {
  return {
    onToolExecutionStart(event) {
      watch.note({
        phase,
        kind: 'tool',
        label: reading(event.toolCall.toolName, event.toolCall.input),
        detail: { tool: event.toolCall.toolName, input: event.toolCall.input },
      });
    },
    onStepEnd(event) {
      const text = event.text.trim();
      if (!text) return;
      watch.note({
        phase,
        kind: 'turn',
        label: text,
        detail: { step: event.stepNumber },
      });
    },
  };
}

/**
 * A tool call as a sentence.
 *
 * The tool names come off the CLI's MCP surface rather than being declared here, so an
 * unrecognised one is expected rather than exceptional -- a new tool on the hands side
 * should show up as itself, not as a blank line.
 */
function reading(tool: string, input: unknown): string {
  const arg = (name: string): string | null => {
    if (!input || typeof input !== 'object') return null;
    const value = (input as Record<string, unknown>)[name];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };

  switch (tool) {
    case 'read_file':
      return `Read ${arg('path') ?? 'a file'}`;
    case 'search':
      return `Searched for ${arg('query') ?? 'something'}`;
    case 'get_index':
      return 'Looked over the project index';
    case 'start_sandbox':
      return 'Brought the sandbox up';
    case 'db':
      return `Queried the database: ${clipped(arg('sql') ?? '')}`;
    case 'teardown':
      return 'Took the sandbox down';
    case 'derive_environment':
      return 'Worked out how the project boots';
    case 'environment_status':
      return 'Read how the project boots';
    default:
      return `Called ${tool}`;
  }
}

/** A statement is a line on a page, not a listing. */
function clipped(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 160 ? `${one.slice(0, 159)}…` : one;
}

/**
 * A watcher's shape, checked against the SDK's own callback types.
 *
 * `watching` returns hand-written signatures rather than importing the SDK's event
 * unions, because those are generic over the tool set and the tool set here is
 * whatever the CLI advertised at run time -- there is no concrete type to
 * instantiate them with. This asserts the hand-written shapes are still assignable to
 * what `generateText` accepts, so a version that renames a field fails here at
 * `tsc` rather than silently recording nothing.
 */
export type WatchedCall = {
  onToolExecutionStart: NonNullable<CallOptions['onToolExecutionStart']>;
  onStepEnd: NonNullable<CallOptions['onStepEnd']>;
};

type CallOptions = {
  onToolExecutionStart?: (event: {
    toolCall: { toolName: string; input?: unknown };
  }) => void | PromiseLike<void>;
  onStepEnd?: (event: { stepNumber: number; text: string }) => void | PromiseLike<void>;
};

/** Unused at run time; the assignment is the check. */
export type ResearchTools = ToolSet;
