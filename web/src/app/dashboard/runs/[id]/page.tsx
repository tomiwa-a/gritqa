import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Topbar } from '@/components/app/topbar';
import { PageBody } from '@/components/app/page-body';
import { Panel } from '@/components/app/panel';
import { RunSteps } from '@/components/app/run-steps';
import { RunTriage } from '@/components/app/run-triage';
import { RunCells } from '@/components/app/run-cells';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { allPlans, currentProject } from '@/lib/mock/data';
import { RUN_TONE, RUN_WORD } from '@/lib/plan';
import { brokeAt, runRowFor, runsForPlan } from '@/lib/runs';
import { OverlayHost } from '@/components/app/overlay-host';
import { GenerateMenu } from '@/components/app/generate-menu';
import { planToken, runToken, withOverlay, type PageParams } from '@/lib/overlay';

const BADGE = {
  passed: 'pass',
  failed: 'fail',
  error: 'error',
  running: 'running',
  pending: 'skip',
} as const;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = runRowFor(id);
  return { title: run ? `${run.planName} run · GritQA` : 'Run not found · GritQA' };
}

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<PageParams>;
}) {
  const { id } = await params;
  const query = await searchParams;

  const run = runRowFor(id);
  if (!run) notFound();

  const plan = allPlans.find((p) => p.publicId === run.planPublicId);
  const detail = run.detail;
  const broke = brokeAt(run);
  const brokeIndex = detail && broke ? detail.steps.indexOf(broke) : -1;
  const cliConnected = currentProject.lastIndexedLabel !== null;

  const path = `/dashboard/runs/${run.publicId}`;
  const planHref = plan ? `/dashboard/test-plans/${plan.publicId}` : '/dashboard/test-plans';
  /* Leaves this report, because the conversation lives with the plan. */
  const refineHref = `${planHref}#ask`;
  const siblings = runsForPlan(run.planPublicId).filter((r) => r.publicId !== run.publicId);

  /* Checking the plan or a sibling run should not cost you this report. */
  const planPreviewHref = plan
    ? withOverlay(path, query, planToken(plan.publicId))
    : planHref;
  const openRun = (publicId: string) => withOverlay(path, query, runToken(publicId));

  return (
    <>
      <Topbar
        icon="runs"
        title={run.planName}
        action={
          <>
            <Link
              href="/dashboard/runs"
              className="flex h-8 items-center gap-1.5 rounded-md border border-rule bg-app-panel px-2.5 text-[12.5px] text-ink-muted transition-colors duration-150 hover:text-ink"
            >
              <Icon name="chevronRight" size={13} className="rotate-180" />
              All runs
            </Link>
            <GenerateMenu />
          </>
        }
      />

      <PageBody>
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={BADGE[run.status]} size="sm">
              <StatusDot tone={RUN_TONE[run.status]} pulse={run.status === 'running'} />
              {RUN_WORD[run.status]}
            </Badge>
            <Badge variant="outline" size="sm" mono className="nums bg-app-panel">
              {run.publicId}
            </Badge>
            <span className="nums text-[11.5px] text-ink-subtle">{run.whenLabel}</span>
            {detail?.durationMs && (
              <>
                <span aria-hidden className="text-ink-subtle">
                  ·
                </span>
                <span className="nums text-[11.5px] text-ink-subtle">
                  took {(detail.durationMs / 1000).toFixed(1)}s
                </span>
              </>
            )}
          </div>

          <h2 className="mt-2 text-[20px] leading-tight font-semibold tracking-[-0.02em] text-ink">
            {broke
              ? `Stopped on step ${brokeIndex + 1} of ${run.steps}`
              : run.status === 'running'
                ? 'Running now'
                : `All ${run.steps} steps passed`}
          </h2>

          <p className="mt-1 max-w-[68ch] text-[13.5px] leading-relaxed text-ink-muted">
            This run executed{' '}
            <Link
              href={planHref}
              className="font-medium text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
            >
              {run.planName.toLowerCase()}
            </Link>{' '}
            against your API on your machine. Each step below is one request, in the order it went
            out.
          </p>

          <p className="mt-3 flex flex-wrap items-center gap-3">
            <RunCells cells={run.cells} size="md" />
            <span className="nums text-[12.5px] text-ink-subtle">
              {run.passed} of {run.steps} steps passed
            </span>
          </p>
        </header>

        {broke && detail && (
          <Panel
            className="mt-5"
            title="What was that?"
            subtitle="The one call in this product a machine cannot make for you"
            meta={
              <Badge variant="outline" size="sm" mono className="bg-app-panel text-ink-subtle">
                schema gap
              </Badge>
            }
            bodyClassName="p-0"
          >
            <RunTriage
              step={broke}
              stepIndex={brokeIndex}
              planName={run.planName}
              refineHref={refineHref}
            />
          </Panel>
        )}

        {detail ? (
          <Panel
            className="mt-4"
            title="Step by step"
            subtitle="Open a step to see everything covering that endpoint"
            meta={
              <span className="nums shrink-0 font-mono text-[11.5px] text-ink-subtle">
                {detail.steps.length}
              </span>
            }
            bodyClassName="p-0"
          >
            <RunSteps steps={detail.steps} />
          </Panel>
        ) : (
          <Panel
            className="mt-4"
            title="Step by step"
            subtitle="What this run did, request by request"
            bodyClassName="p-4"
          >
            <p className="text-[13px] leading-relaxed text-ink-muted">
              This run is older than the reports kept on hand, so only its shape survives: {run.steps}{' '}
              steps, {run.passed} of them green.{' '}
              {broke
                ? 'Which step broke is recorded, but not what came back.'
                : 'Nothing failed in it.'}
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-subtle">
              Newer runs of the same plan carry the full request-by-request report.
            </p>
            {siblings[0] && (
              <Link
                href={openRun(siblings[0].publicId)}
                scroll={false}
                className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'mt-3' })}
              >
                <Icon name="runs" size={13} />
                Open the next run of this plan
              </Link>
            )}
          </Panel>
        )}

        <Panel
          className="mt-4"
          title="Where to go from here"
          subtitle="A run is evidence — the decision is somewhere else"
          bodyClassName="p-0"
        >
          <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
            <Button
              variant="primary"
              size="sm"
              disabled={!cliConnected}
              title={
                cliConnected
                  ? 'Ask your machine to run this plan again'
                  : 'Runs happen on your machine, and it is not connected right now'
              }
            >
              <Icon name="refresh" size={14} />
              Run it again
            </Button>

            <Link
              href={planPreviewHref}
              scroll={false}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              <Icon name="plan" size={14} />
              What it was testing
            </Link>

            <Link
              href={refineHref}
              title="Say what should change about the plan behind this run"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              <Icon name="sparkle" size={14} />
              Ask for a change
            </Link>

            <Link
              href={`/dashboard/runs?plan=${run.planPublicId}`}
              className="group ml-auto flex items-center gap-1.5 text-[12.5px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
            >
              Every run of this plan
              <span className="nums text-ink-subtle">{siblings.length + 1}</span>
              <Icon
                name="arrowRight"
                size={13}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </Link>
          </div>

          {!cliConnected && (
            <p className="border-t border-rule-soft px-4 py-2.5 text-[11.5px] text-ink-subtle">
              Running needs the CLI, because that is where your code is.
            </p>
          )}
        </Panel>
      </PageBody>

      <OverlayHost params={query} pathname={path} />
    </>
  );
}
