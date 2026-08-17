import Link from 'next/link';
import { Topbar } from '@/components/app/topbar';
import { PageBody } from '@/components/app/page-body';
import { AppPageHeader } from '@/components/app/page-header';
import { Panel } from '@/components/app/panel';
import { DataTable, type Column } from '@/components/app/data-table';
import { RunMatrix } from '@/components/app/run-matrix';
import { RunCells } from '@/components/app/run-cells';
import { GenerateMenu } from '@/components/app/generate-menu';
import { EmptyState } from '@/components/app/empty-state';
import { OverlayHost } from '@/components/app/overlay-host';
import { Segmented } from '@/components/ui/segmented';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { MethodBadge } from '@/components/ui/method-badge';
import { allPlans, runStripStats } from '@/lib/mock/data';
import { RUN_TONE, RUN_WORD } from '@/lib/plan';
import { brokeAt, matchesStatus, runCounts, runRows, type RunRow } from '@/lib/runs';
import { runToken, withOverlay, type PageParams } from '@/lib/overlay';

export const metadata = { title: 'Runs · GritQA' };

const PATH = '/dashboard/runs';

const FILTERS = ['all', 'failed', 'passed', 'running'] as const;
type Filter = (typeof FILTERS)[number];

function isFilter(value: string | undefined): value is Filter {
  return FILTERS.some((f) => f === value);
}

