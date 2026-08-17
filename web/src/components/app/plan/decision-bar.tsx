import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Kbd } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

export function DecisionBar({
  planId,
  cliConnected,
  refineHref,
  fullHref,
  showKeys = false,
  className,
}: {
  planId: string;
  cliConnected: boolean;
  refineHref: string;
  fullHref?: string;
  showKeys?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-20 flex flex-wrap items-center gap-2 border-t border-rule bg-app-panel/95 px-4 py-3 backdrop-blur-sm',
        className,
      )}
    >
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

      <Link href={refineHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
        <Icon name="sparkle" size={14} />
        Ask for changes
      </Link>

      <Button variant="ghost" size="sm" data-decision="reject" data-plan={planId}>
        <Icon name="archive" size={14} />
        Send back
        {showKeys && <Kbd className="ml-0.5">E</Kbd>}
      </Button>

      {fullHref && (
        <Link
          href={fullHref}
          className="group ml-auto flex items-center gap-1.5 text-[12.5px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          Open full plan
          {showKeys && <Kbd>↵</Kbd>}
          <Icon
            name="arrowRight"
            size={13}
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </Link>
      )}

      {!cliConnected && (
        <p className="w-full text-[11.5px] text-ink-subtle">
          Approving works either way. Running needs the CLI, because that is where your code is.
        </p>
      )}
    </div>
  );
}
