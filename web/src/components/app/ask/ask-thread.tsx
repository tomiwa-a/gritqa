import { TurnRow } from '../plan/revision-thread';
import { Icon } from '@/components/ui/icon';
import { Prose } from '@/components/ui/prose';
import type { AgentStep, ConversationTurn } from '@/lib/model';

/**
 * The exchange, oldest first.
 *
 * `TurnRow` is borrowed from the refine thread rather than reimplemented, because a
 * turn is a turn: the same disc, the same accent for GritQA's side, the same
 * quotation for yours. The two threads read as one convention, which is most of what
 * makes the second one feel like something that was always there.
 */

/**
 * What the tools are, said the way the answer says everything else.
 *
 * The audience for this panel is someone who cannot read the code, so a line that
 * said `read_file` would be naming an implementation detail to the one person who has
 * no use for it. An unmapped tool falls through to its own name -- honest, and the
 * signal that a tool was added and this map was not.
 */
const VERBS: Record<string, string> = {
  get_index: 'read the index',
  read_file: 'read',
  search: 'searched for',
  db: 'queried the database',
  derive_environment: 'worked out how to run it',
  start_sandbox: 'started a sandbox',
};

/**
 * How it answered, folded away.
 *
 * Shut by default and open on a click, with no JavaScript involved: the account of
 * the work is what makes an answer checkable rather than trusted, and it is not what
 * anybody reads first. Results are measurements, never the results themselves -- see
 * `stepsOf` in `agent/ask.ts` for why that is a boundary and not a shortcut.
 */
function Steps({ steps }: { steps: AgentStep[] }) {
  return (
    <details className="group mt-2.5">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11.5px] text-ink-subtle transition-colors duration-150 hover:text-ink-muted [&::-webkit-details-marker]:hidden">
        <Icon
          name="chevronRight"
          size={11}
          className="transition-transform duration-150 group-open:rotate-90"
        />
        <span className="nums">
          How it answered · {steps.length} step{steps.length === 1 ? '' : 's'}
        </span>
      </summary>

      <ul className="mt-1.5 flex flex-col gap-1 border-l border-rule-soft pl-2.5">
        {steps.map((step, i) => (
          <li
            key={`${step.tool}-${i}`}
            className="flex flex-wrap items-baseline gap-x-1.5 text-[11.5px] leading-snug"
          >
            <span className="text-ink-muted">{VERBS[step.tool] ?? step.tool}</span>
            {step.subject && (
              <span className="min-w-0 font-mono text-[11px] break-all text-ink-subtle">
                {step.subject}
              </span>
            )}
            {step.digest && <span className="nums text-ink-subtle">— {step.digest}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function AskThread({
  turns,
  author,
  size = 'sm',
}: {
  turns: ConversationTurn[];
  author: string;
  /** The drawer is narrow and the conversation page is not. */
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <ol className="flex flex-col">
      {turns.map((turn, i) => {
        const mine = turn.author === 'you';
        return (
          <TurnRow
            key={turn.publicId}
            who={mine ? author : 'GritQA'}
            whenLabel={turn.whenLabel}
            mine={mine}
            divide={i < turns.length - 1}
          >
            {mine ? (
              <blockquote className="mt-2 border-l-2 border-punch-red pl-3 text-[13px] leading-relaxed whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
                {turn.body}
              </blockquote>
            ) : (
              <>
                <Prose size={size} className="mt-2">
                  {turn.body}
                </Prose>
                {turn.steps.length > 0 && <Steps steps={turn.steps} />}
              </>
            )}
          </TurnRow>
        );
      })}
    </ol>
  );
}
