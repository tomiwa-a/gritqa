'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/icon';
import { StatusDot } from '@/components/ui/badge';
import type { ShellCurrentProject, ShellProject } from './shell-data';
import { cn } from '@/lib/cn';

export function ProjectSwitcher({
  projects,
  currentProject,
  collapsed = false,
}: {
  projects: ShellProject[];
  currentProject: ShellCurrentProject;
  collapsed?: boolean;
}) {
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
    <div ref={root} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-10 w-full items-center rounded-md text-left transition-colors duration-150',
          'hover:bg-app-hover',
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-1.5',
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink text-[13px] font-semibold text-ink-inverse">
          {currentProject.name[0].toUpperCase()}
        </span>

        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium leading-tight text-ink">
                {currentProject.name}
              </span>
              <span className="block truncate font-mono text-[11px] leading-tight text-ink-subtle">
                {currentProject.defaultBranch}
              </span>
            </span>
            <Icon name="chevronUpDown" size={14} className="text-ink-subtle" />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+4px)] z-40 w-[264px] rounded-lg border border-rule bg-app-panel p-1.5 shadow-menu"
        >
          <p className="px-2 pb-1.5 pt-1 text-[11px] font-medium text-ink-subtle">Projects</p>

          {projects.map((p) => {
            const active = p.publicId === currentProject.publicId;
            return (
              <button
                key={p.publicId}
                type="button"
                role="menuitem"
                onClick={() => setOpen(false)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
                  'transition-colors duration-150 hover:bg-app-hover',
                )}
              >
                <StatusDot tone={p.status === 'active' ? 'live' : 'draft'} label={p.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{p.name}</span>
                  <span className="block truncate text-[11.5px] text-ink-subtle">
                    {p.lastIndexedLabel ? `Indexed ${p.lastIndexedLabel}` : 'Never indexed'}
                  </span>
                </span>
                {active && <Icon name="check" size={14} className="text-pass" />}
              </button>
            );
          })}

          <div className="my-1.5 h-px bg-rule" />

          <button
            type="button"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-ink-muted transition-colors duration-150 hover:bg-app-hover hover:text-ink"
          >
            <Icon name="plus" size={14} />
            Add a project
          </button>
        </div>
      )}
    </div>
  );
}
