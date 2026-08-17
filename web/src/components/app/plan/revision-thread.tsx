import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { Badge } from '@/components/ui/badge';
import type { PlanRevision, TestPlan } from '@/lib/mock/types';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

/** One side of the exchange: who spoke, when, and what they said. */
export function TurnRow({
  who,
  whenLabel,
  mine,
  meta,
  children,
  divide,
}: {
  who: string;
  whenLabel: string;
  /** Your turns get the neutral disc; GritQA's get the accent. */
  mine: boolean;
  meta?: ReactNode;
  children: ReactNode;
  divide?: boolean;
}) {
  return (
    <li className={cn('flex gap-3 px-4 py-3.5', divide && 'border-b border-rule-soft')}>
      <span
        className={cn(
          'mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-rule',
          mine ? 'bg-app-active text-ink-muted' : 'bg-app-panel text-punch-red',
        )}
      >
        <Icon name={mine ? 'user' : 'sparkle'} size={12} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[13px] font-medium text-ink">{who}</span>
          <span className="text-[11.5px] text-ink-subtle">{whenLabel}</span>
          {meta && <span className="ml-auto flex shrink-0 items-center gap-1.5">{meta}</span>}
        </p>
        {children}
      </div>
    </li>
  );
}

/**
 * A version is two turns, because that is what it records: what you asked for,
 * and what GritQA did about it. A version nobody asked for is just the second.
 */
function Version({
  revision,
  author,
  trigger,
  diffHref,
  current,
  divide,
}: {
  revision: PlanRevision;
  author: string;
  /** Only read for a first version nobody asked for, to say where it came from. */
  trigger: TestPlan['triggerSource'];
  diffHref: string;
  /** The version on screen right now, so the thread joins up with the plan. */
  current: boolean;
  divide: boolean;
}) {
  const count = revision.changes.length;
  const asked = Boolean(revision.instruction);

  return (
    <>
      {asked && (
        <TurnRow
          who={revision.author === 'you' ? author : revision.author}
          whenLabel={revision.whenLabel}
          mine
        >
          <blockquote className="mt-2 border-l-2 border-punch-red pl-3 text-[13px] leading-relaxed text-ink">
            {revision.instruction}
          </blockquote>
        </TurnRow>
      )}

      <TurnRow
        who="GritQA"
        whenLabel={revision.whenLabel}
        mine={false}
        divide={divide}
        meta={
          <>
            <Badge
              variant="outline"
              size="sm"
              mono
              className={cn(
                'nums bg-app-panel',
                current && 'border-punch-red/40 text-punch-red',
              )}
            >
              v{revision.version}
            </Badge>
            {current && (
              <span className="text-[11px] whitespace-nowrap text-punch-red">
                What you&rsquo;re reading
              </span>
            )}
          </>
        }
      >
        {/* Says why there is no ask above it. The summary covers where it came from. */}
        {!asked && (
          <p className="mt-1.5 text-[12px] text-ink-subtle">
            {revision.version > 1
              ? 'Redrafted on its own.'
              : trigger === 'git_push'
                ? 'Drafted without being asked.'
                : 'What you asked for was not kept.'}
          </p>
        )}

        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{revision.summary}</p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="nums text-[11.5px] text-ink-subtle">
            {count === 0 ? 'First version' : `${count} change${count === 1 ? '' : 's'}`}
          </span>
          {/* Nothing to compare a first version against, so no door to a dead end. */}
          {count > 0 && (
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
          )}
        </div>
      </TurnRow>
    </>
  );
}

/**
 * Oldest first, because the next thing said goes at the bottom — the composer
 * underneath this is the next turn, not a separate tool.
 */
export function RevisionThread({
  revisions,
  author,
  trigger,
  diffHrefFor,
  currentVersion,
  className,
}: {
  revisions: PlanRevision[];
  author: string;
  trigger: TestPlan['triggerSource'];
  diffHrefFor: (version: number) => string;
  currentVersion: number;
  className?: string;
}) {
  const ordered = [...revisions].sort((a, b) => a.version - b.version);

  return (
    <ol className={cn('flex flex-col', className)}>
      {ordered.map((revision, i) => (
        <Version
          key={revision.version}
          revision={revision}
          author={author}
          trigger={trigger}
          diffHref={diffHrefFor(revision.version)}
          current={revision.version === currentVersion}
          divide={i < ordered.length - 1}
        />
      ))}
    </ol>
  );
}
