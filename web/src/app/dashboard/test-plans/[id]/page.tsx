import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Topbar } from '@/components/app/topbar';
import { PageBody } from '@/components/app/page-body';
import { Panel } from '@/components/app/panel';
import { Prose } from '@/components/ui/prose';
import { Meter } from '@/components/app/meter';
import { PlanBody } from '@/components/app/plan/plan-body';
import { PlanDiff } from '@/components/app/plan/plan-diff';
import { StepInspector } from '@/components/app/plan/step-inspector';
import { DecisionBar } from '@/components/app/plan/decision-bar';
import { OverlayHost } from '@/components/app/overlay-host';
import { GenerateMenu } from '@/components/app/generate-menu';
import { Segmented } from '@/components/ui/segmented';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code-block';
import { Icon } from '@/components/ui/icon';
import {
  getAllPlans,
  isCliConnected,
  getPlanDetail,
  getRecentRuns,
  getRunHistory,
} from '@/lib/data';
import { archivePlanAction, runPlanAction } from '@/lib/actions/plans';
import { planJson, RUN_TONE, RUN_WORD } from '@/lib/plan';
import { isSettled, runRowsOf, runsForPlan } from '@/lib/runs';
import {
  approveToken,
  refineToken,
  parseOverlay,
  runToken,
  withOverlay,
  type PageParams,
} from '@/lib/overlay';
import { stepIsHeavy, type TestPlan } from '@/lib/model';

const TABS = ['steps', 'diff', 'raw'] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | undefined): value is Tab {
  return TABS.some((t) => t === value);
}

const STATUS: Record<
  TestPlan['status'],
  { badge: 'draft' | 'approved' | 'archived'; word: string }
> = {
  draft: { badge: 'draft', word: 'Waiting for your review' },
  approved: { badge: 'approved', word: 'Approved' },
  archived: { badge: 'archived', word: 'Archived' },
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = (await getAllPlans()).find((p) => p.publicId === id);
  return { title: plan ? `${plan.name} · GritQA` : 'Plan not found · GritQA' };
}

/** Approved plans get run and archived, not approved again. */
function SettledBar({
  plan,
  cliConnected,
  refineHref,
  runHref,
}: {
  plan: TestPlan;
  cliConnected: boolean;
  /** Opens the conversation panel over this page. */
  refineHref: string;
  /** Where the last-run readout goes — a preview over this page, when there is a run. */
  runHref?: string;
}) {
  /* A run asked for and not yet finished. The plan's own `lastRun` answers this --
     the newest run is the live one when there is a live one -- so knowing whether
     to offer another costs nothing. */
  const inFlight = plan.lastRun && !isSettled(plan.lastRun.status);

  const lastRun = plan.lastRun && (
    <>
      <StatusDot tone={RUN_TONE[plan.lastRun.status]} pulse={plan.lastRun.status === 'running'} />
      <span className="text-[12px] text-ink-muted">{RUN_WORD[plan.lastRun.status]}</span>
      <Meter
        total={plan.lastRun.total}
        passed={plan.lastRun.passed}
        tone={plan.lastRun.status === 'failed' ? 'fail' : 'skip'}
      />
      <span className="hidden text-[12px] text-ink-subtle sm:inline">{plan.lastRun.label}</span>
    </>
  );

  return (
    <div className="flex flex-col gap-2 lg:items-end">
      <form className="flex flex-wrap items-center gap-2 lg:justify-end">
        <input type="hidden" name="publicId" value={plan.publicId} />

        {/* One run at a time. While one is in flight the button goes to it instead
            of offering a second -- `enqueueRun` would refuse anyway, and a button
            that silently does nothing is worse than one that says why. */}
        {inFlight && runHref ? (
          <Link
            href={runHref}
            scroll={false}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <Icon name="runs" size={14} />
            See the run
          </Link>
        ) : (
          <Button
            type="submit"
            formAction={runPlanAction}
            variant="primary"
            size="sm"
            disabled={!cliConnected || inFlight || plan.status !== 'approved'}
            title={
              plan.status !== 'approved'
                ? 'Archived plans are kept for the record, never run again'
                : inFlight
                  ? 'A run of this plan is already waiting on your machine'
                  : cliConnected
                    ? 'Ask your machine to run this plan now'
                    : 'Runs happen on your machine, and it is not connected right now'
            }
          >
            <Icon name="runs" size={14} />
            Ask to run
          </Button>
        )}

        <Link
          href={refineHref}
          scroll={false}
          title="Say what should change, and read the new version"
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          <Icon name="sparkle" size={14} />
          Ask for a change
        </Link>

        {/* Only an approved plan can be retired. An archived one is already there,
            and the bar renders without this button rather than with a dead one. */}
        {plan.status === 'approved' && (
          <Button type="submit" formAction={archivePlanAction} variant="ghost" size="sm">
            <Icon name="archive" size={14} />
            Archive
          </Button>
        )}
      </form>

      {/* How it last went, under the buttons that decide what happens next. */}
      {plan.lastRun ? (
        runHref ? (
          <Link
            href={runHref}
            scroll={false}
            title="Look at that run without leaving the plan"
            className="-mr-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-1 transition-colors duration-150 hover:bg-app-hover"
          >
            {lastRun}
            <Icon name="chevronRight" size={13} className="text-ink-subtle" />
          </Link>
        ) : (
          <span className="flex items-center gap-2.5">{lastRun}</span>
        )
      ) : (
        <span className="flex items-center gap-2">
          <StatusDot tone="skip" label="Never run" />
          <span className="text-[12px] text-ink-subtle">Never run</span>
        </span>
      )}
    </div>
  );
}

