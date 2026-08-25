import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Topbar } from '@/components/app/topbar';
import { PageBody } from '@/components/app/page-body';
import { AppPageHeader } from '@/components/app/page-header';
import { Panel } from '@/components/app/panel';
import { WorkPulse } from '@/components/app/work-pulse';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { buttonVariants } from '@/components/ui/button';
import { requireScope } from '@/lib/db/scope';
import { workDetail, workMark, type WorkEvent } from '@/lib/db/work';
import { resumeWork } from '@/lib/work/resume';
import { WORK } from '@/lib/work/where';
import { WORK_KIND, WORK_TONE, WORK_WORD, inFlight } from '@/lib/work/words';

/**
 * One job, said out loud.
 *
 * This is the transcript, and it is the reason the event log exists at all: the same
 * rows that let a job resume where it left off are the ones that answer *what is it
 * doing* -- so watching the agent read a codebase costs no machinery beyond what
 * resuming already needed.
 *
 * Read-only on purpose. There is no retry button and no cancel: a stalled job restarts
 * by being looked at, which is what `resumeWork` does on the way in, and a job that has
 * spent its attempts is finished being tried. Adding a button that means "do the thing
 * this page already did" would be a worse page.
 */

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await requireScope();
  const detail = await workDetail(scope.projectId, id);
  return { title: detail ? `${detail.label} · Work · GritQA` : 'Work not found · GritQA' };
}

/** The phases, in the order they happen, so the label reads as progress. */
const PHASE: Record<string, string> = {
  research: 'Reading',
  write: 'Writing',
  verify: 'Checking',
  save: 'Saving',
};

/**
 * One line of the transcript.
 *
 * A `failed` note is the only one that gets colour, because it is the only one that is
 * not simply the story continuing. `findings` gets its own treatment for a different
 * reason: it is the whole of what research concluded, which is paragraphs rather than a
 * line, and squeezing it onto one row would hide the most useful thing here.
 */
function Line({ event }: { event: WorkEvent }) {
  const failed = event.kind === 'failed';

  return (
    <li className="flex gap-3 px-3 py-2">
      <span className="nums w-14 shrink-0 pt-px font-mono text-[10.5px] text-ink-subtle">
        {PHASE[event.phase] ?? event.phase}
      </span>
      <span className="min-w-0 flex-1">
        {event.kind === 'findings' ? (
          <>
            <span className="mb-1 block text-[11px] font-medium text-ink-muted">
              What it found
            </span>
            <span className="block whitespace-pre-wrap text-[12px] leading-relaxed text-ink-muted">
              {event.label}
            </span>
          </>
        ) : (
          <span
            className={
              failed
                ? 'block text-[12.5px] leading-snug text-fail'
                : 'block text-[12.5px] leading-snug text-ink'
            }
          >
            {event.label}
          </span>
        )}
      </span>
      <span className="shrink-0 pt-px text-[10.5px] text-ink-subtle">{event.whenLabel}</span>
    </li>
  );
}

export default async function WorkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await requireScope();

  const detail = await workDetail(scope.projectId, id);
  /* Read through the scope, so a job belonging to another project is not found rather
     than refused -- the same answer every other detail page gives, and one that does
     not confirm the id exists. */
  if (!detail) notFound();

  /* Landing here directly on a stalled job should start it, not only tell you it
     stalled. Cheap: `unattendedWork` returns nothing when there is nothing to do. */
  resumeWork(scope.projectId);
  const mark = await workMark(scope.projectId);

  const live = inFlight(detail.status);

  return (
    <>
      <Topbar icon="terminal" title="Work" />
      <WorkPulse mark={mark} />

      <PageBody>
        <Link
          href={WORK}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          <Icon name="chevronRight" size={13} className="rotate-180" />
          All work
        </Link>

        <AppPageHeader
          className="mt-3"
          title={detail.label}
          description={`${WORK_KIND[detail.type]}, asked for ${detail.whenLabel}.`}
          action={
            <span className="flex items-center gap-2">
              <Badge variant={detail.status === 'completed' ? 'pass' : live ? 'running' : 'fail'}>
                <StatusDot tone={WORK_TONE[detail.status]} pulse={detail.status === 'claimed'} />
                {WORK_WORD[detail.status]}
              </Badge>
              {detail.href && (
                <Link href={detail.href} className={buttonVariants({ variant: 'primary', size: 'sm' })}>
                  Open it
                </Link>
              )}
            </span>
          }
        />

        {detail.error && (
          <p className="mt-4 rounded-lg border border-fail-soft bg-fail-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-fail">
            {detail.error}
          </p>
        )}

        {detail.stalled && (
          <p className="mt-4 rounded-lg border border-rule bg-app-panel px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-muted">
            Whoever was doing this stopped speaking, so opening this page has started it again.
            It picks up from what it had already read.
          </p>
        )}

        <Panel
          className="mt-5"
          title="What it did"
          subtitle={
            live
              ? 'Written as it happens — this page updates itself'
              : 'Every step, in the order it happened'
          }
          meta={
            <span className="nums shrink-0 font-mono text-[11.5px] text-ink-subtle">
              {detail.attempt > 1 ? `try ${detail.attempt}/${detail.maxAttempts}` : detail.publicId}
            </span>
          }
          bodyClassName="p-0"
        >
          {detail.events.length === 0 ? (
            <p className="px-3 py-4 text-[12.5px] text-ink-subtle">
              {live
                ? 'Nothing said yet. The first line lands as soon as it starts reading.'
                : 'This finished without saying anything, which means it failed before it began.'}
            </p>
          ) : (
            <ul className="divide-y divide-rule-soft">
              {detail.events.map((event) => (
                <Line key={event.publicId} event={event} />
              ))}
            </ul>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
