import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Kbd } from '@/components/ui/badge';
import {
  approveAndRunPlanAction,
  approvePlanAction,
  sendBackPlanAction,
} from '@/lib/actions/plans';
import { cn } from '@/lib/cn';

/**
 * The three outcomes of reading a draft: take it, answer it, or send it back.
 * Sits beside the plan's title rather than at the foot of the page, so the
 * decision is in reach the moment you land instead of a scroll away.
 *
 * One form, three `formAction`s. The plan's id is written once in a hidden field
 * rather than into each button, and the buttons keep their `data-decision` hooks
 * because the queue's keyboard shortcuts reach them by clicking -- a click on a
 * submit button submits the form it is in, so `A` and `E` now decide rather than
 * firing at nothing.
 *
 * `Ask for a change` stays a link inside the same form. It is the one outcome that
 * navigates instead of writing, and it belongs beside the other two whatever it is
 * made of.
 *
 * `confirmHref` turns both approve buttons into links to a box that holds the same two
 * actions. Given only for a plan that writes, because a confirm in front of every
 * approval is a confirm nobody reads by the third one -- and the caller is the half that
 * can see the steps to decide.
 */
export function DecisionBar({
  planId,
  cliConnected,
  refineHref,
  confirmHref,
  showKeys = false,
  className,
}: {
  planId: string;
  cliConnected: boolean;
  /** Opens the conversation panel over this page — asking is not a trip elsewhere. */
  refineHref: string;
  /** Set when this plan writes: both approve buttons go here instead of submitting. */
  confirmHref?: string;
  showKeys?: boolean;
  className?: string;
}) {
  const approveLabel = (
    <>
      <Icon name="check" size={14} />
      Approve
      {showKeys && <Kbd className="ml-0.5 border-white/25 bg-white/10 text-ink-inverse">A</Kbd>}
    </>
  );

  const runLabel = (
    <>
      <Icon name="runs" size={14} />
      Approve and run
    </>
  );

  const runTitle = cliConnected
    ? 'Approve, then ask your machine to run it'
    : 'Runs happen on your machine, and it is not connected right now';

  return (
    <div className={cn('flex flex-col gap-2 lg:items-end', className)}>
      <form className="flex flex-wrap items-center gap-2 lg:justify-end">
        <input type="hidden" name="publicId" value={planId} />

        {/* A link keeps the queue's shortcut working without knowing about any of
            this: `a` clicks this element, and clicking a link opens the confirm the
            same way a click on a submit used to write. */}
        {confirmHref ? (
          <Link
            href={confirmHref}
            scroll={false}
            title="This plan writes — read what it will run first"
            data-decision="approve"
            data-plan={planId}
            className={buttonVariants({ variant: 'primary', size: 'sm' })}
          >
            {approveLabel}
          </Link>
        ) : (
          <Button
            type="submit"
            formAction={approvePlanAction}
            variant="primary"
            size="sm"
            data-decision="approve"
            data-plan={planId}
          >
            {approveLabel}
          </Button>
        )}

        {/* Two writes behind one button, and the order matters: approve, then queue.
            Its own action rather than the form's default, because a submit that fell
            through to `approvePlanAction` would approve and queue nothing while
            looking like it had done both.
            Disconnected, it stays a disabled button: there is nothing to confirm on the
            way to something that cannot happen, and a link cannot be disabled. */}
        {confirmHref && cliConnected ? (
          <Link
            href={confirmHref}
            scroll={false}
            title={runTitle}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            {runLabel}
          </Link>
        ) : (
          <Button
            type="submit"
            formAction={approveAndRunPlanAction}
            variant="secondary"
            size="sm"
            disabled={!cliConnected}
            title={runTitle}
          >
            {runLabel}
          </Button>
        )}

        {/* The third outcome, and it acts here like the other two. */}
        <Link
          href={refineHref}
          scroll={false}
          title="Say what should change, and read the new version"
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          <Icon name="sparkle" size={14} />
          Ask for a change
        </Link>

        <Button
          type="submit"
          formAction={sendBackPlanAction}
          variant="ghost"
          size="sm"
          data-decision="reject"
          data-plan={planId}
        >
          <Icon name="archive" size={14} />
          Send back
          {showKeys && <Kbd className="ml-0.5">E</Kbd>}
        </Button>
      </form>

      {!cliConnected && (
        <p className="text-[11.5px] leading-snug text-ink-subtle lg:max-w-[20rem] lg:text-right">
          Approving works either way. Running needs the CLI, because that is where your code is.
        </p>
      )}
    </div>
  );
}
