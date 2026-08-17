'use client';

import { useId, useState } from 'react';
import { Icon } from './icon';
import { cn } from '@/lib/cn';

export function Checkbox({
  children,
  defaultChecked = false,
  className,
}: {
  children: React.ReactNode;
  defaultChecked?: boolean;
  className?: string;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  const id = useId();

  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-labelledby={id}
        onClick={() => setChecked((v) => !v)}
        className={cn(
          'mt-px flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[5px] border',
          'transition-colors duration-150 ease-out',
          checked
            ? 'border-ink bg-ink text-ink-inverse'
            : 'border-rule-strong bg-app-panel hover:border-ink-subtle',
        )}
      >
        {checked && <Icon name="check" size={11} strokeWidth={2.6} />}
      </button>
      <label
        id={id}
        onClick={() => setChecked((v) => !v)}
        className="cursor-pointer text-[12.5px] leading-snug text-ink-muted select-none"
      >
        {children}
      </label>
    </div>
  );
}
