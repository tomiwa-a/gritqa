import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

export function Panel({
  id,
  title,
  subtitle,
  meta,
  link,
  children,
  className,
  bodyClassName,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  meta?: React.ReactNode;
  link?: { href: string; label: string };
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-rule bg-app-panel shadow-panel',
        className,
      )}
    >
      <header className="flex items-center gap-3 border-b border-rule-soft px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-medium text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-[12px] text-ink-subtle">{subtitle}</p>}
        </div>
        {meta}
        {link && (
          <Link
            href={link.href}
            className="group flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
          >
            {link.label}
            <Icon
              name="arrowRight"
              size={13}
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </Link>
        )}
      </header>
      <div className={cn('min-w-0 flex-1', bodyClassName ?? 'p-4')}>{children}</div>
    </section>
  );
}
