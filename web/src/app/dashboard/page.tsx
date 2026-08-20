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
import { PipelineRail, type Stage } from '@/components/app/pipeline-rail';
import { ViewFilter, type ViewKey } from '@/components/app/view-filter';
import { OverlayHost } from '@/components/app/overlay-host';
import { Icon } from '@/components/ui/icon';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  getAllPlans,
  getCoverageTotals,
  getCurrentProject,
  getPeriod,
  getPlansAwaitingReview,
  getRecentRuns,
  getRunStripStats,
  type CoverageTotals,
  type Period,
  type RunStripStats,
} from '@/lib/data';
import type { Project, TestExecution, TestPlan } from '@/lib/mock/types';
import { cn } from '@/lib/cn';
import { planToken, runToken, withOverlay, type PageParams } from '@/lib/overlay';

export const metadata = { title: 'Overview · GritQA' };

const PATH = '/dashboard';

/**
 * One read feeds the whole page. Every shape below is derived from this bundle
 * rather than fetching for itself — once these come from Postgres, a helper that
 * read its own data would mean a query per section.
 */
type Overview = {
  allPlans: TestPlan[];
  coverageTotals: CoverageTotals;
  currentProject: Project;
  period: Period;
  plansAwaitingReview: TestPlan[];
  recentRuns: TestExecution[];
  runStripStats: RunStripStats;
};

type WorkItem = {
  id: string;
  kind: 'review' | 'failing';
  name: string;
  note: string;
  covers: string;
  signal: string;
  run: { total: number; passed: number } | null;
  cta: string;
  /** What the row opens, as an overlay token — the row never leaves this page. */
  token: string;
};

function failedRunsOf(d: Overview) {
  return d.recentRuns.filter((r) => r.status === 'failed');
}

const failingWorkOf = (d: Overview): WorkItem[] =>
  failedRunsOf(d).map((run) => {
    const broke = run.steps.find((s) => s.status === 'failed');
    return {
      id: run.publicId,
      kind: 'failing',
      name: run.planName,
      note: broke ? `Failed at "${broke.stepName}" · ${run.startedLabel}` : run.startedLabel,
      covers: `${run.steps.length} steps · ${new Set(run.steps.map((s) => s.path)).size} endpoints`,
      signal: broke ? `${broke.method} ${broke.responseStatus}` : '—',
      run: {
        total: run.steps.length,
        passed: run.steps.filter((s) => s.status === 'passed').length,
      },
      cta: 'Inspect',
      token: runToken(run.publicId),
    };
  });

const reviewWorkOf = (d: Overview): WorkItem[] =>
  d.plansAwaitingReview.map((plan) => ({
    id: plan.publicId,
    kind: 'review',
    name: plan.name,
    note: `${plan.triggerSource === 'git_push' ? 'Drafted from a push' : 'Started by hand'} · ${plan.createdLabel}`,
    covers: `${plan.stepCount} steps · ${plan.covers.length} endpoints`,
    signal: `${plan.assertionCount} checks`,
    run: plan.lastRun ? { total: plan.lastRun.total, passed: plan.lastRun.passed } : null,
    cta: 'Review',
    token: planToken(plan.publicId),
  }));

function workOf(d: Overview): Record<ViewKey, WorkItem[]> {
  const failing = failingWorkOf(d);
  const review = reviewWorkOf(d);
  return { all: [...failing, ...review], review, failing };
}

const SUBTITLE: Record<ViewKey, string> = {
  all: 'Failing runs first, then plans waiting on your approval',
  review: 'Plans waiting on your approval',
  failing: 'Runs that broke and have not been dealt with',
};

const workColumns = (hrefFor: (row: WorkItem) => string): Column<WorkItem>[] => [
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
      <Link
        href={hrefFor(row)}
        scroll={false}
        className={buttonVariants({ variant: 'secondary', size: 'xs' })}
      >
        {row.cta}
      </Link>
    ),
  },
];

/**
 * A shift, with its own sign and its own reading.
 *
 * The pass rate reads real executions now, so it can fall -- and a hardcoded `+`
 * rendered that as `+-1.7`. Whether a fall is bad depends on the metric, so the
 * caller says: a slower median run is an improvement, a lower pass rate is not.
 */
function shift(
  now: number,
  before: number,
  { decimals = 0, unit = '', betterWhen = 'up' as 'up' | 'down' },
): Pick<MetricCell, 'direction' | 'delta' | 'tone'> {
  const change = now - before;
  const size = Math.abs(change).toFixed(decimals);
  if (Number(size) === 0) {
    return { direction: 'flat', delta: `0${unit}`, tone: 'neutral' };
  }
  const up = change > 0;
  return {
    direction: up ? 'up' : 'down',
    // U+2212, not a hyphen: it lines up with the digits beside it.
    delta: `${up ? '+' : '\u2212'}${size}${unit}`,
    tone: up === (betterWhen === 'up') ? 'good' : 'bad',
  };
}

/**
 * Four numbers about the window, and each one's own previous.
 *
 * Three of them are measurements of a period and can be compared to the period before
 * it. The fourth is a state -- how much of the API has an approved plan today -- and
 * nothing records what that was a month ago: plans carry a status, not a history of
 * statuses. So it shows what is left to do instead of a delta it would have to invent.
 */
