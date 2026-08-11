import { cn } from '@/lib/cn';

export function CliStatus({
  lastSeenLabel,
  stale = false,
  className,
}: {
  lastSeenLabel: string | null;
  stale?: boolean;
  className?: string;
}) {
  const tone = lastSeenLabel === null ? 'never' : stale ? 'stale' : 'live';

  const dot = { live: 'bg-pass', stale: 'bg-warn', never: 'bg-skip' }[tone];
  const text = {
    live: `CLI connected · ${lastSeenLabel}`,
    stale: `CLI last seen ${lastSeenLabel}`,
    never: 'CLI not connected',
  }[tone];

  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-2 rounded-full border border-rule bg-app-panel px-2.5',
        'text-[12px] whitespace-nowrap text-ink-muted',
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {tone === 'live' && (
          <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', dot)} />
        )}
        <span className={cn('relative h-1.5 w-1.5 rounded-full', dot)} />
      </span>
      {text}
    </span>
  );
}
