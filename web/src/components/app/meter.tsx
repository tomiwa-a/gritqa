import { cn } from '@/lib/cn';

export function Meter({
  total,
  passed,
  tone = 'fail',
  className,
}: {
  total: number;
  passed: number;
  tone?: 'fail' | 'skip';
  className?: string;
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-[3px]', className)}
      title={`${passed} of ${total} steps passed`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-3.5 w-[3px] rounded-full',
            i < passed ? 'bg-pass' : tone === 'fail' ? 'bg-fail' : 'bg-skip',
          )}
        />
      ))}
      <span className="nums ml-1.5 text-[12px] text-ink-muted">
        {passed}/{total}
      </span>
    </span>
  );
}
