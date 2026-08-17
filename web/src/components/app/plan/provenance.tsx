import { Icon } from '@/components/ui/icon';
import type { TestPlanDetail } from '@/lib/mock/types';
import { user } from '@/lib/mock/data';
import { cn } from '@/lib/cn';

function Bar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions || 1;
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="flex h-1.5 w-16 overflow-hidden rounded-full bg-rule">
        <span className="bg-pass" style={{ width: `${(additions / total) * 100}%` }} />
        <span className="bg-fail" style={{ width: `${(deletions / total) * 100}%` }} />
      </span>
      <span className="nums font-mono text-[11px] text-ink-subtle">
        <span className="text-pass">+{additions}</span> <span className="text-fail">−{deletions}</span>
      </span>
    </span>
  );
}

export function Provenance({ plan, className }: { plan: TestPlanDetail; className?: string }) {
  const diff = plan.diffContext;

  if (!diff) {
    const first = plan.revisions[0];
    return (
      <div className={cn('flex flex-col gap-2.5 px-4 py-3.5', className)}>
        <p className="flex items-center gap-2 text-[12.5px] text-ink-muted">
          <Icon name="user" size={13} className="text-ink-subtle" />
          Started by hand by {user.name}, {plan.createdLabel}.
        </p>
        {first?.instruction && (
          <blockquote className="border-l-2 border-rule-strong pl-3 text-[13px] leading-relaxed text-ink">
            “{first.instruction}”
          </blockquote>
        )}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5">
        <span className="flex items-center gap-1.5 text-[12.5px] text-ink">
          <Icon name="branch" size={13} className="text-ink-subtle" />
          <span className="font-mono">{diff.branch}</span>
        </span>
        <span aria-hidden className="h-3.5 w-px bg-rule" />
        <span className="nums font-mono text-[11.5px] text-ink-subtle">{diff.commit}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-muted">{diff.message}</span>
        <Bar additions={diff.additions} deletions={diff.deletions} />
      </div>

      <ul className="border-t border-rule-soft">
        {diff.files.map((file) => (
          <li
            key={file.path}
            className="flex items-center gap-3 px-4 py-2 first:pt-2.5 last:pb-2.5"
          >
            <Icon name="code" size={12} className="shrink-0 text-ink-subtle" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-muted">
              {file.path}
            </span>
            <Bar additions={file.additions} deletions={file.deletions} />
          </li>
        ))}
      </ul>
    </div>
  );
}
