'use client';

import { useActionState, useState } from 'react';
import { AskComposer } from './ask-composer';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import {
  draftFromConversationAction,
  proposeBriefAction,
  type BriefState,
} from '@/lib/actions/ask';

/**
 * The box, and the one thing you can do with what is above it.
 *
 * Plan is an action, not a mode -- there is no toggle to set before you speak, and
 * the button is labelled with what it produces, which sets expectations about cost
 * better than a switch would. It appears once there is an answer to draft from,
 * because before that there is nothing to turn into a plan.
 *
 * Two stages on purpose. The brief is proposed and then *shown*, editable, because a
 * conversation may have covered four things and only one of them is the test -- and
 * the person who was there knows which. A synthesis nobody could correct would be the
 * wizard's one-shot with extra steps.
 */
export function AskFooter(props: {
  conversation: string;
  /** No turns yet: the composer gets the room and there is nothing to draft from. */
  opening: boolean;
  /** At least one answer, so a plan can be drafted from the conversation. */
  canDraft: boolean;
  /** Where the last plan in this project was pointed, as the default. */
  defaultBaseUrl: string | null;
}) {
  /* Backing out of the draft remounts the footer, which is how the proposal is
     cleared: `useActionState` has no reset, and a `dismissed` flag would have to be
     un-set again on the next submit. */
  const [round, setRound] = useState(0);
  return <Footer key={round} {...props} onCancel={() => setRound((r) => r + 1)} />;
}

function Footer({
  conversation,
  opening,
  canDraft,
  defaultBaseUrl,
  onCancel,
}: {
  conversation: string;
  opening: boolean;
  canDraft: boolean;
  defaultBaseUrl: string | null;
  onCancel: () => void;
}) {
  const [proposal, propose, proposing] = useActionState(proposeBriefAction, null);

  if (proposal && 'ok' in proposal) {
    return (
      <DraftForm
        conversation={conversation}
        proposal={proposal}
        defaultBaseUrl={defaultBaseUrl}
        onCancel={onCancel}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <AskComposer conversation={conversation} opening={opening} />

      {canDraft && (
        <form action={propose} className="flex flex-col gap-1.5 border-t border-rule-soft pt-2">
          <input type="hidden" name="conversation" value={conversation} />
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={proposing}
            className="w-full"
          >
            <Icon
              name={proposing ? 'refresh' : 'plan'}
              size={14}
              className={cn(proposing && 'animate-spin')}
            />
            {proposing ? 'Reading the conversation…' : 'Draft a plan from this'}
          </Button>

          {proposal && 'error' in proposal ? (
            <p className="text-[11.5px] leading-snug text-punch-red">{proposal.error}</p>
          ) : (
            <p className="text-[11px] leading-snug text-ink-subtle">
              Turns this into steps you approve. You read the brief first.
            </p>
          )}
        </form>
      )}
    </div>
  );
}

/**
 * The brief the plan gets written from, prefilled and yours to change.
 *
 * The draft still researches. What the conversation buys is that pass one starts from
 * what was already established and confirms it, rather than finding the same routes
 * again -- and confirming a known route is most of the speed with none of the risk of
 * drafting against a ten-minute-old picture of the code.
 */
function DraftForm({
  conversation,
  proposal,
  defaultBaseUrl,
  onCancel,
}: {
  conversation: string;
  proposal: Extract<BriefState, { ok: true }>;
  defaultBaseUrl: string | null;
  onCancel: () => void;
}) {
  const [state, submit, pending] = useActionState(draftFromConversationAction, null);
  const [brief, setBrief] = useState(proposal.brief);

  return (
    <form action={submit} className="flex flex-col gap-2.5">
      <input type="hidden" name="conversation" value={conversation} />

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-ink">What the plan should prove</span>
        {!pending && (
          <button
            type="button"
            onClick={onCancel}
            className="text-[11.5px] text-ink-subtle transition-colors duration-150 hover:text-ink"
          >
            Back
          </button>
        )}
      </div>

      <textarea
        name="brief"
        rows={4}
        value={brief}
        onChange={(event) => setBrief(event.target.value)}
        disabled={pending}
        className="w-full resize-none rounded-lg border border-rule bg-app px-2.5 py-2 text-[12.5px] leading-relaxed text-ink focus:border-rule-strong focus:bg-app-panel disabled:opacity-60"
      />

      <Input
        dense
        name="name"
        defaultValue={proposal.name}
        disabled={pending}
        placeholder="Name it after what it proves"
      />

      <Input
        dense
        name="baseUrl"
        defaultValue={defaultBaseUrl ?? undefined}
        disabled={pending}
        placeholder="http://localhost:8080"
        className="font-mono"
      />

      <Button
        type="submit"
        variant="accent"
        size="sm"
        disabled={pending || !brief.trim()}
        className="w-full"
      >
        <Icon
          name={pending ? 'refresh' : 'plan'}
          size={14}
          className={cn(pending && 'animate-spin')}
        />
        {pending ? 'Writing the plan…' : 'Draft it'}
      </Button>

      {pending ? (
        <p className="text-[11px] leading-snug text-ink-subtle">
          Confirming what this conversation found, then writing the steps. This can take a minute.
        </p>
      ) : state && 'error' in state ? (
        <p className="text-[11.5px] leading-snug text-punch-red">{state.error}</p>
      ) : (
        <p className="text-[11px] leading-snug text-ink-subtle">
          Lands as a draft on its own page. Nothing runs until you approve it.
        </p>
      )}
    </form>
  );
}
