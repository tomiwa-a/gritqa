'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icon';

const PATHS: { href: string; icon: IconName; label: string; hint: string }[] = [
  {
    href: '/dashboard/generate?from=changes',
    icon: 'sparkle',
    label: 'From what changed',
    hint: 'Draft plans for the files touched since the last index',
  },
  {
    href: '/dashboard/generate?from=endpoints',
    icon: 'endpoint',
    label: 'Pick endpoints',
    hint: 'Choose routes and describe the behaviour to cover',
  },
  {
    href: '/dashboard/generate?from=blank',
    icon: 'plan',
    label: 'Write it yourself',
    hint: 'Start from a blank plan and add your own steps',
  },
];

export function GenerateMenu() {
  const [open, setOpen] = useState(false);
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
      <div className="flex h-8 items-stretch overflow-hidden rounded-md bg-ink text-ink-inverse shadow-[0_1px_2px_rgba(27,29,46,0.16)]">
        <Link
          href="/dashboard/generate"
          className="flex items-center gap-1.5 pr-2.5 pl-3 text-[13px] font-medium transition-colors duration-150 hover:bg-space-indigo"
        >
          <Icon name="sparkle" size={14} />
          <span className="hidden sm:inline">Generate tests</span>
          <span className="sm:hidden">Generate</span>
        </Link>
        <span aria-hidden className="my-1.5 w-px bg-white/20" />
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Choose how to generate tests"
          onClick={() => setOpen((v) => !v)}
          className="flex w-7 items-center justify-center transition-colors duration-150 hover:bg-space-indigo"
        >
          <Icon name="chevronDown" size={14} />
        </button>
      </div>

      {open && (
        <div
          role="menu"
          className="absolute top-[calc(100%+6px)] right-0 z-40 w-[288px] rounded-lg border border-rule bg-app-panel p-1.5 shadow-menu"
        >
          {PATHS.map((p) => (
            <Link
              key={p.label}
              href={p.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex gap-2.5 rounded-md p-2 transition-colors duration-150 hover:bg-app-hover"
            >
              <Icon name={p.icon} size={15} className="mt-0.5 text-ink-subtle" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{p.label}</span>
                <span className="block text-[11.5px] leading-snug text-ink-subtle">{p.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
