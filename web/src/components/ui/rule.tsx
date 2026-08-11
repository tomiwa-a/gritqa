import { cn } from '@/lib/cn';

type RuleProps = {
  /** Monospace label set into the rule, editorial-style. */
  label?: string;
  tone?: 'light' | 'dark';
  className?: string;
};

/**
 * Horizontal hairline. With a label it becomes a section marker —
 * label left, rule filling the remaining width.
 */
export function Rule({ label, tone = 'light', className }: RuleProps) {
  const line = tone === 'dark' ? 'bg-rule-dark' : 'bg-rule';
  const text = tone === 'dark' ? 'text-term-dim' : 'text-ink-subtle';

  if (!label) {
    return <div aria-hidden className={cn('h-px w-full', line, className)} />;
  }

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <span className={cn('font-mono text-[11px] uppercase tracking-[0.18em]', text)}>
        {label}
      </span>
      <span aria-hidden className={cn('h-px flex-1', line)} />
    </div>
  );
}

/** Dotted leader, for label → value pairs in spec tables. */
export function Leader({ tone = 'light', className }: { tone?: 'light' | 'dark'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('mx-2 flex-1 self-end', className)}
      style={{
        borderBottom: `1px dotted ${tone === 'dark' ? 'var(--color-rule-dark)' : 'var(--color-rule-strong)'}`,
        marginBottom: '0.28em',
      }}
    />
  );
}
