'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

export function Switch({
  label,
  defaultOn = false,
  disabled,
  className,
}: {
  label: string;
  defaultOn?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [on, setOn] = useState(defaultOn);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => setOn((v) => !v)}
      className={cn(
        'relative h-[22px] w-[38px] shrink-0 rounded-full border',
        'transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-45',
        on ? 'border-ink bg-ink' : 'border-rule-strong bg-app-active hover:border-ink-subtle',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-[2px] h-4 w-4 rounded-full bg-app-panel',
          'shadow-[0_1px_2px_rgba(27,29,46,0.24)] transition-[left] duration-150 ease-out',
          on ? 'left-[18px]' : 'left-[2px]',
        )}
      />
    </button>
  );
}
