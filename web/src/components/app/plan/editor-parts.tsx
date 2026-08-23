'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

/**
 * The controls the plan editor is built out of.
 *
 * They are here rather than in `components/ui` because every one of them exists for a
 * form whose state is a working copy in the browser: the modal closes on a callback
 * instead of a link, and the row editors own the array they are editing. The rest of the
 * app's controls are navigation, and navigation would re-render the tree the unsaved
 * plan lives in.
 */

export function EditorModal({
  label,
  eyebrow,
  title,
  footer,
  wide,
  onClose,
  children,
}: {
  label: string;
  eyebrow: string;
  title: string;
  footer?: React.ReactNode;
  wide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label={`Close ${label}`}
        onClick={onClose}
        className="absolute inset-0 bg-ink/25"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          'animate-sheet modal-box relative flex max-h-[88vh] w-full flex-col',
          'overflow-hidden rounded-t-xl border border-rule bg-app-panel shadow-menu',
          'sm:animate-modal sm:rounded-xl',
          wide ? 'max-w-[42rem]' : 'max-w-[30rem]',
        )}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-rule-soft px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[9.5px] tracking-[0.14em] text-ink-subtle uppercase">
              {eyebrow}
            </p>
            <h2 className="mt-1 text-[15px] leading-tight font-semibold tracking-[-0.01em] text-ink">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${label}`}
            className="-mt-0.5 -mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors duration-150 hover:bg-app-hover hover:text-ink"
          >
            <Icon name="close" size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {footer && (
          <div className="shrink-0 border-t border-rule bg-app-panel px-4 py-2.5">{footer}</div>
        )}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11.5px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-ink-subtle">{hint}</span>}
    </label>
  );
}

/** A field whose control is a set of rows, so the label cannot wrap the whole thing. */
export function Group({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-[11.5px] font-medium text-ink">{label}</p>
      {children}
      {hint && <p className="text-[11px] leading-snug text-ink-subtle">{hint}</p>}
    </div>
  );
}

export const MONO = 'font-mono text-[12px]';

export function Area({
  className,
  rows = 3,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={rows}
      className={cn(
        'w-full resize-y rounded-md border border-rule-strong bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink',
        'placeholder:text-ink-subtle hover:border-ink-subtle',
        className,
      )}
      {...rest}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly T[];
  label?: (option: T) => string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn(
        'h-9 min-w-0 rounded-md border border-rule-strong bg-surface px-2 text-[12.5px] text-ink hover:border-ink-subtle',
        className,
      )}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {label ? label(option) : option}
        </option>
      ))}
    </select>
  );
}

/** One choice out of a few, where a select would hide what the options are. */
export function Choice<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly { key: T; label: string; hint?: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.key)}
            className={cn(
              'flex-1 rounded-md border px-2.5 py-2 text-left transition-colors duration-150',
              on
                ? 'border-ink bg-app-active text-ink'
                : 'border-rule bg-app-panel text-ink-muted hover:border-rule-strong hover:text-ink',
            )}
          >
            <span className="block text-[12.5px] font-medium">{option.label}</span>
            {option.hint && (
              <span className="mt-0.5 block text-[11px] leading-snug text-ink-subtle">
                {option.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function IconButton({
  label,
  icon,
  onClick,
  disabled,
  tone,
}: {
  label: string;
  icon: 'close' | 'trash' | 'arrowUp' | 'arrowDown' | 'pencil' | 'plus';
  onClick: () => void;
  disabled?: boolean;
  tone?: 'fail';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-rule bg-app-panel',
        'transition-colors duration-150 disabled:opacity-35',
        tone === 'fail'
          ? 'text-ink-subtle hover:border-fail/40 hover:bg-fail-soft hover:text-fail'
          : 'text-ink-subtle enabled:hover:border-rule-strong enabled:hover:text-ink',
      )}
    >
      <Icon name={icon} size={12} />
    </button>
  );
}

export function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-fit items-center gap-1.5 rounded-md border border-dashed border-rule-strong px-2.5 py-1.5 text-[12px] text-ink-muted transition-colors duration-150 hover:border-ink-subtle hover:text-ink"
    >
      <Icon name="plus" size={12} />
      {label}
    </button>
  );
}

export function List<T>({
  items,
  onChange,
  blank,
  add,
  empty,
  render,
}: {
  items: T[];
  onChange: (next: T[]) => void;
  blank: () => T;
  add: string;
  empty?: string;
  render: (item: T, set: (next: T) => void, index: number) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 && empty && <p className="text-[11.5px] text-ink-subtle">{empty}</p>}

      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            {render(item, (next) => onChange(items.map((it, j) => (j === i ? next : it))), i)}
          </div>
          <IconButton
            label="Remove"
            icon="close"
            tone="fail"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}

      <AddRow label={add} onClick={() => onChange([...items, blank()])} />
    </div>
  );
}

/**
 * A record, edited as rows. The rows are the state and the record is derived from them,
 * because a record cannot hold a key somebody is halfway through typing -- deriving it
 * on every keystroke instead means the half-typed row simply is not in the plan yet.
 */
export function PairRows({
  value,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  add,
  empty,
}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  add: string;
  empty?: string;
}) {
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(value));

  const push = (next: [string, string][]) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter(([k]) => k.trim())));
  };

  return (
    <List
      items={rows}
      onChange={push}
      blank={(): [string, string] => ['', '']}
      add={add}
      empty={empty}
      render={([k, v], set) => (
        <div className="flex min-w-0 gap-1.5">
          <Input
            dense
            value={k}
            placeholder={keyPlaceholder}
            onChange={(e) => set([e.target.value, v])}
            className={cn(MONO, 'flex-1')}
          />
          <Input
            dense
            value={v}
            placeholder={valuePlaceholder}
            onChange={(e) => set([k, e.target.value])}
            className={cn(MONO, 'flex-[1.4]')}
          />
        </div>
      )}
    />
  );
}
