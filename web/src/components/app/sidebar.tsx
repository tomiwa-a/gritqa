'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/icon';
import { NavItem } from './nav-item';
import { ProjectSwitcher } from './project-switcher';
import { SearchField } from './search-field';
import { SetupCard } from './setup-card';
import { UserMenu } from './user-menu';
import { plansAwaitingReview, projects } from '@/lib/mock/data';
import { cn } from '@/lib/cn';

type Item = { href: string; icon: IconName; label: string; count?: number; notice?: boolean };
type Group = { key: string; label: string; items: Item[] };

const GROUPS: Group[] = [
  {
    key: 'essentials',
    label: 'Essentials',
    items: [
      { href: '/dashboard', icon: 'overview', label: 'Overview' },
      {
        href: '/dashboard/queue',
        icon: 'queue',
        label: 'Review queue',
        count: plansAwaitingReview.length,
        notice: true,
      },
      { href: '/dashboard/runs', icon: 'runs', label: 'Runs' },
    ],
  },
  {
    key: 'project',
    label: 'This project',
    items: [
      { href: '/dashboard/test-plans', icon: 'plan', label: 'Test plans' },
      { href: '/dashboard/rules', icon: 'rules', label: 'Rules' },
      { href: '/dashboard/mocks', icon: 'mock', label: 'Mock server' },
      { href: '/dashboard/codebase', icon: 'codebase', label: 'Codebase' },
    ],
  },
  {
    key: 'account',
    label: 'Account',
    items: [
      { href: '/dashboard/projects', icon: 'projects', label: 'Projects', count: projects.length },
      { href: '/dashboard/settings', icon: 'settings', label: 'Settings' },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === '/dashboard' ? pathname === href : pathname.startsWith(href);
}

export function Sidebar({
  collapsed = false,
  onToggleCollapse,
  onNavigate,
}: {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? '/dashboard';
  const [shut, setShut] = useState<string[]>([]);

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-rule bg-app-panel',
        collapsed ? 'w-[60px]' : 'w-[268px]',
      )}
    >
      <div className={cn('flex items-center gap-1 px-2 pt-2', collapsed && 'flex-col')}>
        <ProjectSwitcher collapsed={collapsed} />
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors duration-150 hover:bg-app-hover hover:text-ink lg:flex"
          >
            <Icon name="panel" size={16} />
          </button>
        )}
      </div>

      <div className={cn('px-2 pt-2', collapsed && 'flex justify-center')}>
        <SearchField collapsed={collapsed} />
      </div>

      <nav className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {GROUPS.map((group, i) => {
          const open = !shut.includes(group.key);
          return (
            <div key={group.key} className={cn(i > 0 && 'mt-4')}>
              {collapsed ? (
                i > 0 && <div className="mx-auto mb-2 h-px w-6 bg-rule-soft" />
              ) : (
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() =>
                    setShut((s) =>
                      s.includes(group.key) ? s.filter((k) => k !== group.key) : [...s, group.key],
                    )
                  }
                  className="group mb-1 flex h-6 w-full items-center gap-1 px-2.5 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase transition-colors duration-150 hover:text-ink-muted"
                >
                  {group.label}
                  <Icon
                    name="chevronRight"
                    size={12}
                    className={cn(
                      'opacity-0 transition-[transform,opacity] duration-150 group-hover:opacity-100',
                      open && 'rotate-90',
                    )}
                  />
                </button>
              )}

              {(open || collapsed) && (
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <NavItem
                      key={item.href}
                      {...item}
                      collapsed={collapsed}
                      active={isActive(pathname, item.href)}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="px-2 pb-2">
          <SetupCard />
        </div>
      )}

      <div className="flex flex-col gap-0.5 border-t border-rule-soft px-2 py-2">
        <button
          type="button"
          disabled
          title="Coming with dark mode"
          className={cn(
            'flex h-9 items-center rounded-md text-[13.5px] text-ink-subtle',
            collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
            'cursor-not-allowed',
          )}
        >
          <Icon name="appearance" size={16} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Appearance</span>
              <span className="text-[11px] text-ink-subtle">Soon</span>
            </>
          )}
        </button>

        <NavItem
          href="mailto:support@gritqa.dev"
          icon="help"
          label="Help & support"
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      </div>

      <div className="border-t border-rule-soft px-2 py-2">
        <UserMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}
