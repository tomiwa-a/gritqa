'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input, FieldError } from '@/components/ui/input';

type State = 'idle' | 'submitting' | 'done' | 'error';

export function WaitlistForm({
  tone = 'light',
  className,
}: {
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');
  const id = useId();
  const errorId = `${id}-error`;
  const dark = tone === 'dark';

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '');
    const botField = String(form.get('botField') ?? '');

    setState('submitting');
    setMessage('');

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, botField }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };

      if (!res.ok || !data.ok) {
        setState('error');
        setMessage(data.error ?? 'Something went wrong. Please try again.');
        return;
      }

      setState('done');
      setMessage("You're on the list. We'll be in touch.");
    } catch {
      setState('error');
      setMessage('Network error. Please try again.');
    }
  }

  if (state === 'done') {
    return (
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-md border px-4 py-3.5',
          dark ? 'border-rule-dark bg-surface-dark-raised' : 'border-pass/25 bg-pass-soft',
          className,
        )}
        role="status"
      >
        <span aria-hidden className={cn('font-mono text-sm', dark ? 'text-term-pass' : 'text-pass')}>
          ✓
        </span>
        <p className={cn('text-sm', dark ? 'text-ink-inverse' : 'text-pass')}>{message}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className={cn('w-full', className)}>
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <div className="flex-1">
          <label htmlFor={id} className="sr-only">
            Work email
          </label>
          <Input
            id={id}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
            disabled={state === 'submitting'}
            invalid={state === 'error'}
            aria-describedby={state === 'error' ? errorId : undefined}
            className={
              dark
                ? 'border-rule-dark bg-surface-dark-raised text-ink-inverse placeholder:text-term-dim hover:border-ink-subtle'
                : undefined
            }
          />
        </div>

        {/* Honeypot — hidden from users and assistive tech alike. */}
        <div aria-hidden className="absolute h-0 w-0 overflow-hidden">
          <input name="botField" tabIndex={-1} autoComplete="off" />
        </div>

        <Button
          type="submit"
          variant={dark ? 'onDark' : 'accent'}
          size="lg"
          disabled={state === 'submitting'}
          trailing={state !== 'submitting'}
          className="shrink-0"
        >
          {state === 'submitting' ? 'Joining…' : 'Join waitlist'}
        </Button>
      </div>

      {/* Live region is always present so the first error is announced. */}
      <div aria-live="polite" className="mt-2 min-h-5">
        {state === 'error' && <FieldError id={errorId}>{message}</FieldError>}
      </div>
    </form>
  );
}
