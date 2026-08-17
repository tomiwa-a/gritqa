import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

export type SegmentedOption = {
  key: string;
  label: string;
  href: string;
  icon?: IconName;
  dot?: string;
  count?: number;
};

export function Segmented({
  options,
  active,
  label,
  className,
}: {
  options: SegmentedOption[];
  active: string;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex h-8 items-center gap-0.5 rounded-md border border-rule bg-app-panel p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const on = option.key === active;
        return (
          <Link
            key={option.key}
            href={option.href}
            aria-current={on ? 'true' : undefined}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[12.5px] whitespace-nowrap',
              'transition-colors duration-150',
              on ? 'bg-app-active font-medium text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.icon && <Icon name={option.icon} size={13} />}
            {option.dot && <span className={cn('h-1.5 w-1.5 rounded-full', option.dot)} />}
            {option.label}
            {option.count !== undefined && (
              <span className="nums text-[11px] text-ink-subtle">{option.count}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