export default async function PlanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<PageParams>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const tabParam = typeof query.tab === 'string' ? query.tab : undefined;
  const stepParam = typeof query.step === 'string' ? query.step : undefined;
  const versionParam = typeof query.v === 'string' ? query.v : undefined;

  const [allPlans, cliConnected, history, recent] = await Promise.all([
    getAllPlans(),
    isCliConnected(),
    getRunHistory(),
    getRecentRuns(),
  ]);

  const plan = allPlans.find((p) => p.publicId === id);
  if (!plan) notFound();

  const detail = await getPlanDetail(plan.publicId);
  const tab: Tab = isTab(tabParam) ? tabParam : 'steps';
  const status = STATUS[plan.status];

  const base = `/dashboard/test-plans/${plan.publicId}`;
  const hrefFor = (next: Tab) => (next === 'steps' ? base : `${base}?tab=${next}`);
  const diffHrefFor = (version: number) =>
    version > 1 ? `${base}?tab=diff&v=${version}` : `${base}?tab=diff`;

  /* One drawer at a time: a preview opening here parks the step inspector. */
  const overlay = parseOverlay(typeof query.open === 'string' ? query.open : undefined);
  const refineHref = withOverlay(base, query, refineToken(plan.publicId));
  /* Undefined for a plan that only asks, and that is the whole gate: the bar submits
     directly when there is nothing here worth reading first. */
  const approveHref = detail?.steps.some(stepIsHeavy)
    ? withOverlay(base, query, approveToken(plan.publicId))
    : undefined;
  const newestRun = runsForPlan(runRowsOf(history, recent), plan.publicId)[0];
  const runPreviewHref = newestRun
    ? withOverlay(base, query, runToken(newestRun.publicId))
    : undefined;

  const revisions = detail?.revisions ?? [];
  const asked = Number(versionParam);
  const toIndex = revisions.some((r) => r.version === asked)
    ? revisions.findIndex((r) => r.version === asked)
    : revisions.length - 1;
  const revision = revisions[toIndex];
  const previous = toIndex > 0 ? revisions[toIndex - 1] : undefined;

  const stepIndex = detail && stepParam ? detail.steps.findIndex((s) => s.id === stepParam) : -1;
  const step = stepIndex >= 0 ? detail?.steps[stepIndex] : undefined;
  const closeHref = tab === 'steps' ? base : `${base}?tab=${tab}`;
  const stepHrefFor = (stepId: string) =>
    tab === 'steps' ? `${base}?step=${stepId}` : `${base}?tab=${tab}&step=${stepId}`;

  const prevStep = stepIndex > 0 ? detail?.steps[stepIndex - 1] : undefined;
  const nextStep = stepIndex >= 0 ? detail?.steps[stepIndex + 1] : undefined;

  return (
    <>
      <Topbar
        icon="plan"
        title={plan.name}
        action={
          <>
            <Link
              href="/dashboard/test-plans"
              className="flex h-8 items-center gap-1.5 rounded-md border border-rule bg-app-panel px-2.5 text-[12.5px] text-ink-muted transition-colors duration-150 hover:text-ink"
            >
              <Icon name="chevronRight" size={13} className="rotate-180" />
              All plans
            </Link>
            <GenerateMenu />
          </>
        }
      />

      <PageBody>
        {/* Whatever you can do about this plan sits with its title, so the
            decision is in reach before you have read a single step. */}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status.badge} size="sm">
                {status.word}
              </Badge>
              <Badge variant="outline" size="sm" mono className="nums bg-app-panel">
                v{plan.version}
              </Badge>
              <span className="flex items-center gap-1.5 text-[11.5px] text-ink-subtle">
                <Icon name={plan.triggerSource === 'git_push' ? 'branch' : 'user'} size={12} />
                {plan.triggerSource === 'git_push' ? 'Drafted from a push' : 'Started by hand'}
              </span>
              {detail && (
                <span className="nums font-mono text-[11.5px] text-ink-subtle">
                  {detail.baseUrl}
                </span>
              )}
            </div>

            <h2 className="mt-2 text-[20px] leading-tight font-semibold tracking-[-0.02em] text-ink">
              {plan.name}
            </h2>
            <Prose size="lg" className="mt-1 max-w-[68ch]">
              {plan.description}
            </Prose>

            <p className="nums mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-subtle">
              <span>{plan.stepCount} steps</span>
              <span aria-hidden>·</span>
              <span>{plan.assertionCount} checks</span>
              <span aria-hidden>·</span>
              <span>
                {plan.covers.length} endpoint
                {plan.covers.length === 1 ? '' : 's'}
              </span>
              <span aria-hidden>·</span>
              <span>{plan.createdLabel}</span>
            </p>
          </div>

          <div className="shrink-0 lg:max-w-[22rem]">
            {plan.status === 'draft' ? (
              <DecisionBar
                planId={plan.publicId}
                cliConnected={cliConnected}
                refineHref={refineHref}
                confirmHref={approveHref}
              />
            ) : (
              <SettledBar
                plan={plan}
                cliConnected={cliConnected}
                refineHref={refineHref}
                runHref={runPreviewHref}
              />
            )}
          </div>
        </header>

        <div className="-mx-1 mt-4 max-w-full overflow-x-auto px-1 pb-1">
          <Segmented
            className="w-max"
            label="What to look at in this plan"
            active={tab}
            options={[
              {
                key: 'steps',
                label: 'Steps',
                icon: 'plan',
                href: hrefFor('steps'),
              },
              {
                key: 'diff',
                label: 'What changed',
                icon: 'diff',
                href: hrefFor('diff'),
              },
              { key: 'raw', label: 'Raw', icon: 'code', href: hrefFor('raw') },
            ]}
          />
        </div>

        <div className="mt-4">
          {tab === 'steps' && (
            <PlanBody
              plan={plan}
              detail={detail}
              selectedStepId={step?.id}
              stepHrefFor={stepHrefFor}
            />
          )}

          {tab === 'diff' && (
            <div className="flex flex-col gap-4">
              {revisions.length > 1 && (
                <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
                  <Segmented
                    className="w-max"
                    label="Which version to compare"
                    active={String(revision?.version ?? '')}
                    options={revisions
                      .filter((r) => r.version > 1)
                      .map((r) => ({
                        key: String(r.version),
                        label: `v${r.version - 1} → v${r.version}`,
                        href: diffHrefFor(r.version),
                      }))}
                  />
                </div>
              )}

              {revision ? (
                <Panel
                  title="What changed"
                  subtitle="Every version leaves a receipt, so nothing moves without you seeing it"
                  bodyClassName="p-0"
                >
                  <PlanDiff revision={revision} previous={previous} />
                </Panel>
              ) : (
                <Panel title="What changed" bodyClassName="p-4">
                  <p className="text-[13px] leading-relaxed text-ink-muted">
                    This plan has only ever had one version, so there is nothing to compare yet.
                  </p>
                </Panel>
              )}
            </div>
          )}

          {tab === 'raw' && (
            <div className="flex flex-col gap-4">
              <Panel
                title="The plan itself"
                subtitle="Exactly what your machine will read when it runs"
                meta={
                  <Button variant="secondary" size="sm">
                    <Icon name="copy" size={13} />
                    Copy
                  </Button>
                }
                bodyClassName="p-4"
              >
                {detail ? (
                  <>
                    <CodeBlock
                      code={planJson(detail)}
                      filename={`${plan.publicId}.v${plan.version}.json`}
                      lang="json"
                      caption={`The plan JSON for ${plan.name}`}
                      className="shadow-none"
                    />
                    <p className="mt-3 text-[12.5px] leading-relaxed text-ink-subtle">
                      Read-only for now. Editing this by hand is coming — until then, ask for a
                      change in your own words and read what comes back.
                    </p>
                  </>
                ) : (
                  <p className="text-[13px] leading-relaxed text-ink-muted">
                    The steps for this plan have not been loaded into this build yet.
                  </p>
                )}
              </Panel>
            </div>
          )}
        </div>
      </PageBody>

      {step && detail && !overlay && (
        <StepInspector
          step={step}
          index={stepIndex}
          total={detail.steps.length}
          closeHref={closeHref}
          prevHref={prevStep ? stepHrefFor(prevStep.id) : undefined}
          nextHref={nextStep ? stepHrefFor(nextStep.id) : undefined}
          failure={detail.previousFailure}
        />
      )}

      <OverlayHost params={query} pathname={base} />
    </>
  );
}
