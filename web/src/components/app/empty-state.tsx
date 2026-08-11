import { Icon, type IconName } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  className,
}: {
  icon: IconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-rule-strong bg-app-panel text-center',
        size === 'sm' ? 'gap-2 px-6 py-8' : 'gap-3 px-6 py-14',
        className,
      )}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-rule bg-app text-ink-subtle">
        <Icon name={icon} size={17} />
      </span>
      <div>
        <p className="text-[14px] font-medium text-ink">{title}</p>
        {description && (
          <p className="mx-auto mt-1 max-w-[46ch] text-[13px] leading-relaxed text-ink-muted">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
