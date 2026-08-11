import { Icon, type IconName } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

const SOLID = {
  info: 'bg-info text-white',
  pass: 'bg-pass text-white',
  warn: 'bg-warn text-white',
  fail: 'bg-fail text-white',
  ink: 'bg-ink text-ink-inverse',
} as const;

const SOFT = {
  info: 'bg-info-soft text-info',
  pass: 'bg-pass-soft text-pass',
  warn: 'bg-warn-soft text-warn',
  fail: 'bg-fail-soft text-fail',
  ink: 'bg-app-active text-ink-muted',
} as const;

const SIZE = {
  sm: { box: 'h-6 w-6 rounded-[6px]', glyph: 14 },
  md: { box: 'h-8 w-8 rounded-lg', glyph: 16 },
  lg: { box: 'h-10 w-10 rounded-[10px]', glyph: 18 },
} as const;

export function IconTile({
  name,
  tone = 'ink',
  variant = 'solid',
  size = 'md',
  className,
}: {
  name: IconName;
  tone?: keyof typeof SOLID;
  variant?: 'solid' | 'soft';
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const s = SIZE[size];

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center',
        s.box,
        variant === 'solid' ? SOLID[tone] : SOFT[tone],
        className,
      )}
    >
      <Icon name={name} size={s.glyph} strokeWidth={1.65} />
    </span>
  );
}
