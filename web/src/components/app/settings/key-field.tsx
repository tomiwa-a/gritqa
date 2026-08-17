'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/badge';

function maskOf(value: string) {
  const tail = value.trim().slice(-4);
  return `sk-••••••••••••${tail || '····'}`;
}

export function KeyField({ masked }: { masked: string | null }) {
  const [stored, setStored] = useState(masked);
  const [editing, setEditing] = useState(masked === null);
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState('');

  if (!editing && stored) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 min-w-0 flex-1 basis-[240px] items-center gap-2.5 rounded-md border border-rule bg-app px-3">
          <StatusDot tone="pass" label="Key stored" />
          <span className="nums truncate font-mono text-[12.5px] text-ink-muted">{stored}</span>
        </span>

        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
          Replace
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setStored(null);
            setEditing(true);
          }}
        >
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative min-w-0 flex-1 basis-[280px]">
          <Input
            dense
            type={visible ? 'text' : 'password'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste a key from your provider"
            autoComplete="off"
            spellCheck={false}
            className="pr-9 font-mono"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Hide the key' : 'Show the key'}
            className="absolute top-0 right-0 flex h-9 w-9 items-center justify-center text-ink-subtle transition-colors duration-150 hover:text-ink"
          >
            <Icon name={visible ? 'eyeOff' : 'eye'} size={15} />
          </button>
        </span>

        <Button
          size="sm"
          disabled={draft.trim().length < 8}
          onClick={() => {
            setStored(maskOf(draft));
            setDraft('');
            setVisible(false);
            setEditing(false);
          }}
        >
          Save key
        </Button>

        {stored && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft('');
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        )}
      </div>

      <p className="flex items-start gap-2 text-[11.5px] leading-snug text-ink-subtle">
        <Icon name="shield" size={13} className="mt-px shrink-0" />
        Encrypted before it is stored, and never shown back to you or written to a log. Remove it
        whenever you like — GritQA keeps running the plans you already approved.
      </p>
    </div>
  );
}
