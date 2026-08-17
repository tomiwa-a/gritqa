'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

/**
 * Filtering happens on the server like every other list in here, so this only
 * has to keep the param in step with what you type.
 */
export function CommitSearch({
  action,
  defaultValue = '',
}: {
  /** The URL to append the query to, with any other params already on it. */
  action: string;
  defaultValue?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (value === defaultValue) return;

    const timer = setTimeout(() => {
      const query = value.trim();
      const href = query
        ? `${action}${action.includes('?') ? '&' : '?'}q=${encodeURIComponent(query)}`
        : action;
      startTransition(() => router.replace(href, { scroll: false }));
    }, 200);

    return () => clearTimeout(timer);
  }, [value, defaultValue, action, router]);

  return (
    <div
      className={cn(
        'flex h-8 items-center gap-2 rounded-md border border-rule bg-app px-2.5',
        'transition-colors duration-150 focus-within:border-rule-strong focus-within:bg-app-panel',
      )}
    >
      <Icon
        name={pending ? 'refresh' : 'search'}
        size={14}
        className={cn('text-ink-subtle', pending && 'animate-spin')}
      />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.stopPropagation();
            setValue('');
          }
        }}
        placeholder="Commit hash, message or author"
        aria-label="Search the history by commit hash, message or author"
        className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink outline-none placeholder:font-sans placeholder:text-ink-subtle"
      />
    </div>
  );
}
