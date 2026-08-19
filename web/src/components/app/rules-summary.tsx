import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { CATEGORY, CATEGORY_ORDER } from './rules/categories';
import { rules } from '@/lib/mock/data';

export function RulesSummary() {
  return (
    <ul className="divide-y divide-rule-soft">
      {CATEGORY_ORDER.map((key) => {
        const c = CATEGORY[key];
        const all = rules.filter((r) => r.category === key);
        const off = all.filter((r) => !r.isActive).length;

        return (
          <li key={key}>
            <Link
              href={`/dashboard/rules?category=${key}`}
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
