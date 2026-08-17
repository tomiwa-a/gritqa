import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Kbd } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

/**
 * The three outcomes of reading a draft: take it, answer it, or send it back.
 * Sits beside the plan's title rather than at the foot of the page, so the
 * decision is in reach the moment you land instead of a scroll away.
 */
export function DecisionBar({
  planId,
  cliConnected,
  refineHref,
  showKeys = false,
  className,
}: {
  planId: string;
  cliConnected: boolean;
  /** Points at the conversation on this page — asking is not a trip elsewhere. */
  refineHref: string;
  showKeys?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2 lg:items-end', className)}>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <Button variant="primary" size="sm" data-decision="approve" data-plan={planId}>
          <Icon name="check" size={14} />
          Approve
          {showKeys && <Kbd className="ml-0.5 border-white/25 bg-white/10 text-ink-inverse">A</Kbd>}
        </Button>

        <Button
          variant="secondary"
          size="sm"
          disabled={!cliConnected}
          title={
            cliConnected
              ? 'Approve, then ask your machine to run it'
              : 'Runs happen on your machine, and it is not connected right now'
          }
        >
          <Icon name="runs" size={14} />
          Approve and run
        </Button>

        {/* The third outcome, and it acts here like the other two. */}
        <Link
          href={refineHref}
          title="Say what should change, and read the new version"
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          <Icon name="sparkle" size={14} />
          Ask for a change
        </Link>

        <Button variant="ghost" size="sm" data-decision="reject" data-plan={planId}>
          <Icon name="archive" size={14} />
          Send back
          {showKeys && <Kbd className="ml-0.5">E</Kbd>}
        </Button>
      </div>

      {!cliConnected && (
        <p className="text-[11.5px] leading-snug text-ink-subtle lg:max-w-[20rem] lg:text-right">
          Approving works either way. Running needs the CLI, because that is where your code is.
        </p>
      )}
    </div>
  );
}
