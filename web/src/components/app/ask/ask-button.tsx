'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { NEW_CONVERSATION, askToken, withOverlayOn } from '@/lib/overlay';
import { cn } from '@/lib/cn';

/**
 * The way in, and it lives in the sidebar rather than on a page.
 *
 * Asking about the code is a project-level capability, not something you do to a
 * plan -- and it is not a `NavItem`, because a panel that opens over the page you are
 * reading has nothing for `aria-current` to mean. So it is an action, and it looks
 * like one: the accent on the icon is the only thing in the sidebar that carries it.
 *
 * The href is built from wherever you are, so the panel opens over the page you were
 * on and closing it puts you back with your filters intact.
 */
export function AskButton({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? '/dashboard';
  const search = useSearchParams()?.toString();
  const here = search ? `${pathname}?${search}` : pathname;

  return (
    <Link
      href={withOverlayOn(here, askToken(NEW_CONVERSATION))}
      scroll={false}
      onClick={onNavigate}
      title={collapsed ? 'Ask GritQA' : undefined}
      className={cn(
        'group flex h-9 items-center rounded-md border border-rule bg-app text-[13.5px] font-medium text-ink',
        'transition-colors duration-150 ease-out hover:border-rule-strong hover:bg-app-panel',
        collapsed ? 'w-9 justify-center px-0' : 'gap-2.5 px-2.5',
      )}
    >
      <Icon name="sparkle" size={16} className="shrink-0 text-punch-red" />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">Ask GritQA</span>
          <span className="text-[11px] font-normal text-ink-subtle">about your code</span>
        </>
      )}
    </Link>
  );
}