/** The name opens a preview over the list; the chevron leaves for the full report. */
const runColumns = (openRun: (publicId: string) => string): Column<RunRow>[] => [
  {
    key: 'plan',
    header: 'Run',
    cell: (run) => (
      <Link
        href={openRun(run.publicId)}
        scroll={false}
        className="group flex min-w-0 items-center gap-2.5"
      >
        <StatusDot
          tone={RUN_TONE[run.status]}
          pulse={run.status === 'running'}
          label={RUN_WORD[run.status]}
        />
        <span className="min-w-0">
          <span className="block truncate text-[13px] text-ink group-hover:underline group-hover:decoration-rule-strong group-hover:underline-offset-2">
            {run.planName}
          </span>
          <span className="nums mt-0.5 block font-mono text-[11px] text-ink-subtle">
            {run.publicId} · {run.whenLabel}
          </span>
        </span>
      </Link>
    ),
  },
  {
    key: 'steps',
    header: 'Steps',
    cell: (run) => (
      <span className="flex items-center gap-2.5">
        <RunCells cells={run.cells} />
        <span className="nums hidden text-[11.5px] text-ink-subtle lg:inline">
          {run.passed}/{run.steps}
        </span>
      </span>
    ),
  },
  {
    key: 'broke',
    header: 'Where it stopped',
    cellClassName: 'max-w-[15rem]',
    cell: (run) => {
      const broke = brokeAt(run);
      if (broke) {
        return (
          <span className="flex min-w-0 items-center gap-2">
            <MethodBadge method={broke.method} className="h-[15px] w-[46px] text-[9px]" />
            <span className="truncate font-mono text-[11.5px] text-ink-muted">{broke.path}</span>
            <span className="nums shrink-0 text-[11.5px] font-medium text-fail">
              {broke.responseStatus}
            </span>
          </span>
        );
      }
      return (
        <span className="text-[12px] text-ink-subtle">
          {run.status === 'running' ? 'Still going' : run.status === 'failed' ? 'A step failed' : 'Ran clean'}
        </span>
      );
    },
  },
  {
    key: 'took',
    header: 'Took',
    align: 'right',
    cell: (run) => (
      <span className="nums font-mono text-[12px] text-ink-muted">
        {run.detail?.durationMs ? `${(run.detail.durationMs / 1000).toFixed(1)}s` : '—'}
      </span>
    ),
  },
  {
    key: 'action',
    header: 'Open',
    align: 'right',
    hideHeader: true,
    cell: (run) => (
      <Link
        href={`/dashboard/runs/${run.publicId}`}
        aria-label={`Open the full report for ${run.planName}, run ${run.publicId}`}
        title="Open the full report"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-subtle transition-colors duration-150 hover:bg-app-hover hover:text-ink"
      >
        <Icon name="chevronRight" size={14} />
      </Link>
    ),
  },
];

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<PageParams>;
}) {
  const params = await searchParams;
  const statusParam = typeof params.status === 'string' ? params.status : undefined;
  const planParam = typeof params.plan === 'string' ? params.plan : undefined;
  const filter: Filter = isFilter(statusParam) ? statusParam : 'all';
  const openRun = (publicId: string) => withOverlay(PATH, params, runToken(publicId));

  const plan = planParam ? allPlans.find((p) => p.publicId === planParam) : undefined;
  const scoped = plan ? runRows.filter((r) => r.planPublicId === plan.publicId) : runRows;
  const rows = scoped.filter((r) => matchesStatus(r, filter));

  const base = plan ? `/dashboard/runs?plan=${plan.publicId}` : '/dashboard/runs';
  const hrefFor = (next: Filter) =>
    next === 'all' ? base : `${base}${plan ? '&' : '?'}status=${next}`;

  return (
    <>
      <Topbar icon="runs" title="Runs" action={<GenerateMenu />} />

      <PageBody>
        <AppPageHeader
          title={plan ? `Runs of ${plan.name.toLowerCase()}` : 'Every run, newest first'}
          description="A run is one approved plan executed against your API on your machine. The step that stopped it is named here instead of buried in a log."
          action={
            <Badge variant="pass" size="sm" className="nums">
              {runStripStats.passRate}% of steps passed
            </Badge>
          }
        />

        {plan && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-subtle">
            Scoped to one plan.
            <Link
              href={`/dashboard/test-plans/${plan.publicId}`}
              className="font-medium text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
            >
              Open the plan
            </Link>
            <span aria-hidden>·</span>
            <Link
              href="/dashboard/runs"
              className="font-medium text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
            >
              See all runs
            </Link>
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
            <Segmented
              className="w-max"
              label="Which runs to show"
              active={filter}
              options={[
                { key: 'all', label: 'All', href: hrefFor('all'), count: runCounts.all },
                {
                  key: 'failed',
                  label: 'Failed',
                  href: hrefFor('failed'),
                  dot: 'bg-fail',
                  count: runCounts.failed,
                },
                {
                  key: 'passed',
                  label: 'Passed',
                  href: hrefFor('passed'),
                  dot: 'bg-pass',
                  count: runCounts.passed,
                },
                {
                  key: 'running',
                  label: 'Running',
                  href: hrefFor('running'),
                  dot: 'bg-info',
                  count: runCounts.running,
                },
              ]}
            />
          </div>

          <p className="nums shrink-0 text-[12.5px] text-ink-subtle">
            {rows.length} of {scoped.length} runs
          </p>
        </div>

        {!plan && (
          <Panel
            className="mt-4"
            title="Last 30 runs"
            subtitle="Every step, newest on the right"
            link={{ href: '/dashboard/test-plans?group=status', label: 'What gets run' }}
          >
            <RunMatrix hrefFor={openRun} />
          </Panel>
        )}

        <Panel
          className="mt-4"
          title="The history"
          subtitle="Open a run to read it step by step"
          meta={
            <span className="nums shrink-0 font-mono text-[11.5px] text-ink-subtle">
              {rows.length}
            </span>
          }
          bodyClassName="p-0"
        >
          <DataTable
            columns={runColumns(openRun)}
            rows={rows}
            rowKey={(run) => run.publicId}
            minWidth={780}
            empty={
              <EmptyState
                size="sm"
                icon="runs"
                title="No runs match this"
                description="Nothing in the last 30 days fits that filter. Try All, or approve a plan and ask your machine to run it."
              />
            }
          />
        </Panel>
      </PageBody>

      <OverlayHost params={params} pathname={PATH} />
    </>
  );
}
