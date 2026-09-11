import Link from 'next/link';
import { Topbar } from '@/components/app/topbar';
import { PageBody } from '@/components/app/page-body';
import { AppPageHeader } from '@/components/app/page-header';
import { Panel } from '@/components/app/panel';
import { EmptyState } from '@/components/app/empty-state';
import { OverlayHost } from '@/components/app/overlay-host';
import { Icon } from '@/components/ui/icon';
import { buttonVariants } from '@/components/ui/button';
import { NoProjectGate } from '@/components/app/no-project-gate';
import { getConversations, getCurrentProjectOrNull } from '@/lib/data';
import { NEW_CONVERSATION, askToken, withOverlay, type PageParams } from '@/lib/overlay';
import type { Conversation } from '@/lib/model';

/**
 * Everything this project has asked, so a thread can be picked up rather than
 * restarted.
 *
 * The panel could always list these, and listing was all it could do: a drawer is
 * 21rem wide and an answer that took twelve tool calls is not a 21rem document. So
 * the panel keeps the asking -- it opens over whatever you were reading, which is the
 * point of it -- and the browsing and the re-reading move here, where a row has room
 * for what was said and a thread has room to be read.
 *
 * Starting a conversation is still the panel, opened over this page. There is no
 * `/new` route, for the reason `overlay.ts` gives: a route that exists only to hold a
 * thing that does not exist yet.
 */

export const metadata = { title: 'Conversations · GritQA' };

const PATH = '/dashboard/conversations';

/**
 * One thread, as much of it as a row can hold.
 *
 * The preview is the last thing said, which is always GritQA's side -- an exchange is
 * written as a pair. That is the half you recognise a thread by: you remember being
 * told something, not how you phrased the question.
 */
function Row({ conversation }: { conversation: Conversation }) {
  return (
    <li className="border-b border-rule-soft last:border-b-0">
      <Link
        href={`${PATH}/${conversation.publicId}`}
        className="group flex items-start gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-app-hover"
      >
        <span className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-rule bg-app-panel text-punch-red">
          <Icon name="sparkle" size={13} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink group-hover:underline group-hover:decoration-rule-strong group-hover:underline-offset-2">
            {conversation.title}
          </span>

          {conversation.preview && (
            <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-muted [overflow-wrap:anywhere] line-clamp-2">
              {conversation.preview}
            </span>
          )}

          <span className="nums mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11.5px] text-ink-subtle">
            <span>{conversation.whenLabel}</span>
            <span aria-hidden="true">·</span>
            <span>
              {conversation.turnCount} turn{conversation.turnCount === 1 ? '' : 's'}
            </span>
            {conversation.planCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="flex items-baseline gap-1 text-ink-muted">
                  <Icon name="plan" size={11} className="translate-y-px" />
                  {conversation.planCount} plan{conversation.planCount === 1 ? '' : 's'} from this
                </span>
              </>
            )}
          </span>
        </span>

        <Icon
          name="chevronRight"
          size={14}
          className="mt-1.5 shrink-0 text-ink-subtle opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        />
      </Link>
    </li>
  );
}

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<PageParams>;
}) {
  const params = await searchParams;
  const project = await getCurrentProjectOrNull();
  if (!project) return <NoProjectGate icon="sparkle" title="Conversations" />;
  const conversations = await getConversations();
  const askHref = withOverlay(PATH, params, askToken(NEW_CONVERSATION));
  const withPlans = conversations.filter((conversation) => conversation.planCount > 0).length;

  return (
    <>
      <Topbar
        icon="sparkle"
        title="Conversations"
        action={
          <Link href={askHref} scroll={false} className={buttonVariants({ size: 'sm' })}>
            <Icon name="plus" size={14} />
            Ask GritQA
          </Link>
        }
      />

      <PageBody>
        <AppPageHeader
          title="What you have asked"
          description="GritQA reads the code in this project to answer, so these are answers about your API and not about APIs in general. Nothing here changed your code or ran anything."
          action={
            conversations.length > 0 ? (
              <span className="nums text-[12.5px] text-ink-subtle">
                {conversations.length} conversation{conversations.length === 1 ? '' : 's'}
                {withPlans > 0 && ` · ${withPlans} led to a plan`}
              </span>
            ) : undefined
          }
        />

        <div className="mt-5">
          {conversations.length === 0 ? (
            <EmptyState
              icon="sparkle"
              title="Nothing asked yet"
              description="Ask what a request has to send, what comes back, or what has to be true first. Every answer is kept here, so you can come back to it and draft a plan from it later."
              action={
                <Link href={askHref} scroll={false} className={buttonVariants({ size: 'sm' })}>
                  <Icon name="sparkle" size={14} />
                  Ask about this codebase
                </Link>
              }
            />
          ) : (
            <Panel
              title="Every conversation"
              subtitle="Most recently spoken in first — a thread you came back to yesterday sits above one you started last week."
              bodyClassName="p-0"
            >
              <ul className="flex flex-col">
                {conversations.map((conversation) => (
                  <Row key={conversation.publicId} conversation={conversation} />
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </PageBody>

      <OverlayHost params={params} pathname={PATH} />
    </>
  );
}
