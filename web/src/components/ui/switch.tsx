'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Two modes, because a switch that only moves and a switch that saves are not the
 * same control. Pass `on` and it is controlled by whoever owns the value -- a form
 * with a server action, in practice -- and `type="submit"` makes the flip the
 * submit. Leave `on` off and it keeps its own state, which is right for a switch
 * that is illustrating something rather than deciding it.
 */
export function Switch({
  label,
  on,
  defaultOn = false,
  disabled,
  type = 'button',
  className,
}: {
  label: string;
  /** Controlled value. When given, the component holds no state of its own. */
  on?: boolean;
  defaultOn?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  const [local, setLocal] = useState(defaultOn);
  const controlled = on !== undefined;
  const value = controlled ? on : local;

  return (
    <button
      type={type}
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled}
      onClick={controlled ? undefined : () => setLocal((v) => !v)}
      className={cn(
        'relative h-[22px] w-[38px] shrink-0 rounded-full border',
        'transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-45',
        value ? 'border-ink bg-ink' : 'border-rule-strong bg-app-active hover:border-ink-subtle',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-[2px] h-4 w-4 rounded-full bg-app-panel',
          'shadow-[0_1px_2px_rgba(27,29,46,0.24)] transition-[left] duration-150 ease-out',
          value ? 'left-[18px]' : 'left-[2px]',
        )}
      />
    </button>
  );
}
