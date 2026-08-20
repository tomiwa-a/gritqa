import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { churnOf, isInRange } from '@/lib/commits';
import type { Commit } from '@/lib/model';

/**
 * The project's history, newest first. Picking a row means "draft from here" —
 * that commit and everything above it. Older commits stay visible but dim, so
 * you can see what you are leaving out.
 */
export function CommitHistory({
  commits,
  all,
  from,
  hrefFor,
}: {
  /** What to show — already filtered by the search box. */
  commits: Commit[];
  /** The full history, so range membership survives a filtered view. */
  all: Commit[];
  from: string;
  hrefFor: (hash: string) => string;
}) {
  if (commits.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-[12.5px] text-ink-subtle">
        No commit matches that. Try a shorter hash, or a word from the message.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-rule-soft">
      {commits.map((commit) => {
        const inRange = isInRange(all, from, commit);
        const isStart = commit.shortHash === from || commit.hash === from;
        const churn = churnOf(commit);

        return (
          <li key={commit.hash}>
            <Link
              href={hrefFor(commit.shortHash)}
              aria-current={isStart ? 'true' : undefined}
              className={cn(
                'flex items-start gap-3 border-l-2 py-2.5 pr-4 pl-[14px] transition-colors duration-150',
                isStart ? 'border-punch-red bg-app-active' : 'border-transparent hover:bg-app-hover',
              )}
            >
              <span
                className={cn(
                  'nums mt-px shrink-0 font-mono text-[11.5px]',
                  inRange ? 'text-ink' : 'text-ink-subtle',
                )}
              >
                {commit.shortHash}
              </span>

              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-[12.5px]',
                    inRange ? 'text-ink' : 'text-ink-subtle',
                  )}
                >
                  {commit.subject}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-subtle">
                  <span className="truncate">{commit.author}</span>
                  <span aria-hidden="true">·</span>
                  <span className="nums shrink-0">{commit.whenLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span className="nums shrink-0">
                    {commit.files.length} {commit.files.length === 1 ? 'file' : 'files'}
                  </span>
                </span>
              </span>

              <span
                className={cn(
                  'nums mt-px flex shrink-0 items-center gap-1.5 font-mono text-[11px]',
                  !inRange && 'opacity-45',
                )}
              >
                <span className="text-pass">+{churn.additions}</span>
                <span className="text-fail">&minus;{churn.deletions}</span>
              </span>

              {isStart && (
                <Icon name="check" size={13} className="mt-px shrink-0 text-punch-red" />
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
