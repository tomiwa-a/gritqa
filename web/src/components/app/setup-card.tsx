'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export function SetupCard() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="rounded-lg border border-rule bg-app p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded border border-rule-dark bg-surface-dark text-ink-inverse">
          <Icon name="terminal" size={11} />
        </span>
        <span className="flex-1 text-[13px] font-medium text-ink">Another machine?</span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="-mr-1 flex h-5 w-5 items-center justify-center rounded text-ink-subtle transition-colors duration-150 hover:bg-app-active hover:text-ink"
        >
          <Icon name="close" size={12} />
        </button>
      </div>

      <p className="mt-1.5 text-[12.5px] leading-snug text-ink-muted">
        Install the CLI on your other laptop or a build box and it reports into this same project.
      </p>

      <Link
        href="/dashboard/setup"
        className={cn(buttonVariants({ variant: 'secondary', size: 'xs' }), 'mt-2.5 w-full')}
      >
        Show me how
      </Link>
    </div>
  );
}
