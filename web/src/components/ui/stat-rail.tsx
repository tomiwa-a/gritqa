import { cn } from '@/lib/cn';

export type StatItem = {
  value: string;
  /** Rendered smaller and dimmer, immediately after the value. */
  unit?: string;
  label: string;
};

/** Two columns on mobile, one row from `sm` up. */
const COLS: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
};

/**
 * Metric rail. Hairline dividers between cells, tabular figures so values
 * stay optically aligned as they change.
 */
export function StatRail({
  items,
  tone = 'light',
  className,
}: {
  items: StatItem[];
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const dark = tone === 'dark';

  return (
    <dl
      className={cn(
        'grid border-y',
        COLS[items.length] ?? 'grid-cols-2 sm:grid-cols-4',
        dark ? 'divide-rule-dark border-rule-dark' : 'divide-rule border-rule',
        'divide-x',
        className,
      )}
    >
      {items.map((s) => (
        <div key={s.label} className="px-4 py-6 first:pl-0 sm:px-6">
          <dd
            className={cn(
              'nums font-heading text-[1.75rem] leading-none font-semibold tracking-[-0.03em] sm:text-[2rem]',
              dark ? 'text-ink-inverse' : 'text-ink',
            )}
          >
            {s.value}
            {s.unit && (
              <span
                className={cn(
                  'ml-1 text-[0.9375rem] font-medium tracking-normal',
                  dark ? 'text-term-dim' : 'text-ink-subtle',
                )}
              >
                {s.unit}
              </span>
            )}
          </dd>
          <dt
            className={cn(
              'mt-2.5 font-mono text-[10.5px] uppercase tracking-[0.16em]',
              dark ? 'text-term-dim' : 'text-ink-subtle',
            )}
          >
            {s.label}
          </dt>
        </div>
      ))}
    </dl>
  );
}
