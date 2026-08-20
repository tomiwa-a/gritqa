import { cn } from '@/lib/cn';
import type { Machine } from '@/lib/model';

/**
 * Three states, because "connected or not" loses the one a developer can act on.
 *
 * A machine that has never polled needs the install command. A machine that polled
 * four minutes ago and stopped needs looking at -- the CLI was quit, or the laptop
 * slept -- and that is a different problem with a different fix. Collapsing the two
 * into "not connected" would tell someone to install what they already have.
 *
 * `machine` is the newest one to have polled for this project, connected or not.
 */
export function CliStatus({ machine, className }: { machine: Machine | null; className?: string }) {
  const tone = machine === null ? 'never' : machine.connected ? 'live' : 'stale';

  const dot = { live: 'bg-pass', stale: 'bg-warn', never: 'bg-skip' }[tone];

  /* The hostname when the CLI sent one, because "connected from studio-mbp" is a
     better sentence than "connected" -- and for a developer with a laptop and a
     desktop it is the only version that answers the question. */
  const where = machine?.hostname ? ` from ${machine.hostname}` : '';
  const text = {
    live: `CLI connected${where}`,
    stale: `CLI last seen ${machine?.lastSeenLabel}`,
    never: 'CLI not connected',
  }[tone];

  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-2 rounded-full border border-rule bg-app-panel px-2.5',
        'text-[12px] whitespace-nowrap text-ink-muted',
        className,
      )}
      title={
        machine
          ? `${machine.hostname ?? machine.instanceId} · last polled ${machine.lastSeenLabel}`
          : 'No machine has polled for this project yet'
      }
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
