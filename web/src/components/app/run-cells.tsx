import { CELL_FILL, CELL_WORD } from '@/lib/runs';
import { cn } from '@/lib/cn';

export function RunCells({
  cells,
  size = 'sm',
  className,
}: {
  cells: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const failed = [...cells].filter((c) => c === 'f').length;
  const skipped = [...cells].filter((c) => c === 's').length;

  return (
    <span className={cn('inline-flex items-center gap-[3px]', className)}>
      {[...cells].map((c, i) => (
        <span
          key={i}
          className={cn(
            'rounded-[2px]',
            size === 'sm' ? 'h-3 w-[5px]' : 'h-4 w-1.5',
            CELL_FILL[c],
          )}
        />
      ))}
      <span className="sr-only">
        {cells.length} steps — {cells.length - failed - skipped} {CELL_WORD.p}, {failed}{' '}
        {CELL_WORD.f}, {skipped} {CELL_WORD.s}
      </span>
    </span>
  );
}
