import { Icon } from '@/components/ui/icon';
import { MethodBadge, type Method } from '@/components/ui/method-badge';
import { cn } from '@/lib/cn';
import type { StepKind } from '@/lib/model';

/**
 * What a step is, in the width a method takes.
 *
 * `MethodBadge` is two exhaustive `Record<Method, string>` maps, so a widened union
 * would reach them as an undefined class and render an unstyled chip at whatever width
 * its text wanted -- which is the one thing the spine cannot survive, since every row
 * in it is aligned off this badge. So the http case delegates and the other two are
 * drawn here at the same `w-[3.75rem]`.
 *
 * An icon rather than three more letters: `SQL` and `SH` are shorter than any method
 * and would read as an abbreviation of one. The mark says at a glance that this row is
 * not a request, which is the distinction the whole feature turns on.
 */
const CHIP: Record<
  'sql' | 'shell',
  { label: string; icon: 'database' | 'terminal'; light: string; dark: string }
> = {
  sql: {
    label: 'SQL',
    icon: 'database',
    light: 'text-[#6d28d9] bg-[#f1ecfe]',
    dark: 'text-[#c4b2fd]',
  },
  shell: {
    label: 'SH',
    icon: 'terminal',
    light: 'text-ink-muted bg-app-hover',
    dark: 'text-ink-dim',
  },
};

export function StepBadge({
  kind,
  method,
  tone = 'light',
  className,
}: {
  kind: StepKind;
  /** The step's method, for an `http` step. Ignored for the other two. */
  method?: Method | null;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  if (kind === 'http') {
    return <MethodBadge method={method ?? 'GET'} tone={tone} className={className} />;
  }

  const chip = CHIP[kind];
  return (
    <span
      className={cn(
        'inline-flex h-5 w-[3.75rem] shrink-0 items-center justify-center gap-1 rounded',
        'font-mono text-[10px] font-semibold tracking-[0.08em]',
        tone === 'dark' ? cn('bg-surface-dark-raised', chip.dark) : chip.light,
        className,
      )}
    >
      <Icon name={chip.icon} size={10} />
      {chip.label}
    </span>
  );
}
