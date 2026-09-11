'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

export function CopyCommand({
  command,
  label,
  className,
}: {
  command: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className={className}>
      {label && (
        <p className="mb-1.5 text-[11px] tracking-[0.06em] text-ink-subtle uppercase">{label}</p>
      )}
      <div className="flex items-center gap-3 rounded-lg border border-rule-dark bg-surface-dark px-3.5 py-2.5">
        <span aria-hidden className="font-mono text-[12px] text-term-dim select-none">
          $
        </span>
        <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[12.5px] whitespace-nowrap text-ink-inverse [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {command}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(command);
            setCopied(true);
          }}
          aria-label={copied ? 'Copied' : `Copy: ${command}`}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded border',
            'transition-colors duration-150',
            copied
              ? 'border-term-pass/40 text-term-pass'
              : 'border-rule-dark text-term-dim hover:border-ink-subtle hover:text-ink-inverse',
          )}
        >
          <Icon name={copied ? 'check' : 'copy'} size={13} />
        </button>
      </div>
    </div>
  );
}
