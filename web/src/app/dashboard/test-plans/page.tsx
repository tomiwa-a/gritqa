import Link from 'next/link';
import { Topbar } from '@/components/app/topbar';
import { PageBody } from '@/components/app/page-body';
import { AppPageHeader } from '@/components/app/page-header';
import { Panel } from '@/components/app/panel';
import { DataTable, type Column } from '@/components/app/data-table';
import { Meter } from '@/components/app/meter';
import { EmptyState } from '@/components/app/empty-state';
import { Segmented } from '@/components/ui/segmented';
import { Badge, StatusDot } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MethodBadge } from '@/components/ui/method-badge';
import { getAllPlans, getCoverage, getPlansAwaitingReview } from '@/lib/data';
import {
  coverageFileFor,
  endpointFocusFor,
  filesCoveredBy,
  plansForEndpoint,
  plansForFile,
  RUN_WORD,
} from '@/lib/plan';
import { EndpointFocusHeader, FileFocusHeader } from '@/components/app/coverage-focus';
import { OverlayHost } from '@/components/app/overlay-host';
import { GenerateMenu } from '@/components/app/generate-menu';
import { planToken, withOverlay, type PageParams } from '@/lib/overlay';
import type { CoverageFile, TestPlan } from '@/lib/mock/types';

export const metadata = { title: 'Test plans · GritQA' };

const PATH = '/dashboard/test-plans';

const GROUPS = ['flat', 'endpoint', 'file', 'status'] as const;
type Group = (typeof GROUPS)[number];

function isGroup(value: string | undefined): value is Group {
  return GROUPS.some((g) => g === value);
}

const STATUS_ORDER: TestPlan['status'][] = ['draft', 'approved', 'archived'];

const STATUS_LABEL: Record<TestPlan['status'], { title: string; hint: string }> = {
  draft: { title: 'Waiting for review', hint: 'Nothing here has run against your code yet.' },
  approved: { title: 'Approved', hint: 'These are the plans your machine will run.' },
  archived: { title: 'Archived', hint: 'Kept for the record, never run.' },
};

type Section = { key: string; title: string; hint?: string; plans: TestPlan[] };

/* Every grouping below is computed from the plan itself. No plan carries a
   folder, a suite or a tag, because none of those exist. */
