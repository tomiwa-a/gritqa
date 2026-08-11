'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { Button, buttonVariants } from '@/components/ui/button';

const SCOPE = [
  'Read this project’s plans, rules, and mock endpoints',
  'Report run results back to this dashboard',
  'Nothing else — the CLI cannot read your other projects',
];

export function CliApproval({ code, project }: { code: string; project: string }) {
  const [outcome, setOutcome] = useState<'pending' | 'approved' | 'denied'>('pending');

  if (outcome !== 'pending') {
    const approved = outcome === 'approved';

    return (
      <>
        <span
          className={
            approved
              ? 'flex h-9 w-9 items-center justify-center rounded-lg border border-pass/25 bg-pass-soft text-pass'
              : 'flex h-9 w-9 items-center justify-center rounded-lg border border-rule bg-app text-ink-subtle'
          }
        >
          <Icon name={approved ? 'check' : 'close'} size={17} />
        </span>

        <h1 className="mt-4 text-[17px] font-semibold tracking-[-0.02em] text-ink">
          {approved ? 'This machine is linked' : 'Nothing was linked'}
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          {approved
            ? `Head back to your terminal — the CLI is picking up ${project} now.`
            : 'The request was turned down. If that was not you, the code is already useless.'}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link href="/dashboard" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
            Go to the dashboard
          </Link>
          {!approved && (
            <button
              type="button"
              onClick={() => setOutcome('pending')}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              Back to the request
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-rule-dark bg-surface-dark text-ink-inverse">
        <Icon name="terminal" size={17} />
      </span>

      <h1 className="mt-4 text-[17px] font-semibold tracking-[-0.02em] text-ink">
        A CLI wants to link to your account
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
        Only approve this if you started it. Check the code below against the one in your terminal.
      </p>

      <div className="mt-5 rounded-lg border border-rule bg-app px-4 py-3.5 text-center">
        <p className="text-[11px] font-medium tracking-[0.14em] text-ink-subtle uppercase">
          Code in your terminal
        </p>
        <p className="nums mt-1.5 font-mono text-[22px] font-medium tracking-[0.22em] text-ink">
          {code}
        </p>
      </div>

      <dl className="mt-4 flex flex-col divide-y divide-rule-soft border-y border-rule-soft">
        <div className="flex items-center justify-between gap-3 py-2.5">
          <dt className="text-[12.5px] text-ink-muted">Project</dt>
          <dd className="font-mono text-[12.5px] text-ink">{project}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-2.5">
          <dt className="text-[12.5px] text-ink-muted">Requested</dt>
          <dd className="text-[12.5px] text-ink">Moments ago</dd>
        </div>
      </dl>

      <ul className="mt-4 flex flex-col gap-2">
        {SCOPE.map((line) => (
          <li key={line} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-muted">
            <Icon name="check" size={13} className="mt-[3px] shrink-0 text-pass" />
            {line}
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => setOutcome('approved')}>
          Approve this machine
        </Button>
        <Button variant="danger" size="sm" onClick={() => setOutcome('denied')}>
          Deny
        </Button>
      </div>
    </>
  );
}
