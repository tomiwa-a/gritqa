import Link from 'next/link';
import { Drawer, DrawerBlock, DrawerFacts } from '../drawer';
import { Meter } from '../meter';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MethodBadge } from '@/components/ui/method-badge';
import { allPlans, currentProject } from '@/lib/mock/data';
import { RUN_TONE, RUN_WORD } from '@/lib/plan';
import { runsForPlan } from '@/lib/runs';
import { askToken, runToken } from '@/lib/overlay';
import type { TestPlan } from '@/lib/mock/types';

const STATUS: Record<
  TestPlan['status'],
  { badge: 'draft' | 'approved' | 'archived'; word: string }
> = {
  draft: { badge: 'draft', word: 'Waiting for your review' },
  approved: { badge: 'approved', word: 'Approved' },
  archived: { badge: 'archived', word: 'Archived' },
};

/**
 * What the plan is and what you can do about it. The steps, the diff and the raw
 * JSON live on the plan's page; the conversation is a panel of its own.
 */
export function PlanPreview({
  id,
  closeHref,
  runDrawerHref,
  askDrawerHref,
}: {
  id: string;
  closeHref: string;
  runDrawerHref?: (token: string) => string;
  /** Swaps this panel for the conversation, so asking stays one click deep. */
  askDrawerHref?: (token: string) => string;
}) {
  const plan = allPlans.find((p) => p.publicId === id);
  if (!plan) return null;

  const status = STATUS[plan.status];
  const cliConnected = currentProject.lastIndexedLabel !== null;
  const base = `/dashboard/test-plans/${plan.publicId}`;

  /* The third outcome, and it reads like the other two rather than a trip.
     Without a panel to swap to, the plan's own page carries the same button. */
  const askHref = askDrawerHref ? askDrawerHref(askToken(plan.publicId)) : base;

  const lastRun = runsForPlan(plan.publicId)[0];
  const lastRunHref = lastRun
    ? runDrawerHref
      ? runDrawerHref(runToken(lastRun.publicId))
      : `/dashboard/runs/${lastRun.publicId}`
    : undefined;

  return (
    <Drawer
      id="plan-preview"
      closeHref={closeHref}
      label="plan preview"
      eyebrow={plan.status === 'draft' ? 'Draft plan' : 'Plan'}
      title={plan.name}
      footer={
        <div className="flex flex-col gap-2">
          {plan.status === 'draft' ? (
            <>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  className="flex-1"
                  data-decision="approve"
                  data-plan={plan.publicId}
                >
                  <Icon name="check" size={14} />
                  Approve
                </Button>
                <Button variant="ghost" size="sm" data-decision="reject" data-plan={plan.publicId}>
                  <Icon name="archive" size={14} />
                  Send back
                </Button>
              </div>
              <Link
                href={askHref}
                scroll={false}
                title="Say what should change, and read the new version"
                className={buttonVariants({
                  variant: 'secondary',
                  size: 'sm',
                  className: 'w-full',
                })}
              >
                <Icon name="sparkle" size={14} />
                Ask for a change
              </Link>
              <Link
                href={`/dashboard/queue?plan=${plan.publicId}`}
                className="mt-0.5 flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
              >
                <Icon name="plan" size={13} />
                Read it step by step
              </Link>
            </>
          ) : (
            <>
              <Button
                variant="primary"
                size="sm"
                className="w-full"
                disabled={!cliConnected}
                title={
                  cliConnected
                    ? 'Ask your machine to run this plan now'
                    : 'Runs happen on your machine, and it is not connected right now'
                }
              >
                <Icon name="runs" size={14} />
                Ask to run
              </Button>
              {/* Archived plans are kept for the record, never redrafted. */}
              {plan.status === 'approved' && (
                <Link
                  href={askHref}
                  scroll={false}
                  title="Say what should change, and read the new version"
                  className={buttonVariants({
                    variant: 'secondary',
                    size: 'sm',
                    className: 'w-full',
                  })}
                >
                  <Icon name="sparkle" size={14} />
                  Ask for a change
                </Link>
              )}
              <Link
                href={base}
                className="mt-0.5 flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
              >
                <Icon name="plan" size={13} />
                Open the full plan
              </Link>
            </>
          )}
        </div>
      }
    >
      <DrawerBlock label="Where it stands">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status.badge} size="sm">
            {status.word}
          </Badge>
          <Badge variant="outline" size="sm" mono className="nums bg-app-panel">
            v{plan.version}
          </Badge>
        </div>
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-muted">{plan.description}</p>
      </DrawerBlock>

      <DrawerBlock label="What it covers" meta={`${plan.covers.length}`}>
        <ul className="flex flex-col gap-1.5">
          {plan.covers.map((endpoint) => (
            <li key={`${endpoint.method} ${endpoint.path}`} className="flex items-center gap-2">
              <MethodBadge method={endpoint.method} />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-muted">
                {endpoint.path}
              </span>
            </li>
          ))}
        </ul>
      </DrawerBlock>

      <DrawerBlock label="Last run">
        {plan.lastRun ? (
          <>
            <div className="flex items-center gap-2.5">
              <StatusDot
                tone={RUN_TONE[plan.lastRun.status]}
                pulse={plan.lastRun.status === 'running'}
              />
              <span className="text-[12.5px] text-ink-muted">{RUN_WORD[plan.lastRun.status]}</span>
              <span className="nums ml-auto text-[11.5px] text-ink-subtle">
                {plan.lastRun.label}
              </span>
            </div>
            <div className="mt-2">
              <Meter
                total={plan.lastRun.total}
                passed={plan.lastRun.passed}
                tone={plan.lastRun.status === 'failed' ? 'fail' : 'skip'}
              />
            </div>
            {lastRunHref && (
              <Link
                href={lastRunHref}
                className="group mt-2.5 inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
              >
                See that run
                <Icon
                  name="arrowRight"
                  size={12}
                  className="transition-transform duration-200 group-hover:translate-x-0.5"
                />
              </Link>
            )}
          </>
        ) : (
          <p className="flex items-center gap-2 text-[12.5px] text-ink-subtle">
            <StatusDot tone="skip" />
            Never run
          </p>
        )}
      </DrawerBlock>

      <DrawerBlock label="Facts">
        <DrawerFacts
          rows={[
            { label: 'Steps', value: String(plan.stepCount) },
            { label: 'Checks', value: String(plan.assertionCount) },
            {
              label: 'Started by',
              value: plan.triggerSource === 'git_push' ? 'A push' : 'You, by hand',
            },
            { label: 'Drafted', value: plan.createdLabel },
          ]}
        />
      </DrawerBlock>
    </Drawer>
  );
}
