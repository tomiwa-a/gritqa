import { cn } from '@/lib/cn';

/**
 * A native `<select>`, styled to match `Input`.
 *
 * Native on purpose. This is the control the environment screen is built out of, and
 * the reason it is a dropdown rather than a text field is that **a dropdown cannot be
 * malformed** — the other half of this product has an unrunnable plan on disk today
 * because a hand edit left `{{roomTypeName Updated}}` in it. A custom listbox would
 * put that guarantee behind a component of ours; the platform's own control gives it
 * for free, along with keyboard behaviour and a phone's native picker.
 */
export function Select({
  className,
  dense,
  invalid,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { dense?: boolean; invalid?: boolean }) {
  return (
    <div className="relative">
      <select
        aria-invalid={invalid || undefined}
        className={cn(
          'w-full appearance-none rounded-md border bg-surface text-ink',
          dense ? 'h-9 pr-8 pl-3 text-[13px]' : 'h-12 pr-9 pl-3.5 text-[0.9375rem]',
          'transition-colors duration-150 ease-out',
          invalid ? 'border-fail' : 'border-rule-strong hover:border-ink-subtle',
          'disabled:opacity-50',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-subtle',
          dense ? 'right-2.5 h-3.5 w-3.5' : 'right-3 h-4 w-4',
        )}
      >
        <path
          d="M4 6.5 8 10.5 12 6.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
