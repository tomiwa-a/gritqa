import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icon';
import { IconTile } from '@/components/ui/icon-tile';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export function ActionCard({
  icon,
  tone,
  label,
  value,
  unit,
  hint,
  hintIcon,
  cta,
  href,
  emphasis = false,
}: {
  icon: IconName;
  tone: 'info' | 'pass' | 'warn' | 'fail' | 'ink';
  label: string;
  value: string;
  unit?: string;
  hint: string;
  hintIcon: IconName;
  cta: string;
  href: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border bg-app-panel p-4 shadow-panel',
        emphasis ? 'border-ink/15' : 'border-rule',
      )}
    >
      <div className="flex items-start gap-3">
        <IconTile name={icon} tone={tone} variant="soft" size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium text-ink-muted">{label}</p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className="nums text-metric-lg text-ink">{value}</span>
            {unit && <span className="text-[13px] text-ink-subtle">{unit}</span>}
          </p>
        </div>
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[12.5px] leading-snug text-ink-subtle">
        <Icon name={hintIcon} size={13} className="mt-[2px]" />
        <span className="min-w-0">{hint}</span>
      </p>

      <Link
        href={href}
        className={cn(
          buttonVariants({ variant: emphasis ? 'primary' : 'secondary', size: 'sm' }),
          'mt-4 w-full justify-between',
        )}
      >
        {cta}
        <Icon
          name="arrowRight"
          size={14}
          className="transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </Link>
    </div>
  );
}
