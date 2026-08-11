import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badge = cva(
  'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        outline: 'border border-rule-strong bg-surface text-ink-muted',
        solid: 'bg-ink text-ink-inverse',
        pass: 'bg-pass-soft text-pass',
        fail: 'bg-fail-soft text-fail',
        warn: 'bg-warn-soft text-warn',
        skip: 'bg-skip-soft text-skip',
        onDark: 'border border-rule-dark bg-surface-dark-raised text-ink-dim',

        draft: 'bg-skip-soft text-ink-muted',
        review: 'bg-warn-soft text-warn',
        approved: 'bg-pass-soft text-pass',
        running: 'bg-info-soft text-info',
        archived: 'border border-rule bg-surface-sunken text-ink-subtle',
        error: 'bg-fail-soft text-fail',

        count: 'bg-app-active text-ink-muted',
        notice: 'bg-info text-white',
      },
      size: {
        xs: 'h-[18px] min-w-[18px] justify-center px-1.5 text-[10.5px]',
        sm: 'h-5 px-2 text-[11px]',
        md: 'h-7 px-3 text-xs',
      },
      mono: { true: 'font-mono uppercase tracking-[0.12em]', false: '' },
    },
    defaultVariants: { variant: 'outline', size: 'md', mono: false },
  },
);

export type BadgeProps = VariantProps<typeof badge> & {
  children: React.ReactNode;
  className?: string;
};

export function Badge({ variant, size, mono, children, className }: BadgeProps) {
  return <span className={cn(badge({ variant, size, mono }), className)}>{children}</span>;
}

const TONE = {
  pass: { fill: 'bg-pass', label: 'Passed' },
  fail: { fill: 'bg-fail', label: 'Failed' },
  warn: { fill: 'bg-warn', label: 'Warning' },
  skip: { fill: 'bg-skip', label: 'Skipped' },
  live: { fill: 'bg-pass', label: 'Live' },
  draft: { fill: 'bg-skip', label: 'Draft' },
  review: { fill: 'bg-warn', label: 'Waiting for review' },
  approved: { fill: 'bg-pass', label: 'Approved' },
  running: { fill: 'bg-info', label: 'Running' },
} as const;

export function StatusDot({
  tone,
  pulse = false,
  label,
  className,
}: {
  tone: keyof typeof TONE;
  pulse?: boolean;
  label?: string;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <span className={cn('relative flex h-2 w-2 shrink-0', className)}>
      {pulse && (
        <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', t.fill)} />
      )}
      <span className={cn('relative h-2 w-2 rounded-full', t.fill)} />
      <span className="sr-only">{label ?? t.label}</span>
    </span>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-rule-strong',
        'bg-surface px-1.5 font-mono text-[11px] text-ink-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
