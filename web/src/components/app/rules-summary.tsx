import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icon';
import { rules } from '@/lib/mock/data';
import type { RuleCategory } from '@/lib/mock/types';

const CATEGORIES: { key: RuleCategory; label: string; icon: IconName; blurb: string }[] = [
  { key: 'ordering', label: 'Ordering', icon: 'runs', blurb: 'What runs before what' },
  { key: 'mock', label: 'Mocks', icon: 'mock', blurb: 'Who answers instead of the real service' },
  { key: 'assertion', label: 'Assertions', icon: 'check', blurb: 'What every step must hold to' },
  { key: 'fixture', label: 'Fixtures', icon: 'database', blurb: 'The values each run is given' },
];

export function RulesSummary() {
  return (
    <ul className="divide-y divide-rule-soft">
      {CATEGORIES.map((c) => {
        const all = rules.filter((r) => r.category === c.key);
        const off = all.filter((r) => !r.isActive).length;

        return (
          <li key={c.key}>
            <Link
              href="/dashboard/rules"
              className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-app-hover"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-rule bg-app text-ink-muted">
                <Icon name={c.icon} size={14} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-ink">{c.label}</span>
                <span className="block truncate text-[11.5px] text-ink-subtle">{c.blurb}</span>
              </span>

              {off > 0 && (
                <span className="nums shrink-0 rounded bg-app-active px-1.5 py-0.5 text-[11px] text-ink-subtle">
                  {off} off
                </span>
              )}

              <span className="nums shrink-0 text-[13px] font-medium text-ink">
                {all.length - off}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
