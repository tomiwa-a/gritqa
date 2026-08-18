'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { lockScroll } from '@/lib/scroll-lock';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * The only client part of an overlay. Mounts exactly when one is open, so it also
 * owns the body scroll lock and keeping the keyboard inside the panel.
 */
export function OverlayDismiss({
  closeHref,
  label,
  panelId,
}: {
  closeHref: string;
  label: string;
  panelId: string;
}) {
  const router = useRouter();

  useEffect(() => {
    const close = () => router.push(closeHref, { scroll: false });
    const panel = () => document.getElementById(panelId);

    const opener = document.activeElement;
    panel()?.focus();

    const releaseScroll = lockScroll();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key !== 'Tab') return;

      const root = panel();
      if (!root) return;

      const stops = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (stops.length === 0) return;

      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;

      if (!(active instanceof HTMLElement) || !root.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      releaseScroll();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [closeHref, panelId, router]);

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => router.push(closeHref, { scroll: false })}
      className="animate-veil absolute inset-0 bg-ink/25"
    />
  );
}
