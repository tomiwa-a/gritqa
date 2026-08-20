import { Icon, type IconName } from '@/components/ui/icon';
import type { AuditEntry, AuditTone } from '@/lib/model';
import { cn } from '@/lib/cn';

const TONE: Record<AuditTone, { icon: IconName; className: string }> = {
  plan: { icon: 'plan', className: 'text-series-1' },
  run: { icon: 'runs', className: 'text-series-3' },
  rule: { icon: 'rules', className: 'text-series-4' },
  project: { icon: 'folder', className: 'text-series-2' },
  account: { icon: 'user', className: 'text-ink-muted' },
};

export function ActivityLog({ entries }: { entries: AuditEntry[] }) {
  return (
    <ol className="flex flex-col">
      {entries.map((entry, i) => {
        const tone = TONE[entry.tone];
        const last = i === entries.length - 1;

        return (
          <li key={entry.id} className="relative flex gap-3 px-4 py-3">
            {!last && (
              <span aria-hidden className="absolute top-9 left-[27px] h-[calc(100%-1.5rem)] w-px bg-rule-soft" />
            )}

            <span
              className={cn(
                'relative z-10 mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-rule bg-app-panel',
                tone.className,
              )}
            >
              <Icon name={tone.icon} size={12} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] leading-snug text-ink">{entry.label}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10.5px] text-ink-subtle">
                <span>{entry.action}</span>
                <span aria-hidden>·</span>
                <span className="nums">{entry.ip}</span>
              </p>
            </div>

            <span className="nums shrink-0 text-[11.5px] text-ink-subtle">{entry.whenLabel}</span>
          </li>
        );
      })}
    </ol>
  );
}
