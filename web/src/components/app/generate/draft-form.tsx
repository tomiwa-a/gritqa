'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Modal } from '../modal';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { draftPlanAction } from '@/lib/actions/generate';

/**
 * The brief, and the waiting, as one component.
 *
 * It owns the whole `Modal` rather than just the fields because the submit button
 * lives in the footer and the progress panel lives in the body, and both have to
 * know whether the draft is in flight. Two components either side of a server
 * boundary could not share that, and `useFormStatus` cannot see a button that sits
 * outside the `<form>` -- which this one does, connected by `form="draft-plan"`,
 * because the alternative was moving the action row out of the footer bar and
 * making this one step of the wizard look unlike the other two.
 *
 * Step three of the wizard used to be a URL step reached by a `<Link>`, which is
 * how it managed to animate a progress bar over no work at all. It is a state now:
 * you are on step three exactly as long as the agent is reading your code.
 *
 * `defaultBrief` is what the other two doors hand over. It arrives already written,
 * from a set of ticked endpoints or a range of commits, and it lands in the box
 * rather than going straight to the agent -- the selection knows which code, and
 * only you know what the journey is supposed to prove. So this is one drafting
 * surface for all three doors instead of three, and the two that pick a scope stop
 * being dead ends.
 */
export function DraftForm({
  closeHref,
  backHref,
  gapsHref,
  gapCount,
  defaultBrief,
  defaultBaseUrl,
  canPickGaps,
}: {
  closeHref: string;
  backHref: string;
  gapsHref: string;
  gapCount: number;
  /** Composed from a selection when you arrived through one of the other doors. */
  defaultBrief: string;
  /** The last address a plan in this project was written against. */
  defaultBaseUrl: string | null;
  canPickGaps: boolean;
}) {
  const [state, submit, pending] = useActionState(draftPlanAction, null);
  const [brief, setBrief] = useState(defaultBrief);
  const ready = brief.trim().length > 0 && !pending;

  /* Arrived with a brief already in it, which changes what this screen is for: not
     a blank box to fill but a draft of the scope to check and add intent to. */
  const composed = defaultBrief.length > 0;

  return (
    <Modal
      id="generate-modal"
      closeHref={closeHref}
      label="draft plans"
      eyebrow={`Draft plans · Step ${pending ? 3 : 2} of 3`}
      title={pending ? 'Writing the draft' : composed ? 'Check the brief' : 'Describe the journey'}
      progress={{ current: pending ? 3 : 2, total: 3 }}
      footer={
        pending ? (
          <p className="text-[11.5px] leading-snug text-ink-subtle">
            Reading your routes before writing anything. This takes about a minute.
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <Link href={backHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              <Icon name="arrowRight" size={14} className="rotate-180" />
              Back
            </Link>
            <Button
              type="submit"
              form="draft-plan"
              variant="primary"
              size="sm"
              disabled={!ready}
              className="ml-auto"
            >
              <Icon name="sparkle" size={14} />
              Draft it
            </Button>
          </div>
        )
      }
    >
      {pending ? (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-rule bg-app text-ink-muted">
            <Icon name="sparkle" size={18} />
          </span>

          <h3 className="mt-3.5 text-[15px] leading-tight font-semibold text-ink">
            Turning that into requests
          </h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">
            Finding the routes it touches, what they expect, and what has to happen first.
          </p>

          <span
            aria-hidden="true"
            className="mt-5 h-[3px] w-[min(14rem,80%)] overflow-hidden rounded-full bg-rule"
          >
            <span className="animate-handoff block h-full w-full rounded-full bg-ink" />
          </span>

          <p className="mt-5 text-[12px] leading-relaxed text-ink-subtle">
            You get steps to read, not a finished test. It waits for your approval.
          </p>
        </div>
      ) : (
        <form id="draft-plan" action={submit} className="flex flex-col gap-3.5 p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-ink">What should it prove?</span>
            <textarea
              name="brief"
              rows={composed ? 8 : 4}
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="Book a room as a guest, then check the booking shows up on the admin list with the right dates."
              className="w-full resize-y rounded-md border border-rule-strong bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed text-ink transition-colors duration-150 placeholder:text-ink-subtle hover:border-ink-subtle"
            />
            <span className="text-[11.5px] leading-snug text-ink-subtle">
              {composed
                ? 'Written from what you picked. Add what the journey should prove — the half a list of endpoints cannot say.'
                : 'Plain words. This is the whole brief the draft is written from — GritQA reads your code to work out the rest.'}
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-ink">
              Call it something? <span className="text-ink-subtle">Optional</span>
            </span>
            <Input dense name="name" placeholder="GritQA names it after what it proves" />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-ink">Where should it run?</span>
            <Input
              dense
              name="baseUrl"
              defaultValue={defaultBaseUrl ?? undefined}
              placeholder="http://localhost:8080"
              className="font-mono"
            />
            <span className="text-[11.5px] leading-snug text-ink-subtle">
              The address your machine will call. Recorded on the plan; nothing is called now.
            </span>
          </label>

          {state && 'error' in state && (
            <p className="text-[12px] leading-snug text-punch-red">{state.error}</p>
          )}

          {canPickGaps && !composed && (
            <p className="text-[12px] text-ink-subtle">
              Or{' '}
              <Link
                href={gapsHref}
                className="font-medium text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
              >
                pick from the {gapCount} gaps
              </Link>{' '}
              instead — usually faster than describing one.
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}
