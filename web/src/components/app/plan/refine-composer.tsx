'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

const EXAMPLES = [
  'Assert the tax total, not just the status.',
  'Use a card that gets declined for the second attempt.',
  'Drop the step that lists orders — it proves nothing.',
];

/**
 * The next turn in the conversation, so it sits where the next turn goes: pinned
 * under the thread it belongs to, in the panel's narrow column.
 */
export function RefineComposer({ nextVersion }: { nextVersion: number }) {
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const ready = text.trim().length > 0;

  /* This panel only ever opens because you asked for a change, so the caret
     lands in the field rather than making you click into it first. */
  useEffect(() => {
    field.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-2">
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
        placeholder="Say it the way you would say it to a colleague."
        className="w-full resize-none rounded-lg border border-rule bg-app px-2.5 py-2 text-[12.5px] leading-relaxed text-ink placeholder:text-ink-subtle focus:border-rule-strong focus:bg-app-panel"
      />

      {/* Something to start from, in one line, so the field keeps the room. */}
      {!ready && (
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

      <Button variant="primary" size="sm" disabled={!ready} className="w-full">
        <Icon name="sparkle" size={14} />
        Ask for a new version
      </Button>

      <p className="nums text-[11px] leading-snug text-ink-subtle">
        Writes <span className="font-mono">v{nextVersion}</span> for you to read. Nothing you
        already approved is edited underneath you.
      </p>
    </div>
  );
}
