'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { askAction, type AskState } from '@/lib/actions/ask';

/**
 * The box. It is the resting state of this panel, which is the whole of decision 2:
 * asking is not a mode you select, it is what the panel does, and drafting a plan is
 * a button underneath it.
 *
 * Split in two so a landed answer empties the field by *remounting* it, the same
 * pattern and the same reason as `RefineComposer` -- an effect that watched for
 * success and called `setText('')` would be a render followed by a second render to
 * undo part of it.
 */

const EXAMPLES = [
  'What does creating a booking actually require?',
  'Which routes need a signed-in admin?',
  'What happens if I book a room that is already taken?',
];

export function AskComposer({
  conversation,
  /** First turn of a new thread: the copy and the placeholder both change. */
  opening,
}: {
  conversation: string;
  opening: boolean;
}) {
  const [state, submit, pending] = useActionState(askAction, null);
  const landed = state && 'ok' in state ? state.turn : 0;

  return (
    <Box
      key={landed}
      conversation={conversation}
      opening={opening}
      state={state}
      submit={submit}
      pending={pending}
    />
  );
}

function Box({
  conversation,
  opening,
  state,
  submit,
  pending,
}: {
  conversation: string;
  opening: boolean;
  state: AskState;
  submit: (formData: FormData) => void;
  pending: boolean;
}) {
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const pathname = usePathname() ?? '/dashboard';
  const search = useSearchParams()?.toString();
  const ready = text.trim().length > 0 && !pending;

  /* The panel only opens because you have something to ask, so the caret lands in
     the field rather than making you click into it first. */
  useEffect(() => {
    field.current?.focus();
  }, []);

  return (
    <form action={submit} className="flex flex-col gap-2">
      <input type="hidden" name="conversation" value={conversation} />
      {/* Where the panel is open, so a new thread can be addressed without leaving
          the page underneath it. The action drops the overlay params and sets its own. */}
      <input type="hidden" name="here" value={search ? `${pathname}?${search}` : pathname} />

      <textarea
        id="question"
        name="question"
        ref={field}
        rows={opening ? 3 : 2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        placeholder={
          opening ? 'Ask about anything in this codebase.' : 'Ask a follow-up, or push back.'
        }
        className="w-full resize-none rounded-lg border border-rule bg-app px-2.5 py-2 text-[12.5px] leading-relaxed text-ink placeholder:text-ink-subtle focus:border-rule-strong focus:bg-app-panel disabled:opacity-60"
      />

      {/* Something to start from, in one line, so the field keeps the room. */}
      {opening && !text && !pending && (
        <ul className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 pb-1">
          {EXAMPLES.map((example) => (
            <li key={example} className="shrink-0">
              <button
                type="button"
                onClick={() => setText(example)}
                className="rounded-md border border-rule bg-app-panel px-2 py-1 text-[11.5px] whitespace-nowrap text-ink-muted transition-colors duration-150 hover:border-rule-strong hover:text-ink"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button type="submit" variant="primary" size="sm" disabled={!ready} className="w-full">
        <Icon
          name={pending ? 'refresh' : 'sparkle'}
          size={14}
          className={cn(pending && 'animate-spin')}
        />
        {pending ? 'Reading your code…' : 'Ask'}
      </Button>

      {pending ? (
        <p className="text-[11px] leading-snug text-ink-subtle">
          Looking at the code before answering. Usually seconds.
        </p>
      ) : state && 'error' in state ? (
        <p className="text-[11.5px] leading-snug text-punch-red">{state.error}</p>
      ) : (
        <p className="text-[11px] leading-snug text-ink-subtle">
          GritQA reads your real code to answer. It never changes it, and nothing runs from here.
        </p>
      )}
    </form>
  );
}
