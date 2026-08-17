import Link from 'next/link';
import { Topbar } from '@/components/app/topbar';
import { PageBody } from '@/components/app/page-body';
import { GenerateMenu } from '@/components/app/generate-menu';
import { ActionCard } from '@/components/app/action-card';
import { MetricRail, type MetricCell } from '@/components/app/metric-rail';
import { Panel } from '@/components/app/panel';
import { CoverageGrid } from '@/components/app/coverage-grid';
import { RunMatrix } from '@/components/app/run-matrix';
import { PlanRates } from '@/components/app/plan-rates';
import { DataTable, type Column } from '@/components/app/data-table';
import { Meter } from '@/components/app/meter';
import { RunList } from '@/components/app/run-list';
import { RulesSummary } from '@/components/app/rules-summary';
import { EmptyState } from '@/components/app/empty-state';
import { ViewFilter, type ViewKey } from '@/components/app/view-filter';
import { Icon } from '@/components/ui/icon';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  coverageTotals,
  currentProject,
  period,
  plansAwaitingReview,
  recentRuns,
  runStripStats,
} from '@/lib/mock/data';
import { cn } from '@/lib/cn';

export const metadata = { title: 'Overview · GritQA' };

type WorkItem = {
  id: string;
  kind: 'review' | 'failing';
  name: string;
  note: string;
  covers: string;
  signal: string;
  run: { total: number; passed: number } | null;
  cta: string;
  href: string;
};

const failedRuns = recentRuns.filter((r) => r.status === 'failed');

const failingWork: WorkItem[] = failedRuns.map((run) => {
  const broke = run.steps.find((s) => s.status === 'failed');
  return {
    id: run.publicId,
    kind: 'failing',
    name: run.planName,
    note: broke ? `Failed at "${broke.stepName}" · ${run.startedLabel}` : run.startedLabel,
    covers: `${run.steps.length} steps · ${new Set(run.steps.map((s) => s.path)).size} endpoints`,
    signal: broke ? `${broke.method} ${broke.responseStatus}` : '—',
    run: { total: run.steps.length, passed: run.steps.filter((s) => s.status === 'passed').length },
    cta: 'Inspect',
    href: '/dashboard/runs',
  };
});

const reviewWork: WorkItem[] = plansAwaitingReview.map((plan) => ({
  id: plan.publicId,
  kind: 'review',
  name: plan.name,
  note: `${plan.triggerSource === 'git_push' ? 'Drafted from a push' : 'Started by hand'} · ${plan.createdLabel}`,
  covers: `${plan.stepCount} steps · ${plan.covers.length} endpoints`,
  signal: `${plan.assertionCount} checks`,
  run: plan.lastRun ? { total: plan.lastRun.total, passed: plan.lastRun.passed } : null,
  cta: 'Review',
  href: `/dashboard/queue?plan=${plan.publicId}`,
}));

const WORK: Record<ViewKey, WorkItem[]> = {
  all: [...failingWork, ...reviewWork],
  review: reviewWork,
  failing: failingWork,
};

const SUBTITLE: Record<ViewKey, string> = {
  all: 'Failing runs first, then plans waiting on your approval',
  review: 'Plans waiting on your approval',
  failing: 'Runs that broke and have not been dealt with',
};

const columns: Column<WorkItem>[] = [
  {
    key: 'name',
    header: 'Item',
    cell: (row) => (
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={cn(
            'mt-[5px] h-2 w-2 shrink-0 rounded-full',
            row.kind === 'failing' ? 'bg-fail' : 'bg-warn',
          )}
        />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-ink">{row.name}</span>
          <span className="block truncate text-[11.5px] text-ink-subtle">{row.note}</span>
        </span>
      </div>
    ),
  },
  {
    key: 'covers',
    header: 'What it covers',
    cell: (row) => <span className="nums text-[12.5px] text-ink-muted">{row.covers}</span>,
  },
  {
    key: 'signal',
    header: 'Checks',
    align: 'right',
    cell: (row) => (
      <span
        className={cn(
          'nums text-[12.5px]',
          row.kind === 'failing' ? 'font-medium text-fail' : 'text-ink-muted',
        )}
      >
        {row.signal}
      </span>
    ),
  },
  {
    key: 'run',
    header: 'Last run',
    cell: (row) =>
      row.run ? (
        <Meter total={row.run.total} passed={row.run.passed} />
      ) : (
        <span className="text-[12.5px] text-ink-subtle">Never run</span>
      ),
  },
  {
    key: 'action',
    header: 'Action',
    align: 'right',
    hideHeader: true,
    cell: (row) => (
      <Link href={row.href} className={buttonVariants({ variant: 'secondary', size: 'xs' })}>
        {row.cta}
      </Link>
    ),
  },
];

const passRateDelta = (
  Number(runStripStats.passRate) - Number(period.passRatePrevious)
).toFixed(1);

