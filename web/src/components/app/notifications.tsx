'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { StatusDot } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

const ITEMS = [
  {
    tone: 'fail' as const,
    title: 'Charge a checkout with a mocked provider failed',
    detail: 'Apply tax returned 500',
    when: '12m ago',
    href: '/dashboard/runs',
  },
  {
    tone: 'review' as const,
    title: '2 new plans need your review',
    detail: 'Drafted from this morning’s push',
    when: '2h ago',
    href: '/dashboard/queue',
  },
  {
    tone: 'fail' as const,
    title: 'Subscription lifecycle failed',
    detail: 'Cancel it returned 409',
    when: '3h ago',
    href: '/dashboard/runs',
  },
];

export function Notifications() {
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={read ? 'Notifications' : 'Notifications, unread'}
        onClick={() => {
          setOpen((v) => !v);
          setRead(true);
        }}
        className={cn(
          'relative flex h-8 w-8 items-center justify-center rounded-md',
          'text-ink-muted transition-colors duration-150 hover:bg-app-hover hover:text-ink',
          open && 'bg-app-active text-ink',
        )}
      >
        <Icon name="bell" size={16} />
        {!read && (
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-punch-red ring-2 ring-app-panel" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-[calc(100%+6px)] right-0 z-40 w-[312px] rounded-lg border border-rule bg-app-panel shadow-menu"
        >
          <div className="flex items-center justify-between border-b border-rule-soft px-3 py-2">
            <span className="text-[12.5px] font-medium text-ink">Activity</span>
            <span className="nums text-[11.5px] text-ink-subtle">{ITEMS.length} today</span>
          </div>

          <div className="p-1.5">
            {ITEMS.map((n) => (
              <Link
                key={n.title}
                href={n.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex gap-2.5 rounded-md p-2 transition-colors duration-150 hover:bg-app-hover"
              >
                <span className="mt-1.5">
                  <StatusDot tone={n.tone} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] leading-snug text-ink">{n.title}</span>
                  <span className="block text-[11.5px] text-ink-subtle">
                    {n.detail} · {n.when}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
