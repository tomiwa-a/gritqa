import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

export type DeltaTone = 'good' | 'bad' | 'neutral';
export type DeltaDirection = 'up' | 'down' | 'flat';

const TONE: Record<DeltaTone, string> = {
  good: 'bg-pass-soft text-pass',
  bad: 'bg-fail-soft text-fail',
  neutral: 'bg-app-active text-ink-subtle',
};

export function Delta({
  direction,
  value,
  tone,
  className,
}: {
  direction: DeltaDirection;
  value: string;
  tone: DeltaTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'nums inline-flex h-[19px] items-center gap-0.5 rounded px-1.5 text-[11px] font-medium',
        TONE[tone],
        className,
      )}
    >
      <Icon
        name={direction === 'up' ? 'arrowUp' : direction === 'down' ? 'arrowDown' : 'flat'}
        size={11}
        strokeWidth={2}
      />
      {value}
    </span>
  );
}
