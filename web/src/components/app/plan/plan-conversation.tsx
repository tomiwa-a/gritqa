import { Panel } from '@/components/app/panel';
import { Badge } from '@/components/ui/badge';
import { RevisionThread, TurnRow } from './revision-thread';
import { RefineComposer } from './refine-composer';
import type { TestPlan, TestPlanDetail } from '@/lib/mock/types';
import { user } from '@/lib/mock/data';
import { cn } from '@/lib/cn';

/**
 * What a plan is, when nothing about the asking was recorded: the trigger and
 * the shape it landed in. No invented instruction — the words are not kept.
 */
function OpeningTurn({ plan, author }: { plan: TestPlan; author: string }) {
  const byHand = plan.triggerSource === 'manual';
  const shape = `${plan.stepCount} step${plan.stepCount === 1 ? '' : 's'}, ${plan.assertionCount} check${
    plan.assertionCount === 1 ? '' : 's'
  }.`;

  return (
    <ol className="flex flex-col">
      {byHand && (
        <TurnRow who={author} whenLabel={plan.createdLabel} mine>
          <p className="mt-1.5 text-[12px] text-ink-subtle">
            Started this plan by hand. What you asked for was not kept.
          </p>
        </TurnRow>
      )}

      <TurnRow
        who="GritQA"
        whenLabel={plan.createdLabel}
        mine={false}
        meta={
          <>
            <Badge
              variant="outline"
              size="sm"
              mono
              className="nums border-punch-red/40 bg-app-panel text-punch-red"
            >
              v{plan.version}
            </Badge>
            <span className="text-[11px] whitespace-nowrap text-punch-red">
              What you&rsquo;re reading
            </span>
          </>
        }
      >
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          {byHand ? 'Drafted it: ' : 'Drafted this from a push: '}
          {shape}
        </p>
        {plan.version > 1 && (
          <p className="nums mt-2 text-[11.5px] text-ink-subtle">
            {plan.version - 1} earlier version{plan.version - 1 === 1 ? '' : 's'} came before this
            one. Only where it landed is on record.
          </p>
        )}
      </TurnRow>
    </ol>
  );
}

/**
 * Reviewing a plan is answering it, so the exchange that produced it and the
 * box you reply in are the same place — the last thing you read before deciding.
 */
export function PlanConversation({
  plan,
  detail,
  diffHrefFor,
  className,
}: {
  plan: TestPlan;
  detail: TestPlanDetail | undefined;
  diffHrefFor: (version: number) => string;
  className?: string;
}) {
  const revisions = detail?.revisions ?? [];
  /* An archived plan is kept for the record, so there is nothing to ask for. */
  const canAsk = plan.status !== 'archived';
  const turns = revisions.length
    ? revisions.reduce((n, r) => n + (r.instruction ? 2 : 1), 0)
    : plan.triggerSource === 'manual'
      ? 2
      : 1;

  return (
    <Panel
      id="ask"
      className={cn('scroll-mt-20', className)}
      title="How this plan got here"
      subtitle="What was asked for, what came back, and what to change next"
      meta={
        <span className="nums shrink-0 font-mono text-[11.5px] text-ink-subtle">
          {turns} turn{turns === 1 ? '' : 's'}
        </span>
      }
      bodyClassName="p-0"
    >
      {revisions.length > 0 ? (
        <RevisionThread
          revisions={revisions}
          author={user.name}
          trigger={plan.triggerSource}
          diffHrefFor={diffHrefFor}
          currentVersion={plan.version}
        />
      ) : (
        <OpeningTurn plan={plan} author={user.name} />
      )}

      {canAsk ? (
        <div className="border-t border-rule">
          <RefineComposer nextVersion={plan.version + 1} />
        </div>
      ) : (
        <p className="border-t border-rule px-4 py-3.5 text-[12.5px] leading-relaxed text-ink-subtle">
          This plan is archived. It is kept for the record and never redrafted — copy it into a new
          plan if you want to take it further.
        </p>
      )}
    </Panel>
  );
}
