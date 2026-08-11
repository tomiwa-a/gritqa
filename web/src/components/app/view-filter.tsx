import Link from 'next/link';
import { cn } from '@/lib/cn';

export type ViewKey = 'all' | 'review' | 'failing';

const VIEWS: { key: ViewKey; label: string; dot?: string }[] = [
  { key: 'all', label: 'All work' },
  { key: 'review', label: 'Needs review' },
  { key: 'failing', label: 'Failing', dot: 'bg-fail' },
];

export function ViewFilter({
  active,
  counts,
}: {
  active: ViewKey;
  counts: Record<ViewKey, number>;
}) {
  return (
    <div
      role="group"
      aria-label="Filter the work list"
      className="flex h-8 items-center gap-0.5 rounded-md border border-rule bg-app-panel p-0.5"
    >
      {VIEWS.map((v) => {
        const on = v.key === active;
        return (
          <Link
            key={v.key}
            href={v.key === 'all' ? '/dashboard#work' : `/dashboard?view=${v.key}#work`}
            aria-current={on ? 'true' : undefined}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[12.5px] whitespace-nowrap',
              'transition-colors duration-150',
              on ? 'bg-app-active font-medium text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {v.dot && <span className={cn('h-1.5 w-1.5 rounded-full', v.dot)} />}
            {v.label}
            <span className="nums text-[11px] text-ink-subtle">{counts[v.key]}</span>
          </Link>
        );
      })}
    </div>
  );
}
