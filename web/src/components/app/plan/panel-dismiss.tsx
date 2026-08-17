'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Escape and backdrop close the inspector by dropping the param that opened it. */
export function PanelDismiss({ closeHref, label }: { closeHref: string; label: string }) {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') router.push(closeHref, { scroll: false });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeHref, router]);

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => router.push(closeHref, { scroll: false })}
      className="absolute inset-0 bg-ink/20"
    />
  );
}
