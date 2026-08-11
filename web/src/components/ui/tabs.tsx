'use client';

import { useId, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export type TabItem = {
  id: string;
  label: string;
  index?: string;
  panel: React.ReactNode;
};

export function Tabs({
  items,
  label,
  defaultId,
  className,
  panelClassName,
}: {
  items: TabItem[];
  label: string;
  defaultId?: string;
  className?: string;
  panelClassName?: string;
}) {
  const [active, setActive] = useState(defaultId ?? items[0].id);
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = (id: string) => `${base}-panel-${id}`;
  const current = items.find((t) => t.id === active) ?? items[0];

  function onKeyDown(e: React.KeyboardEvent) {
    const i = items.findIndex((t) => t.id === active);
    let next = -1;

    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else return;

    e.preventDefault();
    const id = items[next].id;
    setActive(id);
    refs.current[id]?.focus();
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex overflow-x-auto border-b border-rule"
      >
        {items.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              role="tab"
              id={tabId(t.id)}
              aria-selected={selected}
              aria-controls={panelId(t.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.id)}
              className={cn(
                'group relative flex shrink-0 items-baseline gap-2 px-4 py-3.5 first:pl-0',
                'text-sm whitespace-nowrap transition-colors duration-150 ease-out',
                selected ? 'text-ink' : 'text-ink-subtle hover:text-ink-muted',
              )}
            >
              {t.index && (
                <span
                  className={cn(
                    'nums text-[11px] font-semibold',
                    selected ? 'text-punch-red' : 'text-ink-subtle',
                  )}
                >
                  {t.index}
                </span>
              )}
              <span className={selected ? 'font-medium' : ''}>{t.label}</span>

              <span
                aria-hidden
                className={cn(
                  'absolute inset-x-0 -bottom-px h-[2px] transition-colors duration-150',
                  selected ? 'bg-ink' : 'bg-transparent',
                )}
              />
            </button>
          );
        })}
      </div>

      <div
        key={current.id}
        role="tabpanel"
        id={panelId(current.id)}
        aria-labelledby={tabId(current.id)}
        tabIndex={0}
        className={cn('focus-visible:outline-none', panelClassName)}
      >
        {current.panel}
      </div>
    </div>
  );
}
