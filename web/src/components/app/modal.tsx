import Link from 'next/link';
import { OverlayDismiss } from './overlay-dismiss';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

/**
 * Centered, for making something. Wider than a drawer because the things you make
 * here have lists to pick from. Becomes a bottom sheet on a phone.
 */
export function Modal({
  id,
  closeHref,
  label,
  eyebrow,
  title,
  subtitle,
  rail,
  footer,
  children,
}: {
  id: string;
  closeHref: string;
  label: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** Optional step indicator under the header. */
  rail?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 sm:flex sm:items-center sm:justify-center sm:p-6">
      <OverlayDismiss closeHref={closeHref} label={`Close ${label}`} panelId={id} />

      <div
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          'animate-sheet absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col overflow-hidden',
          'rounded-t-xl border border-rule bg-app-panel shadow-menu outline-none',
          'sm:animate-modal sm:relative sm:inset-auto sm:max-h-[min(46rem,86vh)]',
          'sm:w-[min(44rem,92vw)] sm:rounded-xl',
        )}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-rule-soft px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[9.5px] tracking-[0.14em] text-ink-subtle uppercase">
              {eyebrow}
            </p>
            <h2 className="mt-1 text-[15px] leading-tight font-semibold tracking-[-0.01em] text-ink">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{subtitle}</p>
            )}
          </div>

          <Link
            href={closeHref}
            scroll={false}
            aria-label={`Close ${label}`}
            className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors duration-150 hover:bg-app-hover hover:text-ink"
          >
            <Icon name="close" size={14} />
          </Link>
        </header>

        {rail && (
          <div className="shrink-0 border-b border-rule-soft bg-app px-4 py-3 sm:px-5">{rail}</div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

        {footer && (
          <div className="shrink-0 border-t border-rule bg-app-panel px-4 py-3 sm:px-5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
