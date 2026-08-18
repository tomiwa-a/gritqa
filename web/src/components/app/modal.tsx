import Link from 'next/link';
import { OverlayDismiss } from './overlay-dismiss';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

/**
 * A square box, sized like the rest of the app: a little wider than the drawer,
 * never a takeover. The height is fixed rather than grown from the content, so
 * stepping through a wizard does not make the box jump around underneath you —
 * long content scrolls in the body instead.
 *
 * Anything that does not fit belongs on a page, not in here.
 */
export function Modal({
  id,
  closeHref,
  label,
  eyebrow,
  title,
  progress,
  footer,
  children,
}: {
  id: string;
  closeHref: string;
  label: string;
  eyebrow: string;
  title: string;
  /** Step counter for a wizard, drawn as a hairline. Bounded on purpose. */
  progress?: { current: number; total: number };
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6">
      <OverlayDismiss closeHref={closeHref} label={`Close ${label}`} panelId={id} />

      <div
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          'animate-sheet relative flex h-[min(30rem,88dvh)] w-full max-w-[30rem] flex-col',
          'overflow-hidden rounded-t-xl border border-rule bg-app-panel shadow-menu outline-none',
          'sm:animate-modal sm:rounded-xl',
        )}
      >
        <header className="shrink-0 border-b border-rule-soft px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[9.5px] tracking-[0.14em] text-ink-subtle uppercase">
                {eyebrow}
              </p>
              <h2 className="mt-1 text-[15px] leading-tight font-semibold tracking-[-0.01em] text-ink">
                {title}
              </h2>
            </div>

            <Link
              href={closeHref}
              scroll={false}
              aria-label={`Close ${label}`}
              className="-mt-0.5 -mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors duration-150 hover:bg-app-hover hover:text-ink"
            >
              <Icon name="close" size={14} />
            </Link>
          </div>

          {progress && (
            <div aria-hidden="true" className="mt-2.5 flex gap-1">
              {Array.from({ length: progress.total }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-[3px] flex-1 rounded-full',
                    i < progress.current ? 'bg-ink' : 'bg-rule',
                  )}
                />
              ))}
            </div>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

        {footer && (
          <div className="shrink-0 border-t border-rule bg-app-panel px-4 py-2.5">{footer}</div>
        )}
      </div>
    </div>
  );
}
