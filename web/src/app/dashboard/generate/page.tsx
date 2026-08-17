import Link from 'next/link';
import { Topbar } from '@/components/app/topbar';
import { PageBody } from '@/components/app/page-body';
import { AppPageHeader } from '@/components/app/page-header';
import { Panel } from '@/components/app/panel';
import { EmptyState } from '@/components/app/empty-state';
import {
  EndpointPicker,
  type PickerFile,
} from '@/components/app/generate/endpoint-picker';
import { Segmented } from '@/components/ui/segmented';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { MethodBadge } from '@/components/ui/method-badge';
import { coverage, coverageTotals, currentProject, pendingChanges, rules } from '@/lib/mock/data';
import { COVERAGE_FILL, COVERAGE_LABEL, COVERAGE_ORDER } from '@/lib/coverage';
import { endpointHref, endpointKey } from '@/lib/plan';
import type { CoverageState } from '@/lib/mock/types';

export const metadata = { title: 'Generate tests · GritQA' };

const MODES = ['changes', 'endpoints', 'blank'] as const;
type Mode = (typeof MODES)[number];

function isMode(value: string | undefined): value is Mode {
  return MODES.some((m) => m === value);
}

const STATES = ['none', 'draft', 'failing', 'approved', 'all'] as const;
type StateFilter = (typeof STATES)[number];

function isState(value: string | undefined): value is StateFilter {
  return STATES.some((s) => s === value);
}

function pickerFiles(filter: StateFilter, only?: string[]): PickerFile[] {
  return coverage
    .filter((file) => !only || only.includes(file.file))
    .map((file) => ({
      file: file.file,
      endpoints: file.endpoints
        .filter((e) => filter === 'all' || e.state === filter)
        .map((e) => ({
          key: endpointKey(e),
          method: e.method,
          path: e.path,
          state: e.state,
        })),
    }))
    .filter((file) => file.endpoints.length > 0);
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] leading-snug text-ink-subtle">{hint}</span>}
    </label>
  );
}

