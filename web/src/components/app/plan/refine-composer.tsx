'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

const EXAMPLES = [
  'Assert the tax total, not just the status.',
  'Use a card that gets declined for the second attempt.',
  'Drop the step that lists orders — it proves nothing.',
];

export function RefineComposer({ nextVersion }: { nextVersion: number }) {
  const [text, setText] = useState('');
  const ready = text.trim().length > 0;

  return (
    <div className="flex flex-col gap-3 p-4">
      <label htmlFor="refine" className="text-[13px] font-medium text-ink">
        What should change about this plan?
      </label>

      <textarea
        id="refine"
        name="refine"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Say it the way you would say it to a colleague."
        className="w-full resize-y rounded-lg border border-rule bg-app px-3 py-2.5 text-[13px] leading-relaxed text-ink placeholder:text-ink-subtle focus:border-rule-strong focus:bg-app-panel"
      />

      {!ready && (
        <ul className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button
                type="button"
                onClick={() => setText(example)}
                className="rounded-md border border-rule bg-app-panel px-2 py-1 text-left text-[11.5px] text-ink-muted transition-colors duration-150 hover:border-rule-strong hover:text-ink"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="sm" disabled={!ready}>
          <Icon name="sparkle" size={14} />
          Ask for a new version
        </Button>

        <p className="nums text-[11.5px] text-ink-subtle">
          This writes <span className="font-mono">v{nextVersion}</span> for you to read. The plan you
          approved is never edited underneath you.
        </p>
      </div>
    </div>
  );
}
