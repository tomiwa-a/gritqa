'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { refinePlanAction, type RefineState } from '@/lib/actions/refine';

const EXAMPLES = [
  'Assert the tax total, not just the status.',
  'Use a card that gets declined for the second attempt.',
  'Drop the step that lists orders — it proves nothing.',
];

/**
 * The next turn in the conversation, so it sits where the next turn goes: pinned
 * under the thread it belongs to, in the panel's narrow column.
 *
 * Split in two so that a version landing empties the box by *remounting* it. The
 * obvious version of that is an effect watching for success and calling `setText('')`,
 * which is the pattern React now flags -- a render, then a second render to undo
 * part of it. A key is the same intent stated once: this is a new ask, so it is a
 * new field, and the caret lands in it again on the way in.
 */
export function RefineComposer(props: {
  publicId: string;
  nextVersion: number;
  /** An approved plan drops back to draft when it is revised, and that is worth saying. */
  wasApproved: boolean;
}) {
  const [state, submit, pending] = useActionState(refinePlanAction, null);
  const landed = state && 'ok' in state ? state.version : 0;

  return <Ask key={landed} {...props} state={state} submit={submit} pending={pending} />;
}

function Ask({
  publicId,
  nextVersion,
  wasApproved,
  state,
  submit,
  pending,
}: {
  publicId: string;
  nextVersion: number;
  wasApproved: boolean;
  state: RefineState;
  submit: (formData: FormData) => void;
  pending: boolean;
}) {
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const ready = text.trim().length > 0 && !pending;

  /* This panel only ever opens because you asked for a change, so the caret
     lands in the field rather than making you click into it first. */
  useEffect(() => {
    field.current?.focus();
  }, []);

  return (
    <form action={submit} className="flex flex-col gap-2">
      <input type="hidden" name="publicId" value={publicId} />

      <label htmlFor="refine" className="text-[12px] font-medium text-ink">
        What should change about this plan?
      </label>

      <textarea
        id="refine"
        name="refine"
        ref={field}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        placeholder="Say it the way you would say it to a colleague."
        className="w-full resize-none rounded-lg border border-rule bg-app px-2.5 py-2 text-[12.5px] leading-relaxed text-ink placeholder:text-ink-subtle focus:border-rule-strong focus:bg-app-panel disabled:opacity-60"
      />

      {/* Something to start from, in one line, so the field keeps the room. */}
      {!text && !pending && (
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
        {pending ? 'Reading your code…' : 'Ask for a new version'}
      </Button>

      {/* What is actually happening, because it takes long enough to wonder. */}
      {pending ? (
        <p className="text-[11px] leading-snug text-ink-subtle">
          Looking at the routes this touches before writing anything. This can take a minute.
        </p>
      ) : state && 'error' in state ? (
        <p className="text-[11.5px] leading-snug text-punch-red">{state.error}</p>
      ) : state && 'ok' in state ? (
        <p className="text-[11.5px] leading-snug text-ink-muted">
          <span className="nums font-mono text-ink">v{state.version}</span> is above.{' '}
          {state.summary}
        </p>
      ) : (
        <p className="text-[11px] leading-snug text-ink-subtle">
          Writes <span className="nums font-mono">v{nextVersion}</span> for you to read.{' '}
          {wasApproved
            ? 'It arrives as a draft — you approve the new version before anything runs it.'
            : 'Nothing runs until you approve it.'}
        </p>
      )}
    </form>
  );
}
