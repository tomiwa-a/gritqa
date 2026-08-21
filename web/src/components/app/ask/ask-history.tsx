import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { askToken } from '@/lib/overlay';
import type { Conversation } from '@/lib/model';

/**
 * What you asked before, most recently spoken in first.
 *
 * It is the body of the panel when no conversation is open rather than a drawer
 * inside a drawer: with nothing to read, the useful thing to show is what there is to
 * go back to. `updated_at` moves when a message lands, so this sorts by activity --
 * a thread you returned to yesterday sits above one you started last week.
 */
export function AskHistory({
  conversations,
  hrefFor,
}: {
  conversations: Conversation[];
  hrefFor: (token: string) => string;
}) {
  return (
    <ul className="flex flex-col">
      {conversations.map((conversation) => (
        <li key={conversation.publicId} className="border-b border-rule-soft last:border-b-0">
          <Link
            href={hrefFor(askToken(conversation.publicId))}
            scroll={false}
            className="group flex items-start gap-2.5 px-4 py-3 transition-colors duration-150 hover:bg-app-hover"
          >
            <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-rule bg-app-panel text-ink-subtle transition-colors duration-150 group-hover:text-punch-red">
              <Icon name="sparkle" size={12} />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-ink">
                {conversation.title}
              </span>
              <span className="nums mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[11.5px] text-ink-subtle">
                <span>{conversation.whenLabel}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {conversation.turnCount} turn{conversation.turnCount === 1 ? '' : 's'}
                </span>
                {conversation.planCount > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-ink-muted">
                      {conversation.planCount} plan{conversation.planCount === 1 ? '' : 's'}
                    </span>
                  </>
                )}
              </span>
            </span>

            <Icon
              name="chevronRight"
              size={13}
              className="mt-1 shrink-0 text-ink-subtle opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
