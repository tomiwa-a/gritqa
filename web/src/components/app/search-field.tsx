'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/icon';
import { Kbd } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

export function SearchField({ collapsed = false }: { collapsed?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (typing) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (collapsed) {
    return (
      <button
        type="button"
        title="Search"
        onClick={() => input.current?.focus()}
        className="flex h-9 w-9 items-center justify-center rounded-md text-ink-subtle transition-colors duration-150 hover:bg-app-hover hover:text-ink"
      >
        <Icon name="search" size={16} />
        <span className="sr-only">Search</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        'group flex h-9 items-center gap-2 rounded-md border border-rule bg-app px-2.5',
        'transition-colors duration-150 focus-within:border-rule-strong focus-within:bg-app-panel',
      )}
    >
      <Icon name="search" size={15} className="text-ink-subtle" />
      <input
        ref={input}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && input.current?.blur()}
        placeholder="Search plans, runs, endpoints"
        aria-label="Search plans, runs, endpoints"
        className={cn(
          'min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none',
          'placeholder:text-ink-subtle',
          '[&::-webkit-search-cancel-button]:hidden',
        )}
      />
      {!value && (
        <Kbd className="h-[18px] min-w-[18px] border-rule bg-app-panel text-[10.5px] group-focus-within:hidden">
          /
        </Kbd>
      )}
    </div>
  );
}
