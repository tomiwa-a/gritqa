import { cn } from '@/lib/cn';

const SIZE = {
  sm: 'h-6 w-6 rounded text-[10px]',
  md: 'h-7 w-7 rounded-md text-[11px]',
  lg: 'h-11 w-11 rounded-lg text-[14px]',
};

export function initialsOf(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center bg-ink font-medium text-ink-inverse',
        SIZE[size],
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
