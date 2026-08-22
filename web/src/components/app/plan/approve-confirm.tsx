import Link from 'next/link';
import { Modal } from '../modal';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Fence } from '@/components/ui/prose';
import { StepBadge } from '@/components/ui/step-badge';
import { approveAndRunPlanAction, approvePlanAction } from '@/lib/actions/plans';
import { getPlanDetail, isCliConnected } from '@/lib/data';
import { stepKindOf } from '@/lib/plan';
import { stepIsHeavy, type PlanStepSpec } from '@/lib/model';

/**
 * The one dialog in the review flow, and it is here because a plan can now write.
 *
 * Approving used to be safe by construction: every step was a request to the code
 * under test, so the worst an unread plan could do was call it. A fixture that inserts
 * and a command that runs the project's tooling are a different promise, and the person
 * making it should have read the statement.
 *
 * Only the heavy steps, verbatim. A confirm that summarised the whole plan would be one
 * people learn to dismiss, which would cost more than it bought -- and the plan itself
 * is one click behind this box for anyone who wants all of it.
 */
export async function ApproveConfirm({ id, closeHref }: { id: string; closeHref: string }) {
  const [detail, cliConnected] = await Promise.all([getPlanDetail(id), isCliConnected()]);
  if (!detail) return null;

  const heavy = detail.steps.filter(stepIsHeavy);

  return (
    <Modal
      id="approve-confirm"
      closeHref={closeHref}
      label={`Approve ${detail.name}`}
      eyebrow="before you approve"
      title={heavy.length > 0 ? 'This plan does more than ask' : 'Nothing in this plan writes'}
      footer={
        <form className="flex flex-wrap items-center justify-end gap-2">
          <input type="hidden" name="publicId" value={detail.publicId} />

          <Link
            href={closeHref}
            scroll={false}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            Cancel
          </Link>

          {/* Both writes are here rather than only the plain one, so reading this box
              does not cost you the button you were reaching for. */}
          <Button
            type="submit"
            formAction={approveAndRunPlanAction}
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

          <Button type="submit" formAction={approvePlanAction} variant="primary" size="sm">
            <Icon name="check" size={14} />
            Approve
          </Button>
        </form>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        {heavy.length > 0 ? (
          <>
            <p className="text-[12.5px] leading-relaxed text-ink-muted">
              {heavy.length === 1
                ? 'One step'
                : `${heavy.length} of the ${detail.steps.length} steps`}{' '}
              {heavy.length === 1 ? 'does' : 'do'} more than send a request. Read{' '}
              {heavy.length === 1 ? 'it' : 'them'} before you approve.
            </p>

            <ul className="flex flex-col gap-3">
              {heavy.map((step) => (
                <li key={step.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StepBadge kind={stepKindOf(step)} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                      {step.name}
                    </span>
                  </div>
                  <Fence code={payloadOf(step)} tag={stepKindOf(step) === 'sql' ? 'sql' : 'bash'} />
                </li>
              ))}
            </ul>

            {/* The containment story, said plainly and without overclaiming it. The
                database really is GritQA's own copy; the project directory really is
                the developer's own files, and a command that writes to one writes to
                theirs. Saying "nothing of yours is touched" here would be the kind of
                reassurance that is discovered to be false exactly once. */}
            <p className="text-[11.5px] leading-relaxed text-ink-subtle">
              These run inside GritQA&apos;s own container: the database is the copy it built and
              migrated for itself, never yours. Your project is mounted there as your files, so a
              command that writes to one writes to them.
            </p>
          </>
        ) : (
          /* Reachable, and worth a sentence rather than an empty box: the plan was
             revised while this page was open, and what it now asks for is a click the
             button behind this box would have given you. */
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            Every step here sends a request or reads. This version of the plan changes nothing on
            its own, so there is nothing extra to read before approving it.
          </p>
        )}
      </div>
    </Modal>
  );
}

/** What the step will actually run, which is the only thing this box is for. */
function payloadOf(step: PlanStepSpec): string {
  return (stepKindOf(step) === 'sql' ? step.action?.statement : step.action?.command) ?? '';
}
