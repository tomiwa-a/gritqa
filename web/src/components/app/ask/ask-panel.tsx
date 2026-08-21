import Link from 'next/link';
import { Drawer, DrawerBlock } from '../drawer';
import { AskFooter } from './ask-footer';
import { AskHistory } from './ask-history';
import { AskThread } from './ask-thread';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { getConversation, getConversations, getLastBaseUrl, getUser } from '@/lib/data';
import { NEW_CONVERSATION, askToken } from '@/lib/overlay';

/**
 * Asking about the codebase, which is the panel's resting state.
 *
 * It opens from the sidebar rather than from a plan, because this is a project-level
 * capability: the research tools have always been able to read the developer's code
 * and the only thing anyone could spend them on was producing a plan. QA is the
 * audience that cannot read code and whose whole job is asking questions about
 * behaviour, and until now they could not spend one.
 *
 * `ask:new` and `ask:<id>` are one token doing two jobs, following `rule:new`: with a
 * conversation named it shows that thread, and without one it shows the box and what
 * there is to go back to. Nothing here is lost by closing the panel -- the exchange is
 * a row before it is on screen.
 */

/** Plans that came out of this conversation, which is the reason the column exists. */
function PlansFrom({
  plans,
}: {
  plans: {
    publicId: string;
    name: string;
    status: 'draft' | 'approved' | 'archived';
    version: number;
  }[];
}) {
  return (
    <DrawerBlock label={plans.length === 1 ? 'Plan from this' : 'Plans from this'}>
      <ul className="flex flex-col gap-1.5">
        {plans.map((plan) => (
          <li key={plan.publicId}>
            <Link
              href={`/dashboard/test-plans/${plan.publicId}`}
              className="group flex items-center gap-2 rounded-md border border-rule bg-app px-2.5 py-2 transition-colors duration-150 hover:border-rule-strong"
            >
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{plan.name}</span>
              <Badge variant={plan.status} size="sm">
                {plan.status === 'draft'
                  ? 'Draft'
                  : plan.status === 'approved'
                    ? 'Approved'
                    : 'Archived'}
              </Badge>
              <Icon
                name="arrowUpRight"
                size={12}
                className="shrink-0 text-ink-subtle transition-colors duration-150 group-hover:text-ink"
              />
            </Link>
          </li>
        ))}
      </ul>
    </DrawerBlock>
  );
}

/** With nothing asked yet, what this is for -- in behaviour, like the answers. */
function Opening({ everAsked }: { everAsked: boolean }) {
  return (
    <div className="px-4 py-4">
      <p className="text-[13px] leading-relaxed text-ink-muted">
        Ask what a request has to send, what comes back, what has to be true first — GritQA reads
        the code in this project to answer, and tells you when it could not find something.
      </p>
      <p className="mt-2.5 text-[12px] leading-relaxed text-ink-subtle">
        {everAsked
          ? 'Your earlier conversations are below. Nothing here changes your code or runs anything.'
          : 'Nothing changes your code and nothing runs. When an answer is worth testing, there is a button for that.'}
      </p>
    </div>
  );
}

export async function AskPanel({
  id,
  closeHref,
  hrefFor,
}: {
  id: string;
  closeHref: string;
  /** Same page, different overlay: for the history rows and the new-conversation button. */
  hrefFor: (token: string) => string;
}) {
  /* A named conversation that is not in this project reads as absent, and absent falls
     back to the list -- a stale link lands you where you can pick a real one rather
     than on an error. */
  const detail = id === NEW_CONVERSATION ? null : await getConversation(id);

  const [user, defaultBaseUrl, conversations] = await Promise.all([
    getUser(),
    getLastBaseUrl(),
    detail ? Promise.resolve([]) : getConversations(),
  ]);

  const turns = detail?.turns ?? [];
  const canDraft = turns.some((turn) => turn.author === 'ai');

  return (
    <Drawer
      id="ask-panel"
      closeHref={closeHref}
      label="ask GritQA"
      eyebrow={
        detail
          ? `Conversation · ${turns.length} turn${turns.length === 1 ? '' : 's'}`
          : 'Ask GritQA'
      }
      title={detail ? detail.title : 'About this codebase'}
      nav={
        detail ? (
          <Link
            href={hrefFor(askToken(NEW_CONVERSATION))}
            scroll={false}
            title="New conversation"
            aria-label="New conversation"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors duration-150 hover:bg-app-hover hover:text-ink"
          >
            <Icon name="plus" size={14} />
          </Link>
        ) : undefined
      }
      footer={
        <AskFooter
          conversation={detail ? detail.publicId : NEW_CONVERSATION}
          opening={!detail}
          canDraft={canDraft}
          defaultBaseUrl={defaultBaseUrl}
        />
      }
    >
      {detail ? (
        <>
          <AskThread turns={turns} author={user.name} />
          {detail.plans.length > 0 && <PlansFrom plans={detail.plans} />}
        </>
      ) : (
        <>
          <Opening everAsked={conversations.length > 0} />
          {conversations.length > 0 && (
            <div className="border-t border-rule-soft">
              <AskHistory conversations={conversations} hrefFor={hrefFor} />
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
