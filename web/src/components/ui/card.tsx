import { cn } from '@/lib/cn';
import { Crosshair } from './crosshair';

export function Card({
  children,
  interactive = false,
  tone = 'light',
  className,
}: {
  children: React.ReactNode;
  interactive?: boolean;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative rounded-lg border',
        tone === 'dark'
          ? 'border-rule-dark bg-surface-dark-raised'
          : 'border-rule bg-surface',
        interactive &&
          'transition-colors duration-200 ease-out hover:border-rule-strong',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function IndexCard({
  index,
  title,
  children,
  marks = true,
  className,
}: {
  index: string;
  title: string;
  children?: React.ReactNode;
  marks?: boolean;
  className?: string;
}) {
  return (
    <article
      className={cn(
        'group relative border-t border-rule pt-5',
        'transition-colors duration-200 ease-out hover:border-ink',
        className,
      )}
    >
      {marks && <Crosshair at="tl" size="sm" />}

      <div className="flex items-baseline gap-3">
        <span className="nums font-mono text-[11px] tracking-[0.14em] text-punch-red">
          {index}
        </span>
        <h3 className="font-heading text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h3>
      </div>

      {children && <div className="mt-3">{children}</div>}
    </article>
  );
}

export function SpecList({
  items,
  tone = 'light',
  className,
}: {
  items: string[];
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <ul className={cn('space-y-2', className)}>
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-[13.5px] leading-[1.6]">
          <span
            aria-hidden
            className={cn(
              'mt-[0.6em] h-px w-3 shrink-0',
              tone === 'dark' ? 'bg-rule-dark' : 'bg-rule-strong',
            )}
          />
          <span className={tone === 'dark' ? 'text-ink-dim' : 'text-ink-muted'}>{item}</span>
        </li>
      ))}
    </ul>
  );
}
