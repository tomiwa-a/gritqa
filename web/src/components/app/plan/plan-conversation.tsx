import { Drawer } from '../drawer';
import { Badge } from '@/components/ui/badge';
import { RevisionThread, TurnRow } from './revision-thread';
import { RefineComposer } from './refine-composer';
import { allPlans, user } from '@/lib/mock/data';
import { planDetailFor } from '@/lib/mock/plans';
import type { TestPlan } from '@/lib/mock/types';

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
          <Badge
            variant="outline"
            size="sm"
            mono
            className="nums border-punch-red/40 bg-app-panel text-punch-red"
          >
            v{plan.version}
          </Badge>
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
 * Asking for a change is one of the three things you can do with a draft, so it
 * behaves like the other two: it happens where you are reading. The panel slides
 * over the plan instead of sending you off to find a text box.
 *
 * The exchange scrolls, and the box you answer in is pinned underneath it —
 * because your answer is the next turn, not a separate tool.
 */
export function PlanConversation({ id, closeHref }: { id: string; closeHref: string }) {
  const plan = allPlans.find((p) => p.publicId === id);
  if (!plan) return null;

  const detail = planDetailFor(plan.publicId);
  const revisions = detail?.revisions ?? [];
  /* An archived plan is kept for the record, so there is nothing to ask for. */
  const canAsk = plan.status !== 'archived';
  const turns = revisions.length
    ? revisions.reduce((n, r) => n + (r.instruction ? 2 : 1), 0)
    : plan.triggerSource === 'manual'
      ? 2
      : 1;

  /* Comparing two versions side by side needs the width, so that stays a page. */
  const diffHrefFor = (version: number) => {
    const diff = `/dashboard/test-plans/${plan.publicId}?tab=diff`;
    return version > 1 ? `${diff}&v=${version}` : diff;
  };

  return (
    <Drawer
      id="plan-conversation"
      closeHref={closeHref}
      label="plan conversation"
      eyebrow={`Conversation · ${turns} turn${turns === 1 ? '' : 's'}`}
      title={plan.name}
      footer={
        canAsk ? (
          <RefineComposer nextVersion={plan.version + 1} />
        ) : (
          <p className="text-[12px] leading-relaxed text-ink-subtle">
            This plan is archived. It is kept for the record and never redrafted — copy it into a
            new plan if you want to take it further.
          </p>
        )
      }
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
    </Drawer>
  );
}
