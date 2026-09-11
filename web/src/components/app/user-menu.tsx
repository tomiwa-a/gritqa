'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { initialsOf } from '@/components/ui/avatar';
import type { ShellUser } from './shell-data';
import { cn } from '@/lib/cn';

const PROVIDER = { github: 'GitHub', gitlab: 'GitLab' } as const;

export function UserMenu({ user, collapsed = false }: { user: ShellUser; collapsed?: boolean }) {
  const initials = initialsOf(user.name);
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
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        title={collapsed ? user.name : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-11 w-full items-center rounded-md text-left transition-colors duration-150 hover:bg-app-hover',
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-1.5',
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-rule bg-app text-[11.5px] font-semibold text-ink-muted">
          {initials}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium leading-tight text-ink">
                {user.name}
              </span>
              <span className="block truncate text-[11.5px] leading-tight text-ink-subtle">
                {user.email}
              </span>
            </span>
            <Icon name="chevronUpDown" size={14} className="text-ink-subtle" />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+4px)] left-0 z-40 w-[248px] rounded-lg border border-rule bg-app-panel p-1.5 shadow-menu"
        >
          <div className="flex items-center gap-2 px-2 py-1.5">
            <Icon name={user.provider} size={14} className="text-ink-muted" />
            <span className="text-[12px] text-ink-subtle">
              Signed in with {PROVIDER[user.provider]}
            </span>
          </div>

          <div className="my-1.5 h-px bg-rule" />

          <MenuLink
            href="/dashboard/settings"
            icon="user"
            label="Account"
            onDone={() => setOpen(false)}
          />
          <MenuLink
            href="/dashboard/projects"
            icon="projects"
            label="Projects"
            onDone={() => setOpen(false)}
          />
          <MenuLink
            href="/onboarding"
            icon="terminal"
            label="CLI setup"
            onDone={() => setOpen(false)}
          />

          <div className="my-1.5 h-px bg-rule" />

          {/* A form, not a link: signing out has to be a POST, or any page that can
              get the browser to fetch a URL -- an <img src> is enough -- can sign the
              developer out. It also means it still works with JavaScript off. */}
          <form action="/api/auth/sign-out" method="post">
            <button
              type="submit"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-ink-muted transition-colors duration-150 hover:bg-fail-soft hover:text-fail"
            >
              <Icon name="signOut" size={14} />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  label,
  onDone,
}: {
  href: string;
  icon: 'user' | 'projects' | 'terminal';
  label: string;
  onDone: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onDone}
      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-ink-muted transition-colors duration-150 hover:bg-app-hover hover:text-ink"
    >
      <Icon name={icon} size={14} />
      {label}
    </Link>
  );
}
