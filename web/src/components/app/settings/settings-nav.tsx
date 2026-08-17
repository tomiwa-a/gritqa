import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

export type SettingsKey = 'account' | 'ai' | 'project' | 'activity';

const ITEMS: { key: SettingsKey; href: string; icon: IconName; label: string }[] = [
  { key: 'account', href: '/dashboard/settings', icon: 'user', label: 'Account' },
  { key: 'ai', href: '/dashboard/settings/ai', icon: 'sparkle', label: 'AI drafting' },
  { key: 'project', href: '/dashboard/settings/project', icon: 'folder', label: 'Project' },
  { key: 'activity', href: '/dashboard/settings/activity', icon: 'clock', label: 'Activity' },
];

export function SettingsNav({ active }: { active: SettingsKey }) {
  return (
    <nav aria-label="Settings sections" className="lg:sticky lg:top-20">
      <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {ITEMS.map((item) => {
          const on = item.key === active;

          return (
            <li key={item.key} className="relative shrink-0 lg:shrink">
              <Link
                href={item.href}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] whitespace-nowrap',
                  'transition-colors duration-150',
                  on
                    ? 'bg-app-active font-medium text-ink'
                    : 'text-ink-muted hover:bg-app-hover hover:text-ink',
                )}
              >
                <Icon
                  name={item.icon}
                  size={14}
                  className={on ? 'text-ink' : 'text-ink-subtle'}
                />
                {item.label}
              </Link>
              {on && (
                <span
                  aria-hidden
                  className="absolute top-1.5 -left-2 hidden h-5 w-[2px] rounded-full bg-punch-red lg:block"
                />
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
