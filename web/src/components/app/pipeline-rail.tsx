import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icon';
import { StatusDot } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

export type Stage = {
  key: string;
  icon: IconName;
  label: string;
  value: string;
  unit: string;
  hint: string;
  href: string;
  tone?: 'warn' | 'fail';
};

export function PipelineRail({ stages }: { stages: Stage[] }) {
  return (
    <div className="grid grid-cols-1 gap-px bg-rule-soft sm:grid-cols-2 lg:grid-cols-5">
      {stages.map((stage, i) => (
        <Link
          key={stage.key}
          href={stage.href}
          className="relative flex flex-col gap-1.5 bg-app-panel px-4 py-3.5 transition-colors duration-150 hover:bg-app-hover"
        >
          {i > 0 && (
            <span
              aria-hidden
              className={cn(
                'absolute top-1/2 -left-[9px] z-10 hidden h-[18px] w-[18px] -translate-y-1/2',
                'items-center justify-center rounded-full border border-rule bg-app text-ink-subtle',
                'lg:flex',
              )}
            >
              <Icon name="chevronRight" size={10} />
            </span>
          )}

          <span className="flex items-center gap-1.5">
            <Icon name={stage.icon} size={12} className="text-ink-subtle" />
            <span className="font-mono text-[9.5px] tracking-[0.14em] text-ink-subtle uppercase">
              {stage.label}
            </span>
            {stage.tone && <StatusDot tone={stage.tone} className="ml-auto" />}
          </span>

          <span className="flex items-baseline gap-1">
            <span className="nums text-metric-sm text-ink">{stage.value}</span>
            <span className="text-[12px] text-ink-subtle">{stage.unit}</span>
          </span>

          <span className="text-[11.5px] leading-snug text-ink-subtle">{stage.hint}</span>
        </Link>
      ))}
    </div>
  );
}
