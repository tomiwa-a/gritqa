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
import { runPlanAction } from '@/lib/actions/plans';
import { getAllPlans, isCliConnected, getRecentRuns, getRunHistory } from '@/lib/data';
import { kindPhrase, kindsIn, RUN_TONE, RUN_WORD } from '@/lib/plan';
import {
  brokeAt,
  isSettled,
  runOutcome,
  runRowFor,
  runRowsOf,
  runsForPlan,
  stoppedAt,
} from '@/lib/runs';
import { OverlayHost } from '@/components/app/overlay-host';
import { GenerateMenu } from '@/components/app/generate-menu';
import { refineToken, planToken, runToken, withOverlay, type PageParams } from '@/lib/overlay';

const BADGE = {
  passed: 'pass',
  failed: 'fail',
  error: 'error',
  running: 'running',
  pending: 'skip',
} as const;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = runRowsOf(await getRunHistory(), await getRecentRuns());
  const run = runRowFor(rows, id);
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

  const [allPlans, cliConnected, history, recent] = await Promise.all([
    getAllPlans(),
    isCliConnected(),
    getRunHistory(),
    getRecentRuns(),
  ]);
  const rows = runRowsOf(history, recent);

  const run = runRowFor(rows, id);
  if (!run) notFound();

  const plan = allPlans.find((p) => p.publicId === run.planPublicId);
  const detail = run.detail;
  const broke = brokeAt(run);
  const brokeIndex = stoppedAt(run);
  /* Queued or running: asked for, and with nothing to report yet. Every readout
     below that describes what a run *did* has to say what it will do instead. */
  const inFlight = !isSettled(run.status);
  /* Settled with nothing to show for itself. Reachable since runs became real: a
     machine that stops reporting is reaped into `error`, and its run made no
     request at all. Every sentence about what this run *did* has to give way. */
  const stepless = !inFlight && run.steps === 0;

  const standfirstLead =
    run.status === 'pending'
      ? 'This run will execute '
      : stepless
        ? 'This run was going to execute '
        : 'This run executed ';

  /* What follows the plan name depends on whether there is anything below to point
     at -- "each step below" pointing at an empty panel is the same lie in prose.
     And on what the steps are: a run whose evidence is a query and a fixture command
     is not one request each, which is what this sentence used to promise. */
  const standfirstTail =
    run.steps > 0
      ? `Each step below is ${kindPhrase(kindsIn(detail?.steps ?? []))}, in the order it ran.`
      : run.status === 'pending'
        ? 'Your machine picks it up on its next check, and the steps appear here as they run.'
        : run.status === 'running'
          ? 'Your machine has it now, and each step appears below as it finishes.'
          : 'It stopped before the first step ran.';

  const path = `/dashboard/runs/${run.publicId}`;
  const planHref = plan ? `/dashboard/test-plans/${plan.publicId}` : '/dashboard/test-plans';
  /* The conversation is about the plan, but it opens here — the evidence for
     what you want changed is on this page. */
  const refineHref = withOverlay(path, query, refineToken(run.planPublicId));
  const siblings = runsForPlan(rows, run.planPublicId).filter((r) => r.publicId !== run.publicId);

  /* Checking the plan or a sibling run should not cost you this report. */
  const planPreviewHref = plan ? withOverlay(path, query, planToken(plan.publicId)) : planHref;
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
            {runOutcome(run)}
          </h2>

          <p className="mt-1 max-w-[68ch] text-[13.5px] leading-relaxed text-ink-muted">
            {standfirstLead}
            <Link
              href={planHref}
              className="font-medium text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
            >
              {run.planName.toLowerCase()}
            </Link>{' '}
            against your API on your machine. {standfirstTail}
          </p>

          {/* No steps, no strip and no tally. The guard is on the cells rather than on
              `pending`, because a run reaped after its machine went quiet is settled
              and has none either -- and an empty strip beside "0 of 0 steps passed"
              reads as a run that did nothing rather than one that never began. */}
          {run.steps > 0 && (
            <p className="mt-3 flex flex-wrap items-center gap-3">
              <RunCells cells={run.cells} size="md" />
              <span className="nums text-[12.5px] text-ink-subtle">
                {run.passed} of {run.steps} steps passed
              </span>
            </p>
          )}

          {/* Why the run ended the way it did, when its steps do not explain it: a run
              whose machine went quiet mid-way has green steps and no failure to point
              at, and the status badge alone does not say what happened. Left out when
              there are no steps, because the panel below carries it there instead of
              saying the same sentence twice. */}
          {run.errorMessage && run.steps > 0 && (
            <p className="mt-3 max-w-[68ch] rounded-md border border-fail/25 bg-fail/[0.04] px-3 py-2 text-[12.5px] leading-relaxed text-ink-muted">
              {run.errorMessage}
            </p>
          )}
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

        {run.steps === 0 ? (
          <Panel
            className="mt-4"
            title="Step by step"
            subtitle={stepless ? 'Nothing ran' : 'Filled in as your machine works through the plan'}
            bodyClassName="p-4"
          >
            {run.status === 'pending' ? (
              <>
                <p className="text-[13px] leading-relaxed text-ink-muted">
                  Nothing has run yet. The plan is approved and the run is written down; your
                  machine claims it on its next check and reports each step back here.
                </p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink-subtle">
                  Nothing is lost if the machine is off. A queued run waits.
                </p>
              </>
            ) : run.status === 'running' ? (
              <p className="text-[13px] leading-relaxed text-ink-muted">
                Your machine has this run and has not reported a step yet. The first one appears
                here as soon as it finishes.
              </p>
            ) : (
              /* The one state with nothing to show and something to say. `errorMessage`
                 is the whole of what is known about a run whose machine went quiet, and
                 until this panel existed there was nowhere for it to be read. */
              <>
                <p className="text-[13px] leading-relaxed text-ink-muted">
                  Not one step ran.{' '}
                  {run.errorMessage ?? 'Nothing was recorded about why this run stopped.'}
                </p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink-subtle">
                  Nothing was tested, so nothing here says anything about your API yet. Running it
                  again is the next move.
                </p>
              </>
            )}
          </Panel>
        ) : detail ? (
          <Panel
            className="mt-4"
            title="Step by step"
            subtitle="Open a request to see everything covering that endpoint"
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
              This run is older than the reports kept on hand, so only its shape survives:{' '}
              {run.steps} steps, {run.passed} of them green.{' '}
              {/* From the strip, which every run in the window has -- `broke` needs the
                  report this branch exists because we do not have. */}
              {brokeIndex >= 0
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
          <form className="flex flex-wrap items-center gap-2 px-4 py-3.5">
            <input type="hidden" name="publicId" value={run.planPublicId} />

            {/* The same write as the plan's `Ask to run`, reached from the evidence.
                Off while this run is unfinished -- there is nothing to repeat yet --
                and off for a plan that has since been archived, which `enqueueRun`
                would refuse anyway. */}
            <Button
              type="submit"
              formAction={runPlanAction}
              variant="primary"
              size="sm"
              disabled={!cliConnected || inFlight || plan?.status !== 'approved'}
              title={
                plan?.status !== 'approved'
                  ? 'This plan is no longer approved, so it cannot be run again'
                  : inFlight
                    ? 'This run has not finished yet'
                    : cliConnected
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
              scroll={false}
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
          </form>

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
