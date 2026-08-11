import { cn } from '@/lib/cn';

type CrosshairProps = {
  at?: 'tl' | 'tr' | 'bl' | 'br';
  size?: 'sm' | 'md';
  tone?: 'light' | 'dark';
  className?: string;
};

const AT: Record<NonNullable<CrosshairProps['at']>, string> = {
  tl: 'absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2',
  tr: 'absolute top-0 right-0 translate-x-1/2 -translate-y-1/2',
  bl: 'absolute bottom-0 left-0 -translate-x-1/2 translate-y-1/2',
  br: 'absolute bottom-0 right-0 translate-x-1/2 translate-y-1/2',
};

export function Crosshair({ at, size = 'md', tone = 'light', className }: CrosshairProps) {
  const px = size === 'sm' ? 'h-2 w-2' : 'h-3 w-3';
  const stroke = tone === 'dark' ? 'bg-rule-dark' : 'bg-rule-strong';

  return (
    <span aria-hidden className={cn('pointer-events-none block', px, at && AT[at], className)}>
      <span className={cn('absolute top-1/2 left-0 w-full -translate-y-1/2', stroke)} style={{ height: 1 }} />
      <span className={cn('absolute left-1/2 top-0 h-full -translate-x-1/2', stroke)} style={{ width: 1 }} />
    </span>
  );
}
