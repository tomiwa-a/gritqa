import { cn } from '@/lib/cn';

export function AppFrame({
  url,
  children,
  tone = 'dark',
  meta,
  className,
}: {
  url: string;
  children: React.ReactNode;
  tone?: 'light' | 'dark';
  meta?: string;
  className?: string;
}) {
  const dark = tone === 'dark';

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border',
        dark
          ? 'border-rule-dark bg-surface-dark-raised'
          : 'border-rule bg-surface shadow-[0_1px_2px_rgba(27,29,46,0.05),0_16px_40px_-28px_rgba(27,29,46,0.22)]',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2.5 border-b px-4 py-2.5',
          dark ? 'border-rule-dark' : 'border-rule bg-surface-sunken',
        )}
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-info" />
        <span
          className={cn(
            'truncate font-mono text-[11px]',
            dark ? 'text-ink-dim' : 'text-ink-muted',
          )}
        >
          {url}
        </span>
        {meta && (
          <span
            className={cn(
              'nums ml-auto shrink-0 font-mono text-[11px]',
              dark ? 'text-ink-dim' : 'text-ink-subtle',
            )}
          >
            {meta}
          </span>
        )}
      </div>

      {children}
    </div>
  );
}
