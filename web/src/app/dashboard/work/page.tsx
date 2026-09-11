import Link from 'next/link';
import { Topbar } from '@/components/app/topbar';
import { PageBody } from '@/components/app/page-body';
import { AppPageHeader } from '@/components/app/page-header';
import { Panel } from '@/components/app/panel';
import { DataTable, type Column } from '@/components/app/data-table';
import { EmptyState } from '@/components/app/empty-state';
import { GenerateMenu } from '@/components/app/generate-menu';
import { WorkPulse } from '@/components/app/work-pulse';
import { OverlayHost } from '@/components/app/overlay-host';
import { type PageParams } from '@/lib/overlay';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { requireScope } from '@/lib/db/scope';
import { getCurrentProjectOrNull } from '@/lib/data';
import { NoProjectGate } from '@/components/app/no-project-gate';
import { listWork, workMark, type WorkRow } from '@/lib/db/work';
import { resumeWork } from '@/lib/work/resume';
import { WORK_KIND, WORK_TONE, WORK_WORD, inFlight } from '@/lib/work/words';

export const metadata = { title: 'Work · GritQA' };

/**
 * What the agent is doing, and what it did.
 *
 * The page the three composers now redirect to. Drafting, refining and answering all
 * used to happen inside the request that asked for them, which made closing the tab
 * destructive; they are queued work now, and this is where a developer watches it
 * without having to stay for it.
 *
 * Two panels rather than a filter, because the two halves are read differently. What
 * is in flight is being watched -- it changes under you, and the interesting column is
 * what the agent last said. What is finished is being looked up: did the thing arrive,
 * and where is it. A segmented control over one table would make you choose between
 * those instead of giving you both.
 */

/** What it last said, or why it stopped. The one column that changes while you look. */
function saying(row: WorkRow): React.ReactNode {
  if (row.error) return <span className="text-[12px] text-fail">{row.error}</span>;
  if (row.latest) return <span className="text-[12px] text-ink-muted">{row.latest}</span>;
  return (
    <span className="text-[12px] text-ink-subtle">
      {row.status === 'pending' ? 'Waiting to start' : '—'}
    </span>
  );
}

const columns: Column<WorkRow>[] = [
  {
    key: 'work',
    header: 'Work',
    cellClassName: 'max-w-[22rem]',
    cell: (row) => (
      <Link
        href={`/dashboard/work/${row.publicId}`}
        className="group flex min-w-0 items-center gap-2.5"
      >
        <StatusDot
          tone={WORK_TONE[row.status]}
          pulse={row.status === 'claimed'}
          label={WORK_WORD[row.status]}
        />
        <span className="min-w-0">
          <span className="block truncate text-[13px] text-ink group-hover:underline group-hover:decoration-rule-strong group-hover:underline-offset-2">
            {row.label}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-ink-subtle">
            {WORK_KIND[row.type]} · {row.whenLabel}
          </span>
        </span>
      </Link>
    ),
  },
  {
    key: 'saying',
    header: 'What is happening',
    cellClassName: 'max-w-[24rem]',
    cell: (row) => (
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate">{saying(row)}</span>
        {/* Stalled is not a status of its own -- the row is still `claimed` and still
            has attempts left. What it means is that whoever held it stopped speaking,
            and that reloading is what picks it up, so the row says exactly that. */}
        {row.stalled && (
          <span className="text-[11px] text-warn">
            Whoever was doing this stopped. Reload and it starts again.
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'attempt',
    header: 'Try',
    align: 'right',
    cell: (row) => (
      <span className="nums font-mono text-[11.5px] text-ink-subtle">
        {row.attempt > 1 ? `${row.attempt}/${row.maxAttempts}` : '—'}
      </span>
    ),
  },
  {
    key: 'open',
    header: 'Open',
    align: 'right',
    hideHeader: true,
    cell: (row) =>
      /* Only when there is something to open. A chevron on a queued row would promise
         a destination that does not exist yet. */
      row.href ? (
        <Link
          href={row.href}
          aria-label={`Open what "${row.label}" produced`}
          title="Open what it produced"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-subtle transition-colors duration-150 hover:bg-app-hover hover:text-ink"
        >
          <Icon name="chevronRight" size={14} />
        </Link>
      ) : (
        <span className="sr-only">Nothing to open yet</span>
      ),
  },
];

export default async function WorkPage({ searchParams }: { searchParams: Promise<PageParams> }) {
  const params = await searchParams;
  const project = await getCurrentProjectOrNull();
  if (!project) return <NoProjectGate icon="terminal" title="Work" />;
  const scope = await requireScope();

  /* Before the read, so a job that was abandoned is already being picked up by the
     time the developer has finished reading the row that says it stalled. */
  resumeWork(scope.projectId);

  const [rows, mark] = await Promise.all([listWork(scope.projectId), workMark(scope.projectId)]);
  const running = rows.filter((row) => inFlight(row.status));
  const earlier = rows.filter((row) => !inFlight(row.status));

  return (
    <>
      <Topbar icon="terminal" title="Work" action={<GenerateMenu />} />
      <WorkPulse mark={mark} />

      <PageBody>
        <AppPageHeader
          title="What GritQA is doing"
          description="Drafting a plan, writing a new version of one, or answering a question — each of those reads your code first, which takes a minute. It happens here instead of under the button you pressed, so closing the tab costs nothing."
          action={
            running.length > 0 ? (
              <Badge variant="running" size="sm">
                {running.length} on the go
              </Badge>
            ) : (
              <Badge variant="count" size="sm">
                Nothing running
              </Badge>
            )
          }
        />

        <Panel
          className="mt-5"
          title="On the go"
          subtitle="This updates itself — you do not need to reload"
          meta={
            <span className="nums shrink-0 font-mono text-[11.5px] text-ink-subtle">
              {running.length}
            </span>
          }
          bodyClassName="p-0"
        >
          <DataTable
            columns={columns}
            rows={running}
            rowKey={(row) => row.publicId}
            minWidth={720}
            empty={
              <EmptyState
                size="sm"
                icon="terminal"
                title="Nothing running"
                description="Ask for a plan, a new version of one, or an answer, and it appears here while it is being written."
              />
            }
          />
        </Panel>

        <Panel
          className="mt-4"
          title="Finished"
          subtitle="Newest first. Open a row to read what the agent did"
          meta={
            <span className="nums shrink-0 font-mono text-[11.5px] text-ink-subtle">
              {earlier.length}
            </span>
          }
          bodyClassName="p-0"
        >
          <DataTable
            columns={columns}
            rows={earlier}
            rowKey={(row) => row.publicId}
            minWidth={720}
            empty={
              <EmptyState
                size="sm"
                icon="clock"
                title="Nothing has finished yet"
                description="Work that lands — or that fails and says why — stays here so you can read it back."
              />
            }
          />
        </Panel>
      </PageBody>
      <OverlayHost params={params} pathname="/dashboard/work" />
    </>
  );
}
