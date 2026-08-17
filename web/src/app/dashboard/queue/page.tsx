import Link from 'next/link';
import { Topbar } from '@/components/app/topbar';
import { EmptyState } from '@/components/app/empty-state';
import { QueueRail } from '@/components/app/plan/queue-rail';
import { QueueKeys } from '@/components/app/plan/queue-keys';
import { PlanReader } from '@/components/app/plan/plan-reader';
import { StepInspector } from '@/components/app/plan/step-inspector';
import { buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { currentProject, plansAwaitingReview } from '@/lib/mock/data';
import { planDetailFor } from '@/lib/mock/plans';

export const metadata = { title: 'Review queue · GritQA' };

const QUEUE = '/dashboard/queue';

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; step?: string }>;
}) {
  const { plan: planParam, step: stepParam } = await searchParams;

  if (plansAwaitingReview.length === 0) {
    return (
      <>
        <Topbar icon="queue" title="Review queue" />
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
      </>
    );
  }

  const selected =
    plansAwaitingReview.find((p) => p.publicId === planParam) ?? plansAwaitingReview[0];
  const detail = planDetailFor(selected.publicId);

  const stepIndex = detail && stepParam ? detail.steps.findIndex((s) => s.id === stepParam) : -1;
  const step = stepIndex >= 0 ? detail?.steps[stepIndex] : undefined;

  const planHref = `${QUEUE}?plan=${selected.publicId}`;

  return (
    <>
      <Topbar
        icon="queue"
        title="Review queue"
        action={
          <QueueKeys
            ids={plansAwaitingReview.map((p) => p.publicId)}
            selectedId={selected.publicId}
            queuePath={QUEUE}
            planPathBase="/dashboard/test-plans"
          />
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
          cliConnected={currentProject.lastIndexedLabel !== null}
          selectedStepId={step?.id}
          stepHrefFor={(stepId) => `${planHref}&step=${stepId}`}
          className="min-w-0 flex-1"
        />
      </div>

      {step && detail && (
        <StepInspector
          step={step}
          index={stepIndex}
          total={detail.steps.length}
          closeHref={planHref}
          failure={detail.previousFailure}
        />
      )}
    </>
  );
}
