import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { Badge } from '@/components/ui/badge';
import type { PlanRevision } from '@/lib/mock/types';
import { cn } from '@/lib/cn';

function Turn({
  revision,
  author,
  diffHref,
}: {
  revision: PlanRevision;
  author: string;
  diffHref: string;
}) {
  const byYou = revision.author === 'you';
  const count = revision.changes.length;

  return (
    <li className="flex gap-3 border-b border-rule-soft px-4 py-4 last:border-b-0">
      <span
        className={cn(
          'mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-rule',
          byYou ? 'bg-app-active text-ink-muted' : 'bg-app-panel text-punch-red',
        )}
      >
        <Icon name={byYou ? 'user' : 'sparkle'} size={12} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[13px] font-medium text-ink">{byYou ? author : 'GritQA'}</span>
          <span className="text-[11.5px] text-ink-subtle">{revision.whenLabel}</span>
          <Badge variant="outline" size="sm" mono className="nums ml-auto bg-app-panel">
            v{revision.version}
          </Badge>
        </p>

        {revision.instruction ? (
          <blockquote className="mt-2 border-l-2 border-punch-red pl-3 text-[13px] leading-relaxed text-ink">
            {revision.instruction}
          </blockquote>
        ) : (
          <p className="mt-1.5 text-[12px] text-ink-subtle">
            {revision.version === 1 ? 'Drafted without being asked.' : 'Redrafted on its own.'}
          </p>
        )}

        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{revision.summary}</p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="nums text-[11.5px] text-ink-subtle">
            {count === 0 ? 'First version' : `${count} change${count === 1 ? '' : 's'}`}
          </span>
          <Link
            href={diffHref}
            className="group flex items-center gap-1 text-[12px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
          >
            <Icon name="diff" size={12} />
            See what changed
            <Icon
              name="arrowRight"
              size={11}
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </Link>
        </div>
      </div>
    </li>
  );
}

/** Newest first, so the version you are looking at explains itself first. */
export function RevisionThread({
  revisions,
  author,
  diffHrefFor,
  className,
}: {
  revisions: PlanRevision[];
  author: string;
  diffHrefFor: (version: number) => string;
  className?: string;
}) {
  return (
    <ol className={cn('flex flex-col', className)}>
      {[...revisions].reverse().map((revision) => (
        <Turn
          key={revision.version}
          revision={revision}
          author={author}
          diffHref={diffHrefFor(revision.version)}
        />
      ))}
    </ol>
  );
}
