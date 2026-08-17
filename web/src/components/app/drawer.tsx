import Link from 'next/link';
import { OverlayDismiss } from './overlay-dismiss';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

/**
 * A panel, not a takeover: it slides off the right edge and takes about as much
 * room as the left sidebar. Anything that needs more than this belongs on a page.
 */
export function Drawer({
  id,
  closeHref,
  label,
  eyebrow,
  title,
  nav,
  footer,
  children,
}: {
  id: string;
  closeHref: string;
  /** Accessible name for the panel and its backdrop. */
  label: string;
  eyebrow: string;
  title: ReactNode;
  /** Optional controls beside the close button, e.g. previous/next. */
  nav?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40">
      <OverlayDismiss closeHref={closeHref} label={`Close ${label}`} panelId={id} />

      <aside
        id={id}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          'animate-drawer absolute inset-y-0 right-0 flex w-[min(21rem,88vw)] flex-col',
          'overflow-hidden border-l border-rule bg-app-panel shadow-menu outline-none',
        )}
      >
        <header className="flex shrink-0 items-start gap-2 border-b border-rule-soft px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[9.5px] tracking-[0.14em] text-ink-subtle uppercase">
              {eyebrow}
            </p>
            <div className="mt-1 text-[13.5px] leading-snug font-medium text-ink">{title}</div>
          </div>

          {nav}

          <Link
            href={closeHref}
            scroll={false}
            aria-label={`Close ${label}`}
            className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors duration-150 hover:bg-app-hover hover:text-ink"
          >
            <Icon name="close" size={14} />
          </Link>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

        {footer && (
          <div className="shrink-0 border-t border-rule bg-app-panel px-4 py-3">{footer}</div>
        )}
      </aside>
    </div>
  );
}

/** A stacked label-and-content block, the drawer's only body rhythm. */
export function DrawerBlock({
  label,
  meta,
  children,
  className,
}: {
  label: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-b border-rule-soft px-4 py-3 last:border-b-0', className)}>
      <div className="flex items-baseline gap-2">
        <h3 className="font-mono text-[9.5px] tracking-[0.14em] text-ink-subtle uppercase">
          {label}
        </h3>
        {meta && <span className="ml-auto text-[11.5px] text-ink-subtle">{meta}</span>}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Label/value rows for the handful of facts a preview carries. */
export function DrawerFacts({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-[12px] text-ink-subtle">{row.label}</dt>
          <dd className="nums min-w-0 truncate text-right text-[12.5px] text-ink-muted">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
