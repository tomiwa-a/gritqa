import { cn } from '@/lib/cn';

export function SplitSurface({
  left,
  right,
  leftLabel,
  rightLabel,
  connector = 'in sync',
  tone = 'dark',
  className,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  leftLabel: string;
  rightLabel: string;
  connector?: string;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const dark = tone === 'dark';
  const rule = dark ? 'bg-rule-dark' : 'bg-rule-strong';
  const labelCls = cn(
    'text-[12px] font-semibold',
    dark ? 'text-ink-inverse' : 'text-ink',
  );

  return (
    <div
      className={cn(
        'grid items-center gap-y-6 lg:grid-cols-[1fr_auto_1fr] lg:gap-x-6',
        className,
      )}
    >
      <div className="min-w-0">
        <p className={cn(labelCls, 'mb-3 flex items-center gap-2')}>
          <span aria-hidden className={cn('h-px w-4 shrink-0', 'bg-punch-red')} />
          {leftLabel}
        </p>
        {left}
      </div>

      <div
        aria-hidden
        className="flex items-center justify-center gap-2 lg:h-32 lg:flex-col"
      >
        <span className={cn('h-px w-8 lg:h-full lg:w-px', rule)} />
        <span
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px] tracking-[0.1em] uppercase',
            dark
              ? 'border-rule-dark bg-surface-dark text-ink-dim'
              : 'border-rule bg-surface text-ink-subtle',
          )}
        >
          {connector}
        </span>
        <span className={cn('h-px w-8 lg:h-full lg:w-px', rule)} />
      </div>

      <div className="min-w-0">
        <p className={cn(labelCls, 'mb-3 flex items-center gap-2')}>
          <span aria-hidden className="h-px w-4 shrink-0 bg-punch-red" />
          {rightLabel}
        </p>
        {right}
      </div>
    </div>
  );
}