function sectionsFor(allPlans: TestPlan[], coverage: CoverageFile[], group: Group): Section[] {
  if (group === 'status') {
    return STATUS_ORDER.map((status) => ({
      key: status,
      title: STATUS_LABEL[status].title,
      hint: STATUS_LABEL[status].hint,
      plans: allPlans.filter((p) => p.status === status),
    })).filter((s) => s.plans.length > 0);
  }

  if (group === 'endpoint') {
    const byEndpoint = new Map<string, Section>();
    for (const plan of allPlans) {
      for (const endpoint of plan.covers) {
        const key = `${endpoint.method} ${endpoint.path}`;
        const found = byEndpoint.get(key);
        if (found) found.plans.push(plan);
        else
          byEndpoint.set(key, { key, title: endpoint.path, hint: endpoint.method, plans: [plan] });
      }
    }
    return [...byEndpoint.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  if (group === 'file') {
    const byFile = new Map<string, Section>();
    for (const plan of allPlans) {
      for (const file of filesCoveredBy(coverage, plan)) {
        const found = byFile.get(file);
        if (found) found.plans.push(plan);
        else byFile.set(file, { key: file, title: file, plans: [plan] });
      }
    }
    return [...byFile.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  return [{ key: 'flat', title: 'All plans', plans: allPlans }];
}

function Covers({ plan }: { plan: TestPlan }) {
  const [first, ...rest] = plan.covers;
  return (
    <span className="flex min-w-0 items-center gap-2">
      {first && <MethodBadge method={first.method} />}
      <span className="truncate font-mono text-[12px] text-ink-muted">{first?.path ?? '—'}</span>
      {rest.length > 0 && (
        <span className="nums shrink-0 text-[11.5px] text-ink-subtle">+{rest.length}</span>
      )}
    </span>
  );
}

/** The name previews the plan over the list; the chevron leaves for the full plan. */
const planColumns = (openPlan: (publicId: string) => string): Column<TestPlan>[] => [
  {
    key: 'name',
    header: 'Plan',
    cell: (plan) => (
      <Link
        href={openPlan(plan.publicId)}
        scroll={false}
        className="group flex min-w-0 items-center gap-2.5"
      >
        <StatusDot
          tone={plan.status === 'draft' ? 'review' : plan.status === 'approved' ? 'pass' : 'skip'}
          label={STATUS_LABEL[plan.status].title}
        />
        <span className="min-w-0">
          <span className="block truncate text-[13px] text-ink group-hover:underline group-hover:decoration-rule-strong group-hover:underline-offset-2">
            {plan.name}
          </span>
          <span className="nums mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-ink-subtle">
            v{plan.version}
            <Icon name={plan.triggerSource === 'git_push' ? 'branch' : 'user'} size={10} />
            {plan.createdLabel}
          </span>
        </span>
      </Link>
    ),
  },
  {
    key: 'covers',
    header: 'What it covers',
    cellClassName: 'max-w-[16rem]',
    cell: (plan) => <Covers plan={plan} />,
  },
  {
    key: 'size',
    header: 'Steps · checks',
    align: 'right',
    cell: (plan) => (
      <span className="nums font-mono text-[12px] text-ink-muted">
        {plan.stepCount} · {plan.assertionCount}
      </span>
    ),
  },
  {
    key: 'lastRun',
    header: 'Last run',
    cell: (plan) =>
      plan.lastRun ? (
        <span className="flex items-center gap-2.5">
          <Meter
            total={plan.lastRun.total}
            passed={plan.lastRun.passed}
            tone={plan.lastRun.status === 'failed' ? 'fail' : 'skip'}
          />
          <span className="hidden text-[11.5px] text-ink-subtle lg:inline">
            {RUN_WORD[plan.lastRun.status]} · {plan.lastRun.label}
          </span>
        </span>
      ) : (
        <span className="text-[12px] text-ink-subtle">Never run</span>
      ),
  },
  {
    key: 'action',
    header: 'Open',
    align: 'right',
    hideHeader: true,
    cell: (plan) =>
      plan.status === 'draft' ? (
        <Link
          href={openPlan(plan.publicId)}
          scroll={false}
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          Review
        </Link>
      ) : (
        <Link
          href={`/dashboard/test-plans/${plan.publicId}`}
          aria-label={`Open the full plan for ${plan.name}`}
          title="Open the full plan"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-subtle transition-colors duration-150 hover:bg-app-hover hover:text-ink"
        >
          <Icon name="chevronRight" size={14} />
        </Link>
      ),
  },
];

export default async function TestPlansPage({
  searchParams,
}: {
  searchParams: Promise<PageParams>;
}) {
  const params = await searchParams;
  const [allPlans, coverage, plansAwaitingReview] = await Promise.all([
    getAllPlans(),
    getCoverage(),
    getPlansAwaitingReview(),
  ]);
  const groupParam = typeof params.group === 'string' ? params.group : undefined;
  const endpointParam = typeof params.endpoint === 'string' ? params.endpoint : undefined;
  const fileParam = typeof params.file === 'string' ? params.file : undefined;
  const group: Group = isGroup(groupParam) ? groupParam : 'flat';
  const openPlan = (publicId: string) => withOverlay(PATH, params, planToken(publicId));

  /* A coverage square or a file name lands here. Focus narrows the list to what
     touches that one thing, and the grouping control steps aside while it does. */
  const endpointFocus = endpointFocusFor(coverage, endpointParam);
  /* Drafting for one endpoint opens the wizard over this page, on that endpoint. */
  const generateHref = (method: string, path: string) =>
    withOverlay(PATH, params, 'generate', {
      from: 'endpoints',
      g: 'scope',
      only: `${method} ${path}`,
    });
  const fileFocus = coverageFileFor(coverage, fileParam);
  const focused = Boolean(endpointFocus || fileFocus);
  const missing = Boolean((endpointParam && !endpointFocus) || (fileParam && !fileFocus));

  const sections = endpointFocus
    ? [
        {
          key: 'focus-endpoint',
          title: 'Plans that touch it',
          hint: 'Everything covering this endpoint today',
          plans: plansForEndpoint(allPlans, endpointFocus.path),
        },
      ]
    : fileFocus
      ? [
          {
            key: 'focus-file',
            title: 'Plans that reach into it',
            hint: 'Everything covering an endpoint in this file',
            plans: plansForFile(allPlans, coverage, fileFocus.file),
          },
        ]
      : sectionsFor(allPlans, coverage, group);

  const counts = {
    draft: allPlans.filter((p) => p.status === 'draft').length,
    approved: allPlans.filter((p) => p.status === 'approved').length,
    archived: allPlans.filter((p) => p.status === 'archived').length,
  };

  return (
    <>
      <Topbar
        icon="plan"
        title="Test plans"
        action={
          <>
            {plansAwaitingReview.length > 0 && (
              <Link
                href="/dashboard/queue"
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                <Icon name="queue" size={14} />
                Review {plansAwaitingReview.length}
              </Link>
            )}
            <GenerateMenu />
          </>
        }
      />

      <PageBody>
        <AppPageHeader
          title="Every plan you have"
          description="One plan is one journey through your API — a few requests in order, each one checking something. Approved plans are the ones your machine will run."
          action={
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge variant="draft" size="sm" className="nums">
                {counts.draft} draft
              </Badge>
              <Badge variant="approved" size="sm" className="nums">
                {counts.approved} approved
              </Badge>
              <Badge variant="archived" size="sm" className="nums">
                {counts.archived} archived
              </Badge>
            </span>
          }
        />

        {missing && (
          <p className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-rule bg-app px-3.5 py-2.5 text-[12.5px] text-ink-muted">
            <Icon name="alert" size={13} className="text-warn" />
            That endpoint is not in the index GritQA read, so here is everything instead.
          </p>
        )}

        {endpointFocus && (
          <EndpointFocusHeader
            focus={endpointFocus}
            plans={plansForEndpoint(allPlans, endpointFocus.path)}
            generateHref={generateHref(endpointFocus.method, endpointFocus.path)}
          />
        )}

        {!endpointFocus && fileFocus && (
          <FileFocusHeader
            file={fileFocus}
            plans={plansForFile(allPlans, coverage, fileFocus.file)}
          />
        )}

        {!focused && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
              <Segmented
                className="w-max"
                label="How to group the plans"
                active={group}
                options={[
                  { key: 'flat', label: 'Flat', icon: 'flat', href: '/dashboard/test-plans' },
                  {
                    key: 'endpoint',
                    label: 'By endpoint',
                    icon: 'endpoint',
                    href: '/dashboard/test-plans?group=endpoint',
                  },
                  {
                    key: 'file',
                    label: 'By file',
                    icon: 'code',
                    href: '/dashboard/test-plans?group=file',
                  },
                  {
                    key: 'status',
                    label: 'By status',
                    icon: 'filter',
                    href: '/dashboard/test-plans?group=status',
                  },
                ]}
              />
            </div>

            <p className="nums shrink-0 text-[12.5px] text-ink-subtle">
              {group === 'flat'
                ? `${allPlans.length} plans`
                : `${allPlans.length} plans across ${sections.length} ${
                    group === 'endpoint' ? 'endpoints' : group === 'file' ? 'files' : 'states'
                  }`}
            </p>
          </div>
        )}

        {!focused && group !== 'flat' && (
          <p className="mt-3 max-w-[68ch] text-[12.5px] leading-relaxed text-ink-subtle">
            A plan usually touches more than one{' '}
            {group === 'status' ? 'thing' : group === 'endpoint' ? 'endpoint' : 'file'}, so the same
            plan can show up in more than one group here.
          </p>
        )}

        <div className="mt-4 flex flex-col gap-4">
          {sections.length === 0 ? (
            <EmptyState
              icon="plan"
              title="No plans yet"
              description="The first draft appears here as soon as GritQA has read your code and something changes."
            />
          ) : (
            sections.map((section) => (
              <Panel
                key={section.key}
                title={section.title}
                subtitle={section.hint}
                meta={
                  <span className="nums shrink-0 font-mono text-[11.5px] text-ink-subtle">
                    {section.plans.length}
                  </span>
                }
                bodyClassName="p-0"
              >
                <DataTable
                  columns={planColumns(openPlan)}
                  rows={section.plans}
                  rowKey={(plan) => `${section.key}-${plan.publicId}`}
                  minWidth={760}
                  empty={
                    <p className="py-6 text-center text-[12.5px] text-ink-subtle">
                      {focused
                        ? 'No plan covers this yet — drafting one is the next move.'
                        : 'Nothing in this group.'}
                    </p>
                  }
                />
              </Panel>
            ))
          )}
        </div>
      </PageBody>

      <OverlayHost params={params} pathname={PATH} />
    </>
  );
}
