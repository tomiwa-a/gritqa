import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icon';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

export function NavItem({
  href,
  icon,
  label,
  count,
  notice = false,
  active = false,
  collapsed = false,
  onNavigate,
}: {
  href: string;
  icon: IconName;
  label: string;
  count?: number;
  notice?: boolean;
  active?: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        'group relative flex h-9 items-center rounded-md text-[13.5px]',
        'transition-colors duration-150 ease-out',
        collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
        active
          ? 'bg-app-active font-medium text-ink'
          : 'text-ink-muted hover:bg-app-hover hover:text-ink',
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute -left-2 top-1/2 h-[18px] w-[2px] -translate-y-1/2 rounded-r-full bg-punch-red"
        />
      )}

      <Icon
        name={icon}
        size={16}
        className={active ? 'text-ink' : 'text-ink-subtle group-hover:text-ink-muted'}
      />

      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {count !== undefined && count > 0 && (
            <Badge variant={notice ? 'notice' : 'count'} size="xs" className="nums">
              {count}
            </Badge>
          )}
        </>
      )}
    </Link>
  );
}
