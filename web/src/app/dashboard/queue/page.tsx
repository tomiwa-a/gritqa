import Link from 'next/link';
import { Topbar } from '@/components/app/topbar';
import { EmptyState } from '@/components/app/empty-state';
import { GenerateMenu } from '@/components/app/generate-menu';
import { OverlayHost } from '@/components/app/overlay-host';
import { QueueRail } from '@/components/app/plan/queue-rail';
import { QueueKeys } from '@/components/app/plan/queue-keys';
import { PlanReader } from '@/components/app/plan/plan-reader';
import { StepInspector } from '@/components/app/plan/step-inspector';
import { buttonVariants } from '@/components/ui/button';
import { NoProjectGate } from '@/components/app/no-project-gate';
import { Icon } from '@/components/ui/icon';
import { isCliConnected, getCurrentProjectOrNull, getPlanDetail, getPlansAwaitingReview } from '@/lib/data';
import { stepIsHeavy } from '@/lib/model';
import {
  approveToken,
  refineToken,
  parseOverlay,
  withOverlay,
  type PageParams,
} from '@/lib/overlay';

export const metadata = { title: 'Review queue · GritQA' };

const QUEUE = '/dashboard/queue';

export default async function QueuePage({ searchParams }: { searchParams: Promise<PageParams> }) {
  const params = await searchParams;
  const project = await getCurrentProjectOrNull();
  if (!project) return <NoProjectGate icon="queue" title="Review queue" />;
  const [cliConnected, plansAwaitingReview] = await Promise.all([
    isCliConnected(),
    getPlansAwaitingReview(),
  ]);
  const planParam = typeof params.plan === 'string' ? params.plan : undefined;
  const stepParam = typeof params.step === 'string' ? params.step : undefined;

  if (plansAwaitingReview.length === 0) {
    return (
      <>
        <Topbar icon="queue" title="Review queue" action={<GenerateMenu />} />
        <main className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-6">
          <EmptyState
            icon="queue"
            title="Nothing waiting on you"
            description="Drafts land here after a push, or whenever you ask for one by hand. You will see them before anything runs."
            action={
              <Link
                href="/dashboard/test-plans"
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                <Icon name="plan" size={14} />
                See the plans you have approved
              </Link>
            }
          />
        </main>

        <OverlayHost params={params} pathname={QUEUE} />
      </>
    );
  }

  const selected =
    plansAwaitingReview.find((p) => p.publicId === planParam) ?? plansAwaitingReview[0];
  const detail = await getPlanDetail(selected.publicId);

  const stepIndex = detail && stepParam ? detail.steps.findIndex((s) => s.id === stepParam) : -1;
  const step = stepIndex >= 0 ? detail?.steps[stepIndex] : undefined;

  const planHref = `${QUEUE}?plan=${selected.publicId}`;
  const stepHrefFor = (stepId: string) => `${planHref}&step=${stepId}`;

  /* One panel at a time: a drawer or the wizard parks the step inspector. */
  const overlay = parseOverlay(typeof params.open === 'string' ? params.open : undefined);

  /* Pin the plan on the way in, so the reader behind the panel cannot drift. */
  const refineHref = withOverlay(
    QUEUE,
    { ...params, plan: selected.publicId },
    refineToken(selected.publicId),
  );

  /* Pinned the same way, and for a sharper reason here: `a` approves the selected plan
     without reading it, so the plan the confirm names has to be the one the rail has. */
  const approveHref = detail?.steps.some(stepIsHeavy)
    ? withOverlay(QUEUE, { ...params, plan: selected.publicId }, approveToken(selected.publicId))
    : undefined;

  const prevStep = stepIndex > 0 ? detail?.steps[stepIndex - 1] : undefined;
  const nextStep = stepIndex >= 0 ? detail?.steps[stepIndex + 1] : undefined;

  return (
    <>
      <Topbar
        icon="queue"
        title="Review queue"
        action={
          <>
            <QueueKeys
              ids={plansAwaitingReview.map((p) => p.publicId)}
              selectedId={selected.publicId}
              queuePath={QUEUE}
              planPathBase="/dashboard/test-plans"
            />
            <GenerateMenu />
          </>
        }
      />

      <div className="flex min-w-0 flex-1 flex-col lg:h-[calc(100dvh-3.5rem)] lg:flex-row lg:overflow-hidden">
        <QueueRail
          plans={plansAwaitingReview}
          selectedId={selected.publicId}
          hrefFor={(id) => `${QUEUE}?plan=${id}`}
          className="shrink-0 border-b lg:w-[19rem] lg:border-r lg:border-b-0"
        />

        <PlanReader
          plan={selected}
          detail={detail}
          cliConnected={cliConnected}
          selectedStepId={step?.id}
          stepHrefFor={stepHrefFor}
          refineHref={refineHref}
          approveHref={approveHref}
          className="min-w-0 flex-1"
        />
      </div>

      {step && detail && !overlay && (
        <StepInspector
          step={step}
          index={stepIndex}
          total={detail.steps.length}
          closeHref={planHref}
          prevHref={prevStep ? stepHrefFor(prevStep.id) : undefined}
          nextHref={nextStep ? stepHrefFor(nextStep.id) : undefined}
          failure={detail.previousFailure}
          check={detail.checks.find((c) => c.stepId === step.id)}
          planPublicId={selected.publicId}
        />
      )}

      <OverlayHost params={params} pathname={QUEUE} />
    </>
  );
}
