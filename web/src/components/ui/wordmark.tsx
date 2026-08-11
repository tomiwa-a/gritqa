import Link from 'next/link';
import { cn } from '@/lib/cn';

export function Wordmark({
  tone = 'light',
  className,
}: {
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <Link
      href="/"
      aria-label="GritQA — home"
      className={cn('group inline-flex items-baseline gap-px', className)}
    >
      <span
        className={cn(
          'font-heading text-[1.0625rem] font-bold tracking-[-0.03em]',
          tone === 'dark' ? 'text-ink-inverse' : 'text-ink',
        )}
      >
        Grit
      </span>
      <span className="font-heading text-[1.0625rem] font-bold tracking-[-0.03em] text-punch-red">
        QA
      </span>
    </Link>
  );
}
