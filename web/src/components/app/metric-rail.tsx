import Link from 'next/link';
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
  /** Where the number came from, when there is a page that shows it. */
  href?: string;
};

function Body({ cell }: { cell: MetricCell }) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-rule-soft bg-app px-4 py-2">
        <Icon name={cell.icon} size={13} className="text-ink-subtle" />
        <span className="truncate text-[11.5px] font-medium tracking-[0.02em] text-ink-muted">
          {cell.label}
        </span>
        {cell.href && (
          <Icon
            name="arrowUpRight"
            size={12}
            className="ml-auto shrink-0 text-rule-strong transition-colors duration-150 group-hover:text-ink-subtle"
          />
        )}
      </div>

      <div className="px-4 pt-3.5 pb-4">
        <p className="flex items-baseline gap-1">
          <span className="nums text-metric text-ink">{cell.value}</span>
          {cell.unit && <span className="text-[13px] text-ink-subtle">{cell.unit}</span>}
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          <Delta direction={cell.direction} value={cell.delta} tone={cell.tone} />
          <span className="nums truncate text-[11.5px] text-ink-subtle">{cell.comparison}</span>
        </div>
      </div>
    </>
  );
}

export function MetricRail({ cells }: { cells: MetricCell[] }) {
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-rule bg-rule-soft shadow-panel sm:grid-cols-2 xl:grid-cols-4">
      {cells.map((c) =>
        c.href ? (
          <Link
            key={c.label}
            href={c.href}
            className="group bg-app-panel transition-colors duration-150 hover:bg-app-hover"
          >
            <Body cell={c} />
          </Link>
        ) : (
          <div key={c.label} className="bg-app-panel">
            <Body cell={c} />
          </div>
        ),
      )}
    </div>
  );
}
