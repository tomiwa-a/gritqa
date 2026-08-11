'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';

const FIELD = 'h-10 text-[13.5px]';

export function ProviderStep() {
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [consent, setConsent] = useState(false);
  const [saved, setSaved] = useState(false);

  const ready = baseUrl.trim() !== '' && model.trim() !== '' && key.trim() !== '' && consent;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-ink-muted">
        GritQA drafts plans through the provider you choose. Any OpenAI-compatible endpoint works —
        DeepSeek, OpenAI, Claude, or Gemini — so you keep the account and the bill.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">Base URL</span>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com/v1"
            className={FIELD}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">Model</span>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="deepseek-chat"
            className={FIELD}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink">API key</span>
        <span className="relative flex">
          <Input
            type={reveal ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-…"
            className={cn(FIELD, 'pr-11 font-mono')}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? 'Hide the key' : 'Show the key'}
            className="absolute top-0 right-0 flex h-10 w-10 items-center justify-center text-ink-subtle transition-colors duration-150 hover:text-ink"
          >
            <Icon name={reveal ? 'eyeOff' : 'eye'} size={14} />
          </button>
        </span>
        <span className="text-[11.5px] text-ink-subtle">
          Stored encrypted. Only used to draft plans you asked for.
        </span>
      </label>

      <label
        className={cn(
          'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors duration-150',
          consent ? 'border-ink/20 bg-app' : 'border-rule hover:bg-app',
        )}
      >
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-punch-red"
        />
        <span className="text-[12.5px] leading-snug text-ink-muted">
          <span className="font-medium text-ink">I agree to send changed files for drafting.</span>{' '}
          When you ask for a plan, only the files that changed go to the provider above. Your source
          is never kept on our servers, and nothing is sent unless you ask.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={!ready} onClick={() => setSaved(true)}>
          Save provider
        </Button>
        <Link
          href="/dashboard/test-plans"
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          I would rather write plans myself
        </Link>
      </div>

      {saved && (
        <p className="flex items-start gap-2 rounded-lg border border-rule bg-app p-3 text-[12.5px] text-ink-muted">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-warn" />
          Keys are not accepted yet — the vault that holds them goes live with the beta API. Your
          choices here are not stored.
        </p>
      )}
    </div>
  );
}