export default async function GeneratePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; state?: string }>;
}) {
  const { from: fromParam, state: stateParam } = await searchParams;
  const mode: Mode = isMode(fromParam) ? fromParam : pendingChanges ? 'changes' : 'endpoints';
  const stateFilter: StateFilter = isState(stateParam) ? stateParam : 'none';

  const indexed = currentProject.lastIndexedLabel !== null;
  const activeRules = rules.filter((r) => r.isActive);

  const changedFiles = pendingChanges?.files.map((f) => f.path) ?? [];
  const changedEndpoints = coverage
    .filter((file) => changedFiles.includes(file.file))
    .flatMap((file) => file.endpoints.map((e) => ({ ...e, file: file.file })));

  const base = '/dashboard/generate';
  const pickable = pickerFiles(stateFilter);

  if (!indexed) {
    return (
      <>
        <Topbar icon="sparkle" title="Generate tests" />
        <PageBody>
          <AppPageHeader
            title="Nothing to read yet"
            description="GritQA writes plans from your own routes, so it needs to read the project once before it can draft anything."
          />
          <EmptyState
            className="mt-5"
            icon="terminal"
            title="Connect the project first"
            description="Point the CLI at your repository. It reads the routes on your machine and sends up the shape — never the code."
            action={
              <Link
                href="/dashboard/setup"
                className={buttonVariants({ variant: 'primary', size: 'sm' })}
              >
                <Icon name="terminal" size={14} />
                Set up the CLI
              </Link>
            }
          />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <Topbar icon="sparkle" title="Generate tests" />

      <PageBody>
        <AppPageHeader
          title="Draft some plans"
          description="You choose what to cover. GritQA writes the requests, the order and the checks, then hands every draft back for you to read before anything runs."
          action={
            <Badge variant="outline" size="sm" className="nums bg-app-panel">
              {coverageTotals.none} endpoints uncovered
            </Badge>
          }
        />

        <div className="-mx-1 mt-5 max-w-full overflow-x-auto px-1 pb-1">
          <Segmented
            className="w-max"
            label="Where the drafts should come from"
            active={mode}
            options={[
              {
                key: 'changes',
                label: 'From what changed',
                icon: 'branch',
                href: `${base}?from=changes`,
                count: changedEndpoints.length || undefined,
              },
              {
                key: 'endpoints',
                label: 'Pick endpoints',
                icon: 'endpoint',
                href: `${base}?from=endpoints`,
              },
              { key: 'blank', label: 'Write it yourself', icon: 'plan', href: `${base}?from=blank` },
            ]}
          />
        </div>

        {mode === 'changes' && (
          <div className="mt-4 flex flex-col gap-4">
            {pendingChanges ? (
              <>
                <Panel
                  title="What moved since the last draft"
                  subtitle="Read off the push, not typed in by anyone"
                  meta={
                    <span className="nums shrink-0 font-mono text-[11.5px]">
                      <span className="text-pass">+{pendingChanges.additions}</span>{' '}
                      <span className="text-fail">−{pendingChanges.deletions}</span>
                    </span>
                  }
                  bodyClassName="p-0"
                >
                  <div className="flex flex-col gap-1.5 border-b border-rule-soft px-4 py-3.5">
                    <p className="flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-ink-subtle">
                      <Icon name="branch" size={12} />
                      {pendingChanges.branch}
                      <span aria-hidden>·</span>
                      <span className="nums">{pendingChanges.commit}</span>
                    </p>
                    <p className="text-[13px] leading-snug text-ink">{pendingChanges.message}</p>
                  </div>

                  <ul className="divide-y divide-rule-soft">
                    {pendingChanges.files.map((file) => (
                      <li key={file.path} className="flex items-center gap-3 px-4 py-2.5">
                        <Icon name="code" size={13} className="shrink-0 text-ink-subtle" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-muted">
                          {file.path}
                        </span>
                        <span className="nums shrink-0 font-mono text-[11.5px]">
                          <span className="text-pass">+{file.additions}</span>{' '}
                          <span className="text-fail">−{file.deletions}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Panel>

                <Panel
                  title="The endpoints in those files"
                  subtitle="Where each one stands today, so you can see what is worth drafting"
                  meta={
                    <span className="nums shrink-0 font-mono text-[11.5px] text-ink-subtle">
                      {changedEndpoints.length}
                    </span>
                  }
                  bodyClassName="p-0"
                >
                  <ul className="divide-y divide-rule-soft">
                    {changedEndpoints.map((e) => (
                      <li key={endpointKey(e)}>
                        <Link
                          href={endpointHref(e)}
                          className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-app-hover"
                        >
                          <MethodBadge method={e.method} />
                          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">
                            {e.path}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span
                              className={`h-2 w-2 rounded-full ${COVERAGE_FILL[e.state as CoverageState]}`}
                            />
                            <span className="hidden text-[11.5px] text-ink-subtle sm:inline">
                              {COVERAGE_LABEL[e.state]}
                            </span>
                          </span>
                          <Icon
                            name="chevronRight"
                            size={13}
                            className="shrink-0 text-rule-strong"
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-center gap-3 border-t border-rule bg-app-panel px-4 py-3">
                    <Button variant="primary" size="sm">
                      <Icon name="sparkle" size={14} />
                      Draft plans for these
                    </Button>
                    <Link
                      href={`${base}?from=endpoints`}
                      className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                    >
                      Choose them myself
                    </Link>
                    <p className="text-[11.5px] leading-snug text-ink-subtle">
                      Every draft lands in the review queue. Nothing runs until you say so.
                    </p>
                  </div>
                </Panel>
              </>
            ) : (
              <EmptyState
                icon="branch"
                title="Nothing has changed since the last read"
                description="Drafts from a push appear here when GritQA sees something new. Until then, pick endpoints by hand."
                action={
                  <Link
                    href={`${base}?from=endpoints`}
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                  >
                    <Icon name="endpoint" size={14} />
                    Pick endpoints
                  </Link>
                }
              />
            )}
          </div>
        )}

        {mode === 'endpoints' && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
              <Segmented
                className="w-max"
                label="Which endpoints to show"
                active={stateFilter}
                options={[
                  {
                    key: 'none',
                    label: 'The gaps',
                    href: `${base}?from=endpoints`,
                    dot: 'bg-rule-strong',
                    count: coverageTotals.none,
                  },
                  {
                    key: 'failing',
                    label: 'Failing',
                    href: `${base}?from=endpoints&state=failing`,
                    dot: 'bg-fail',
                    count: coverageTotals.failing,
                  },
                  {
                    key: 'draft',
                    label: 'In review',
                    href: `${base}?from=endpoints&state=draft`,
                    dot: 'bg-warn',
                    count: coverageTotals.draft,
                  },
                  {
                    key: 'all',
                    label: 'Everything',
                    href: `${base}?from=endpoints&state=all`,
                    count: coverageTotals.total,
                  },
                ]}
              />
            </div>

            <Panel
              title="Choose what to cover"
              subtitle={
                stateFilter === 'none'
                  ? 'The endpoints nothing covers yet — the honest place to start'
                  : stateFilter === 'all'
                    ? 'Every endpoint GritQA has read in this project'
                    : `Endpoints marked ${COVERAGE_LABEL[stateFilter as CoverageState].toLowerCase()}`
              }
              bodyClassName="p-0"
            >
              {pickable.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    size="sm"
                    icon="endpoint"
                    title="Nothing in this state"
                    description="Try Everything, or come back after the next run."
                  />
                </div>
              ) : (
                <EndpointPicker files={pickable} />
              )}
            </Panel>

            <Panel title="What shapes the drafts" bodyClassName="p-4">
              <p className="text-[13px] leading-relaxed text-ink-muted">
                {activeRules.length} of your rules are on, and every draft is written to follow them
                — the order requests go out in, what gets checked, and what stands in for a third
                party.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {activeRules.map((rule) => (
                  <Badge key={rule.publicId} variant="count" size="sm">
                    {rule.name}
                  </Badge>
                ))}
              </div>
              <Link
                href="/dashboard/rules"
                className="group mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
              >
                Change the rules
                <Icon
                  name="arrowRight"
                  size={13}
                  className="transition-transform duration-200 group-hover:translate-x-0.5"
                />
              </Link>
            </Panel>
          </div>
        )}

        {mode === 'blank' && (
          <div className="mt-4 flex flex-col gap-4">
            <Panel
              title="Start from nothing"
              subtitle="You say what it should prove; GritQA works out the requests"
              bodyClassName="p-4"
            >
              <div className="flex max-w-[46rem] flex-col gap-4">
                <Field label="What should this plan be called?">
                  <Input dense placeholder="Refunds never exceed the original charge" />
                </Field>

                <Field
                  label="What should it prove?"
                  hint="Plain words. This is the whole brief the draft is written from."
                >
                  <textarea
                    rows={4}
                    placeholder="Charge a card, refund part of it, then try to refund more than what is left. The last one should be refused and the balance should not move."
                    className="w-full resize-y rounded-md border border-rule-strong bg-surface px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink transition-colors duration-150 placeholder:text-ink-subtle hover:border-ink-subtle"
                  />
                </Field>

                <Field
                  label="Where should it run?"
                  hint="The address your machine will call. It never leaves your machine."
                >
                  <Input dense defaultValue="http://localhost:8080" className="font-mono" />
                </Field>

                <div className="flex flex-wrap items-center gap-3 border-t border-rule-soft pt-4">
                  <Button variant="primary" size="sm">
                    <Icon name="sparkle" size={14} />
                    Draft it
                  </Button>
                  <p className="text-[11.5px] leading-snug text-ink-subtle">
                    You get steps back to read, not a finished test. Nothing runs until you approve
                    it.
                  </p>
                </div>
              </div>
            </Panel>

            <Panel title="If you would rather not start from a blank page" bodyClassName="p-4">
              <p className="text-[13px] leading-relaxed text-ink-muted">
                {coverageTotals.none} of your {coverageTotals.total} endpoints have nothing covering
                them. Picking from that list is usually faster than describing a journey from
                scratch.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                {COVERAGE_ORDER.map((state) => (
                  <span key={state} className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-[3px] ${COVERAGE_FILL[state]}`} />
                    <span className="text-[12px] text-ink-muted">{COVERAGE_LABEL[state]}</span>
                    <span className="nums text-[12px] font-medium text-ink">
                      {coverageTotals[state]}
                    </span>
                  </span>
                ))}
              </div>
              <Link
                href={`${base}?from=endpoints`}
                className={buttonVariants({
                  variant: 'secondary',
                  size: 'sm',
                  className: 'mt-3.5',
                })}
              >
                <Icon name="endpoint" size={14} />
                Pick from the gaps
              </Link>
            </Panel>
          </div>
        )}
      </PageBody>
    </>
  );
}
