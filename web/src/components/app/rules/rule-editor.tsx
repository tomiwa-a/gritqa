'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { Modal } from '../modal';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { CATEGORY, CATEGORY_ORDER } from './categories';
import { saveRuleAction } from '@/lib/actions/rules';
import type { RuleCategory, TestingRule } from '@/lib/mock/types';
import { cn } from '@/lib/cn';

/**
 * Writing a rule down. The category lives in local state rather than on the URL
 * like the generate wizard's steps do, because a link would remount the box and
 * take whatever you had typed with it -- and picking a category is something you
 * do while writing, not before.
 *
 * The same box edits an existing rule, prefilled, because there is nothing
 * different to say about one -- only a hidden `publicId` separates the two, and the
 * action decides insert or update from its presence.
 */
export function RuleEditor({ closeHref, rule }: { closeHref: string; rule?: TestingRule }) {
  const [category, setCategory] = useState<RuleCategory>(rule?.category ?? 'assertion');
  const [state, action] = useActionState(saveRuleAction, null);

  const meta = CATEGORY[category];
  const editing = rule !== undefined;

  return (
    <form action={action}>
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="closeHref" value={closeHref} />
      {editing && <input type="hidden" name="publicId" value={rule.publicId} />}

      <Modal
        id="rule-editor"
        closeHref={closeHref}
        label={editing ? 'edit rule' : 'new rule'}
        eyebrow={editing ? 'Edit rule' : 'New rule'}
        title={editing ? 'Change what every draft follows' : 'Set a standard for every draft'}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Link
              href={closeHref}
              scroll={false}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              Cancel
            </Link>
            <SaveButton editing={editing} />
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
              name="name"
              defaultValue={rule?.name}
              placeholder="Never a 500"
              autoComplete="off"
              spellCheck={false}
              maxLength={255}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink">The rule itself</span>
            <Input
              dense
              name="detail"
              defaultValue={rule?.detail}
              placeholder={meta.example}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-[12px]"
            />
            <span className="text-[11.5px] leading-snug text-ink-subtle">
              Say it the way the drafter should read it. Structured fields per category are still to
              come — until then this line is what a draft is handed.
            </span>
          </label>

          {state?.error && (
            <p className="flex items-start gap-2 rounded-lg border border-rule bg-app p-3 text-[12.5px] leading-snug text-ink-muted">
              <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-warn" />
              {state.error}
            </p>
          )}
        </div>
      </Modal>
    </form>
  );
}

/**
 * Separate so `useFormStatus` can see the submission -- it only reports on a form
 * above it in the tree, so a hook called in the component that renders the `<form>`
 * would always read idle.
 */
function SaveButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="primary" size="sm" disabled={pending}>
      {pending ? 'Saving…' : editing ? 'Save rule' : 'Add rule'}
    </Button>
  );
}
