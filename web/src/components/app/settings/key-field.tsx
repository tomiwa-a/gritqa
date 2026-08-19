'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/badge';
import { removeAiKeyAction, saveAiKeyAction } from '@/lib/actions/ai-key';

/**
 * The model key, stored for real.
 *
 * The mask comes from the server and is the only form of the key that exists on
 * this side: nothing here holds what was typed once it has been submitted, and
 * there is nothing to reveal a stored key from, because the page was never sent
 * one. The eye toggle shows what is being typed right now and nothing else.
 *
 * There is no edit mode. What is stored and the box for replacing it are both
 * always visible, which is one fewer state to get wrong and means the panel
 * always answers "is a key installed" without being asked. React clears the
 * field itself when the action resolves, so the typed key does not linger in the
 * DOM after it has been stored.
 *
 * Two sibling forms rather than one with two buttons -- removing a key and
 * replacing one are different writes, and nesting them would send the field along
 * with the removal.
 */
export function KeyField({ masked }: { masked: string | null }) {
  const [state, action] = useActionState(saveAiKeyAction, null);
  const error = state && 'error' in state ? state.error : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 min-w-0 flex-1 basis-[240px] items-center gap-2.5 rounded-md border border-rule bg-app px-3">
          <StatusDot
            tone={masked ? 'pass' : 'draft'}
            label={masked ? 'Key stored' : 'No key stored'}
          />
          <span className="nums truncate font-mono text-[12.5px] text-ink-muted">
            {masked ?? 'No key stored'}
          </span>
        </span>

        {masked && (
          <form action={removeAiKeyAction}>
            <RemoveButton />
          </form>
        )}
      </div>

      <form action={action} className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <KeyInput hasKey={Boolean(masked)} />
          <SaveButton hasKey={Boolean(masked)} />
        </div>

        {error ? (
          <p className="flex items-start gap-2 text-[11.5px] leading-snug text-warn">
            <Icon name="alert" size={13} className="mt-px shrink-0" />
            {error}
          </p>
        ) : (
          <p className="flex items-start gap-2 text-[11.5px] leading-snug text-ink-subtle">
            <Icon name="shield" size={13} className="mt-px shrink-0" />
            Encrypted before it is stored, and never shown back to you or written to a log. Remove
            it whenever you like — GritQA keeps running the plans you already approved.
          </p>
        )}
      </form>
    </div>
  );
}

/**
 * Uncontrolled, so the typed key lives in the DOM node and leaves with it. A
 * `useState` mirror would be one more place a key exists, for nothing.
 */
function KeyInput({ hasKey }: { hasKey: boolean }) {
  const [visible, setVisible] = useState(false);
  const { pending } = useFormStatus();

  return (
    <span className="relative min-w-0 flex-1 basis-[280px]">
      <Input
        dense
        name="key"
        type={visible ? 'text' : 'password'}
        placeholder={hasKey ? 'Paste a key to replace it' : 'Paste a key from your provider'}
        autoComplete="off"
        spellCheck={false}
        disabled={pending}
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
  );
}

function SaveButton({ hasKey }: { hasKey: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" type="submit" disabled={pending}>
      {pending ? 'Saving…' : hasKey ? 'Replace key' : 'Save key'}
    </Button>
  );
}

function RemoveButton() {
  const { pending } = useFormStatus();
  return (
    <Button variant="ghost" size="sm" type="submit" disabled={pending}>
      {pending ? 'Removing…' : 'Remove'}
    </Button>
  );
}
