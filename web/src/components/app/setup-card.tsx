'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';

const TOTAL = 4;

export function SetupCard({ step = 2 }: { step?: number }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="rounded-lg border border-rule bg-app p-3">
      <div className="flex items-center gap-2">
        <Icon name="terminal" size={14} className="text-ink-muted" />
        <span className="flex-1 text-[13px] font-medium text-ink">Connect the CLI</span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss setup"
          className="-mr-1 flex h-5 w-5 items-center justify-center rounded text-ink-subtle transition-colors duration-150 hover:bg-app-active hover:text-ink"
        >
          <Icon name="close" size={12} />
        </button>
      </div>

      <p className="mt-1.5 text-[12.5px] leading-snug text-ink-muted">
        Install it, run it once in your project, and this dashboard fills itself in.
      </p>

      <div className="mt-3 flex items-center gap-1.5" aria-hidden>
        {Array.from({ length: TOTAL }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full',
              i < step - 1 ? 'bg-ink' : i === step - 1 ? 'bg-punch-red' : 'bg-app-active',
            )}
          />
        ))}
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <span className="nums text-[11.5px] text-ink-subtle">
          Step {step} of {TOTAL}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={() => setDismissed(true)}>
            Skip
          </Button>
          <Link href="/dashboard/setup" className={cn(buttonVariants({ variant: 'primary', size: 'xs' }))}>
            Continue
          </Link>
        </div>
      </div>
    </div>
  );
}