const metrics: MetricCell[] = [
  {
    icon: 'check',
    label: 'Pass rate',
    value: `${runStripStats.passRate}%`,
    direction: 'up',
    delta: `+${passRateDelta}`,
    tone: 'good',
    comparison: `from ${period.passRatePrevious}%`,
  },
  {
    icon: 'runs',
    label: 'Runs',
    value: String(period.runs),
    direction: 'up',
    delta: `+${period.runs - period.runsPrevious}`,
    tone: 'good',
    comparison: `from ${period.runsPrevious}`,
  },
  {
    icon: 'clock',
    label: 'Median run',
    value: period.medianRun,
    direction: 'down',
    delta: '−0.4s',
    tone: 'good',
    comparison: `from ${period.medianRunPrevious}`,
  },
  {
    icon: 'endpoint',
    label: 'Endpoints covered',
    value: String(coverageTotals.approved),
    unit: `/ ${coverageTotals.total}`,
    direction: 'up',
    delta: `+${coverageTotals.approved - period.endpointsCoveredPrevious}`,
    tone: 'good',
    comparison: `from ${period.endpointsCoveredPrevious}`,
  },
];

const freshPush = plansAwaitingReview.filter((p) => p.createdLabel.endsWith('h ago')).length;
const newestBreak = failedRuns[0]?.steps.find((s) => s.status === 'failed');
const pad = (n: number) => String(n).padStart(2, '0');

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const active: ViewKey = view === 'review' || view === 'failing' ? view : 'all';
  const rows = WORK[active];

  return (
    <>
      <Topbar icon="overview" title="Overview" action={<GenerateMenu />} />

      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 items-center gap-1.5 rounded-md border border-rule bg-app-panel px-2.5 text-[12.5px] text-ink-muted">
              <Icon name="calendar" size={13} className="text-ink-subtle" />
              Last 30 days
            </span>
            <span className="hidden font-mono text-[11.5px] text-ink-subtle sm:inline">
              {currentProject.name} · {currentProject.defaultBranch}
            </span>
          </div>

          <ViewFilter
            active={active}
            counts={{ all: WORK.all.length, review: reviewWork.length, failing: failingWork.length }}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <ActionCard
            icon="queue"
            tone="warn"
            label="Plans waiting for you"
            value={pad(plansAwaitingReview.length)}
            unit="plans"
            hint={`${freshPush} of them were drafted from today's pushes`}
            hintIcon="sparkle"
            cta="Open review queue"
            href="/dashboard/queue"
            emphasis
          />

          <ActionCard
            icon="alert"
            tone="fail"
            label="Runs that failed"
            value={pad(failedRuns.length)}
            unit="runs"
            hint={
              newestBreak
                ? `Newest: ${newestBreak.stepName} returned ${newestBreak.responseStatus}`
                : 'Nothing broken right now'
            }
            hintIcon="clock"
            cta="See what broke"
            href="/dashboard?view=failing#work"
          />

          {currentProject.lastIndexedLabel ? (
            <ActionCard
              icon="codebase"
              tone="pass"
              label="Codebase read"
              value={currentProject.lastIndexedLabel.replace(' ago', '')}
              unit="ago"
              hint={`${currentProject.fileCount} files · ${currentProject.endpointCount} endpoints tracked`}
              hintIcon="terminal"
              cta="See what's indexed"
              href="/dashboard/codebase"
            />
          ) : (
            <ActionCard
              icon="terminal"
              tone="info"
              label="Codebase read"
              value="—"
              hint="Run gritqa once in your project and this fills in"
              hintIcon="terminal"
              cta="Set up the CLI"
              href="/dashboard/setup"
            />
          )}
        </div>

        <div className="mt-4">
          <MetricRail cells={metrics} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Panel
            className="xl:col-span-7"
            title="Coverage by file"
            subtitle="One square per endpoint the CLI found"
            link={{ href: '/dashboard/codebase', label: 'Browse codebase' }}
          >
            <CoverageGrid />
          </Panel>

          <Panel
            className="xl:col-span-5"
            title="Last 30 runs"
            subtitle="Every step, newest on the right"
            meta={
              <Badge variant="pass" size="sm" className="nums">
                {runStripStats.passRate}% pass
              </Badge>
            }
          >
            <RunMatrix />

            <div className="mt-4 border-t border-rule-soft pt-4">
              <p className="mb-3 text-[10.5px] tracking-[0.06em] text-ink-subtle uppercase">
                Pass rate by plan
              </p>
              <PlanRates />
            </div>
          </Panel>
        </div>

        <Panel
          id="work"
          className="mt-4 scroll-mt-20"
          title="Your work list"
          subtitle={SUBTITLE[active]}
          meta={
            <span className="nums text-[12px] text-ink-subtle">
              {rows.length} {rows.length === 1 ? 'item' : 'items'}
            </span>
          }
          bodyClassName="p-0"
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            empty={
              <EmptyState
                size="sm"
                icon="check"
                title="Nothing waiting on you"
                description="Every plan is approved and every run is green. Push some code and GritQA will find the next thing."
              />
            }
          />
        </Panel>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Panel
            className="xl:col-span-7"
            title="Recent runs"
            subtitle="What executed most recently"
            link={{ href: '/dashboard/runs', label: 'All runs' }}
            bodyClassName="p-0"
          >
            <RunList runs={recentRuns} />
          </Panel>

          <Panel
            className="xl:col-span-5"
            title="Rules in effect"
            subtitle="What every drafted plan has to respect"
            link={{ href: '/dashboard/rules', label: 'Edit rules' }}
            bodyClassName="p-0"
          >
            <RulesSummary />
          </Panel>
        </div>
      </PageBody>
    </>
  );
}