const metricCells = ({ coverageTotals, period }: Overview, generateHref: string): MetricCell[] => [
  {
    icon: 'check',
    label: 'Pass rate',
    value: `${period.passRate}%`,
    ...shift(Number(period.passRate), Number(period.passRatePrevious), { decimals: 1 }),
    comparison: `from ${period.passRatePrevious}%`,
    href: '/dashboard/runs',
  },
  {
    icon: 'runs',
    label: 'Runs',
    value: String(period.runs),
    ...shift(period.runs, period.runsPrevious, {}),
    comparison: `from ${period.runsPrevious}`,
    href: '/dashboard/runs',
  },
  {
    icon: 'clock',
    label: 'Median run',
    value: period.medianRun,
    /* A faster run is a better one, so a fall is the good direction here. */
    ...(period.medianRunSeconds !== null && period.medianRunPreviousSeconds !== null
      ? shift(period.medianRunSeconds, period.medianRunPreviousSeconds, {
          decimals: 1,
          unit: 's',
          betterWhen: 'down',
        })
      : {}),
    comparison: `from ${period.medianRunPrevious}`,
  },
  {
    icon: 'endpoint',
    label: 'Endpoints covered',
    value: String(coverageTotals.approved),
    unit: `/ ${coverageTotals.total}`,
    comparison: `${coverageTotals.none} with no plan yet`,
    href: generateHref,
  },
];

/* The five things that happen to a plan, in order, each one a place to stand. */
const stagesOf = (d: Overview): Stage[] => {
  const { allPlans, currentProject, period, plansAwaitingReview } = d;
  const approvedPlans = allPlans.filter((p) => p.status === 'approved').length;

  return [
    {
      key: 'read',
      icon: 'codebase',
      label: 'Read',
      value: String(currentProject.endpointCount),
      unit: 'endpoints',
      hint: `Found across ${currentProject.fileCount} files on your machine`,
      href: '/dashboard/test-plans?group=file',
    },
    {
      key: 'drafted',
      icon: 'sparkle',
      label: 'Drafted',
      value: String(plansAwaitingReview.length),
      unit: 'waiting',
      hint: 'Written for you, and stuck here until you read them',
      href: '/dashboard/queue',
      tone: 'warn',
    },
    {
      key: 'approved',
      icon: 'check',
      label: 'You approved',
      value: String(approvedPlans),
      unit: 'plans',
      hint: 'The only plans your machine is allowed to run',
      href: '/dashboard/test-plans?group=status',
    },
    {
      key: 'ran',
      icon: 'runs',
      label: 'Ran',
      value: String(period.runs),
      unit: 'runs',
      hint: `${period.steps} requests went out in the last ${period.days} days`,
      href: '/dashboard/runs',
    },
    {
      key: 'broke',
      icon: 'alert',
      label: 'Broke',
      value: String(failedRunsOf(d).length),
      unit: 'runs',
      hint: 'Each one is either a real bug or a bad test — your call',
      href: '/dashboard/runs?status=failed',
      tone: 'fail',
    },
  ];
};

const pad = (n: number) => String(n).padStart(2, '0');

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<PageParams>;
}) {
  const params = await searchParams;
  const [
    allPlans,
    coverageTotals,
    currentProject,
    period,
    plansAwaitingReview,
    recentRuns,
    runStripStats,
  ] = await Promise.all([
    getAllPlans(),
    getCoverageTotals(),
    getCurrentProject(),
    getPeriod(),
    getPlansAwaitingReview(),
    getRecentRuns(),
    getRunStripStats(),
  ]);
  const overview: Overview = {
    allPlans,
    coverageTotals,
    currentProject,
    period,
    plansAwaitingReview,
    recentRuns,
    runStripStats,
  };

  const failedRuns = failedRunsOf(overview);
  const work = workOf(overview);
  const freshPush = plansAwaitingReview.filter((p) => p.createdLabel.endsWith('h ago')).length;
  const newestBreak = failedRuns[0]?.steps.find((s) => s.status === 'failed');

  const view = typeof params.view === 'string' ? params.view : undefined;
  const active: ViewKey = view === 'review' || view === 'failing' ? view : 'all';
  const rows = work[active];

  /* Everything on this page opens over it, so the work list and the filter stay put. */
  const open = (token: string) => withOverlay(PATH, params, token);
  const generateHref = withOverlay(PATH, params, 'generate', {
    from: 'endpoints',
    g: 'scope',
  });

  return (
    <>
      <Topbar icon="overview" title="Overview" action={<GenerateMenu />} />

      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 items-center gap-1.5 rounded-md border border-rule bg-app-panel px-2.5 text-[12.5px] text-ink-muted">
              <Icon name="calendar" size={13} className="text-ink-subtle" />
              Last {period.days} days
            </span>
            <span className="hidden font-mono text-[11.5px] text-ink-subtle sm:inline">
              {currentProject.name} · {currentProject.defaultBranch}
            </span>
          </div>

          <ViewFilter
            active={active}
            counts={{
              all: work.all.length,
              review: work.review.length,
              failing: work.failing.length,
            }}
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

        <Panel
          className="mt-4"
          title="How your tests get made"
          subtitle="Each stage hands to the next, and one of them is you"
          bodyClassName="p-0"
        >
          <PipelineRail stages={stagesOf(overview)} />
        </Panel>

        <div className="mt-4">
          <MetricRail cells={metricCells(overview, generateHref)} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Panel
            className="xl:col-span-7"
            title="Coverage by file"
            subtitle="One square per endpoint the CLI found"
            link={{ href: generateHref, label: 'Cover a gap' }}
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
            link={{ href: '/dashboard/runs', label: 'All runs' }}
          >
            <RunMatrix hrefFor={(id) => open(runToken(id))} />

            <div className="mt-4 border-t border-rule-soft pt-4">
              <p className="mb-3 text-[10.5px] tracking-[0.06em] text-ink-subtle uppercase">
                Pass rate by plan
              </p>
              <PlanRates hrefFor={(id) => open(planToken(id))} />
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
            columns={workColumns((row) => open(row.token))}
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
            <RunList runs={recentRuns} hrefFor={(id) => open(runToken(id))} />
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

      <OverlayHost params={params} pathname={PATH} />
    </>
  );
}
