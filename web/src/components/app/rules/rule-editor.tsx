'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Modal } from '../modal';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { CATEGORY, CATEGORY_ORDER } from './categories';
import type { RuleCategory } from '@/lib/mock/types';
import { cn } from '@/lib/cn';

/**
 * Writing a rule down. The category lives in local state rather than on the URL
 * like the generate wizard's steps do, because a link would remount the box and
 * take whatever you had typed with it -- and picking a category is something you
 * do while writing, not before.
 */
export function RuleEditor({ closeHref }: { closeHref: string }) {
  const [category, setCategory] = useState<RuleCategory>('assertion');
  const [name, setName] = useState('');
  const [detail, setDetail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const ready = name.trim() !== '' && detail.trim() !== '';
  const meta = CATEGORY[category];

  return (
    <Modal
      id="rule-editor"
      closeHref={closeHref}
      label="new rule"
      eyebrow="New rule"
      title="Set a standard for every draft"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Link
            href={closeHref}
            scroll={false}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            Cancel
          </Link>
          <Button variant="primary" size="sm" disabled={!ready} onClick={() => setSubmitted(true)}>
            Add rule
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[12px] font-medium text-ink">What kind of rule is it?</legend>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORY_ORDER.map((key) => {
              const option = CATEGORY[key];
              const on = key === category;

              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setCategory(key)}
                  className={cn(
                    'flex flex-col gap-1 rounded-lg border px-2.5 py-2 text-left',
                    'transition-colors duration-150',
                    on ? 'border-ink/25 bg-app' : 'border-rule hover:bg-app',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Icon
                      name={option.icon}
                      size={13}
                      className={on ? option.tone : 'text-ink-subtle'}
                    />
                    <span
                      className={cn(
                        'text-[12.5px] font-medium',
                        on ? 'text-ink' : 'text-ink-muted',
                      )}
                    >
                      {option.label}
                    </span>
                  </span>
                  <span className="text-[11px] leading-snug text-ink-subtle">{option.blurb}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">Name</span>
          <Input
            dense
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSubmitted(false);
            }}
            placeholder="Never a 500"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">The rule itself</span>
          <Input
            dense
            value={detail}
            onChange={(e) => {
              setDetail(e.target.value);
              setSubmitted(false);
            }}
            placeholder={meta.example}
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-[12px]"
          />
          <span className="text-[11.5px] leading-snug text-ink-subtle">
            Say it the way the drafter should read it. Structured fields per category come with the
            API — until then this line is what a draft is handed.
          </span>
        </label>

        {submitted && (
          <p className="flex items-start gap-2 rounded-lg border border-rule bg-app p-3 text-[12.5px] leading-snug text-ink-muted">
            <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-warn" />
            Rules are not stored yet — the table that holds them goes live with the beta API, so
            nothing you type here is kept.
          </p>
        )}
      </div>
    </Modal>
  );
}
