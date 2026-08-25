import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Topbar } from '@/components/app/topbar';
import { PageBody } from '@/components/app/page-body';
import { Panel } from '@/components/app/panel';
import { OverlayHost } from '@/components/app/overlay-host';
import { AskThread, awaitingAnswer } from '@/components/app/ask/ask-thread';
import { WorkPulse } from '@/components/app/work-pulse';
import { AskFooter } from '@/components/app/ask/ask-footer';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { buttonVariants } from '@/components/ui/button';
import { getConversation, getLastBaseUrl, getUser } from '@/lib/data';
import { pulse } from '@/lib/work/pulse';
import { NEW_CONVERSATION, askToken, withOverlay, type PageParams } from '@/lib/overlay';
import type { ConversationDetail } from '@/lib/model';

/**
 * One thread, with the room to read it.
 *
 * The panel and this page are the same conversation and the same composer -- there is
 * one `askAction`, and `AskFooter` is the one it posts through on both surfaces. What
 * differs is width, and width is the whole reason this exists: the answers arrive as
 * documents, with headings and nested lists and a fenced query, and 21rem turns a
 * document into a column of fragments.
 *
 * A thread is addressed by route here and by search param in the panel. `askAction`
 * reads which surface asked off the href the composer sends, so a new conversation
 * started from these pages lands on its own page and one started anywhere else stays
 * in the panel over the page you were reading.
 */

const PATH = '/dashboard/conversations';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getConversation(id);
  return { title: detail ? `${detail.title} · GritQA` : 'Conversation not found · GritQA' };
}

/** Plans that came out of this thread, which is the reason a conversation is kept. */
function PlansFrom({ plans }: { plans: ConversationDetail['plans'] }) {
  return (
    <Panel
      title={plans.length === 1 ? 'Plan from this' : 'Plans from this'}
      subtitle="Drafted from this conversation, newest first."
      bodyClassName="p-3"
    >
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
    </Panel>
  );
}

/** One fact per line. Only what is stored: no read here derives a date it does not have. */
function Facts({ detail }: { detail: ConversationDetail }) {
  const started = detail.turns[0]?.whenLabel;
  const rows: [string, string][] = [
    ['Turns', String(detail.turnCount)],
    ...(started ? [['Started', started] as [string, string]] : []),
    ['Last reply', detail.whenLabel],
    ['Plans drafted', String(detail.planCount)],
  ];

  return (
    <Panel title="About this thread" bodyClassName="p-0">
      <dl className="flex flex-col">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-3 border-b border-rule-soft px-3.5 py-2.5 last:border-b-0"
          >
            <dt className="text-[12px] text-ink-subtle">{label}</dt>
            <dd className="nums text-[12.5px] text-ink-muted">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<PageParams>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const detail = await getConversation(id);
  if (!detail) notFound();

  const [user, defaultBaseUrl] = await Promise.all([getUser(), getLastBaseUrl()]);

  const base = `${PATH}/${detail.publicId}`;
  const canDraft = detail.turns.some((turn) => turn.author === 'ai');
  const mark = await pulse(awaitingAnswer(detail.turns));

  return (
    <>
      {mark !== null && <WorkPulse mark={mark} />}
      <Topbar
        icon="sparkle"
        title={detail.title}
        action={
          <Link
            href={withOverlay(PATH, {}, askToken(NEW_CONVERSATION))}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <Icon name="plus" size={14} />
            New
          </Link>
        }
      />

      <PageBody>
        <Link
          href={PATH}
          className="group inline-flex items-center gap-1.5 text-[12.5px] text-ink-subtle transition-colors duration-150 hover:text-ink"
        >
          <Icon
            name="chevronRight"
            size={13}
            className="rotate-180 transition-transform duration-150 group-hover:-translate-x-0.5"
          />
          All conversations
        </Link>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.14em] text-ink-subtle uppercase">
              Conversation
            </p>
            <h2 className="mt-1.5 max-w-[62ch] text-[20px] leading-tight font-semibold tracking-[-0.02em] text-ink">
              {detail.title}
            </h2>
            <p className="nums mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-subtle">
              <span>
                {detail.turnCount} turn{detail.turnCount === 1 ? '' : 's'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{detail.whenLabel}</span>
              <span aria-hidden="true">·</span>
              <span>Read from your code, never changed it</span>
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_290px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Panel
              title="The exchange"
              subtitle="Oldest first. Every answer carries the account of how GritQA got there."
              bodyClassName="p-0"
            >
              <AskThread turns={detail.turns} author={user.name} size="lg" />
            </Panel>

            {/* The same composer the panel uses, and the same action behind it: one
                place asks, so a follow-up here and a follow-up there are one thread. */}
            <Panel
              title="Keep going"
              subtitle="A follow-up carries the whole conversation with it, so you can build on what was already established."
            >
              <AskFooter
                conversation={detail.publicId}
                opening={false}
                canDraft={canDraft}
                defaultBaseUrl={defaultBaseUrl}
              />
            </Panel>
          </div>

          <aside className="flex min-w-0 flex-col gap-4">
            {detail.plans.length > 0 && <PlansFrom plans={detail.plans} />}
            <Facts detail={detail} />
          </aside>
        </div>
      </PageBody>

      <OverlayHost params={query} pathname={base} />
    </>
  );
}
