import { cn } from '@/lib/cn';

export function SettingRows({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('flex flex-col', className)}>{children}</div>;
}

export function SettingRow({
  label,
  hint,
  value,
  mono,
  control,
  className,
}: {
  label: string;
  hint?: string;
  value?: React.ReactNode;
  mono?: boolean;
  control?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule-soft px-4 py-3.5 last:border-b-0',
        className,
      )}
    >
      <div className="min-w-0 flex-1 basis-[220px]">
        <p className="text-[13px] font-medium text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[12px] leading-snug text-ink-subtle">{hint}</p>}
      </div>

      {value !== undefined && (
        <p
          className={cn(
            'min-w-0 truncate text-[13px] text-ink-muted',
            mono && 'nums font-mono text-[12.5px]',
          )}
        >
          {value}
        </p>
      )}

      {control && <div className="ml-auto flex shrink-0 items-center gap-2">{control}</div>}
    </div>
  );
}
