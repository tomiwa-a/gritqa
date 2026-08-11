import { Icon, type IconName } from '@/components/ui/icon';
import { Delta, type DeltaDirection, type DeltaTone } from './delta';

export type MetricCell = {
  icon: IconName;
  label: string;
  value: string;
  unit?: string;
  direction: DeltaDirection;
  delta: string;
  tone: DeltaTone;
  comparison: string;
};

export function MetricRail({ cells }: { cells: MetricCell[] }) {
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-rule bg-rule-soft shadow-panel sm:grid-cols-2 xl:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="bg-app-panel">
          <div className="flex items-center gap-2 border-b border-rule-soft bg-app px-4 py-2">
            <Icon name={c.icon} size={13} className="text-ink-subtle" />
            <span className="truncate text-[11.5px] font-medium tracking-[0.02em] text-ink-muted">
              {c.label}
            </span>
          </div>

          <div className="px-4 pt-3.5 pb-4">
            <p className="flex items-baseline gap-1">
              <span className="nums text-metric text-ink">{c.value}</span>
              {c.unit && <span className="text-[13px] text-ink-subtle">{c.unit}</span>}
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <Delta direction={c.direction} value={c.delta} tone={c.tone} />
              <span className="nums truncate text-[11.5px] text-ink-subtle">{c.comparison}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
