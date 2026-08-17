import Link from 'next/link';
import { Drawer, DrawerBlock, DrawerFacts } from './drawer';
import { RunCells } from './run-cells';
import { Badge, StatusDot } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MethodBadge } from '@/components/ui/method-badge';
import { RUN_TONE, RUN_WORD } from '@/lib/plan';
import { brokeAt, runRowFor, runsForPlan, STEP_WORD } from '@/lib/runs';
import { planToken } from '@/lib/overlay';

const BADGE = {
  passed: 'pass',
  failed: 'fail',
  error: 'error',
  running: 'running',
  pending: 'skip',
} as const;

/**
 * Enough to decide whether to stop what you are doing. The step-by-step report
 * and the real-bug-or-bad-test call are on the run's own page, not repeated here.
 */
export function RunPreview({
  id,
  closeHref,
  planDrawerHref,
}: {
  id: string;
  closeHref: string;
  /** Swap this drawer for the plan behind the run, when the page can host it. */
  planDrawerHref?: (token: string) => string;
}) {
  const run = runRowFor(id);
  if (!run) return null;

  const detail = run.detail;
  const broke = brokeAt(run);
  const brokeIndex = detail && broke ? detail.steps.indexOf(broke) : -1;
  const siblings = runsForPlan(run.planPublicId).length;

  const runHref = `/dashboard/runs/${run.publicId}`;
  const planHref = planDrawerHref
    ? planDrawerHref(planToken(run.planPublicId))
    : `/dashboard/test-plans/${run.planPublicId}`;

  return (
    <Drawer
      id="run-preview"
      closeHref={closeHref}
      label="run preview"
      eyebrow="Run"
      title={run.planName}
      footer={
        <div className="flex flex-col gap-2">
          <Link
            href={runHref}
            className={buttonVariants({ variant: 'primary', size: 'sm', className: 'w-full' })}
          >
            <Icon name="runs" size={14} />
            {broke ? 'Open the full report' : 'Open the full run'}
          </Link>
          <Link
            href={planHref}
            className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'w-full' })}
          >
            <Icon name="plan" size={14} />
            The plan behind it
          </Link>
        </div>
      }
    >
      <DrawerBlock label="Where it got to">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={BADGE[run.status]} size="sm">
            <StatusDot tone={RUN_TONE[run.status]} pulse={run.status === 'running'} />
            {RUN_WORD[run.status]}
          </Badge>
          <span className="nums text-[11.5px] text-ink-subtle">{run.whenLabel}</span>
        </div>

        <p className="mt-2.5 text-[13px] leading-snug text-ink">
          {broke
            ? `Stopped on step ${brokeIndex + 1} of ${run.steps}.`
            : run.status === 'running'
              ? 'Running now.'
              : `All ${run.steps} steps passed.`}
        </p>

        <p className="mt-2.5 flex flex-wrap items-center gap-2">
          <RunCells cells={run.cells} />
          <span className="nums text-[12px] text-ink-subtle">
            {run.passed}/{run.steps} passed
          </span>
        </p>
      </DrawerBlock>

      {broke && (
        <DrawerBlock label="It broke here">
          <div className="rounded-md border border-fail/25 bg-fail/[0.04] p-2.5">
            <div className="flex items-center gap-2">
              <MethodBadge method={broke.method} />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
                {broke.path}
              </span>
              {broke.responseStatus !== null && (
                <span className="nums shrink-0 font-mono text-[12px] font-medium text-fail">
                  {broke.responseStatus}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[12.5px] leading-snug text-ink-muted">
              Step {brokeIndex + 1} · {broke.stepName} · {STEP_WORD[broke.status]}
            </p>
          </div>
          <p className="mt-2 text-[11.5px] leading-snug text-ink-subtle">
            Whether this is a real bug or a test that has gone stale is a call only you can make —
            the full report is where you make it.
          </p>
        </DrawerBlock>
      )}

      <DrawerBlock label="Facts">
        <DrawerFacts
          rows={[
            { label: 'Run', value: <span className="font-mono">{run.publicId}</span> },
            {
              label: 'Took',
              value: detail?.durationMs ? `${(detail.durationMs / 1000).toFixed(1)}s` : '—',
            },
            { label: 'Steps', value: `${run.passed} of ${run.steps} passed` },
            { label: 'Runs of this plan', value: String(siblings) },
          ]}
        />
      </DrawerBlock>
    </Drawer>
  );
}
