import { cn } from '@/lib/cn';

export function Input({
  className,
  invalid,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        'h-12 w-full rounded-md border bg-surface px-3.5 text-[0.9375rem] text-ink',
        'placeholder:text-ink-subtle',
        'transition-colors duration-150 ease-out',
        invalid ? 'border-fail' : 'border-rule-strong hover:border-ink-subtle',
        'disabled:opacity-50',
        className,
      )}
      {...rest}
    />
  );
}

export function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="flex items-center gap-1.5 text-[13px] text-fail">
      <span aria-hidden className="font-mono">
        ✕
      </span>
      {children}
    </p>
  );
}
