import Link from 'next/link';
import { Modal } from '../modal';
import { EmptyState } from '../empty-state';
import { WizardRail } from '../wizard/wizard-rail';
import { CommitHistory } from './commit-history';
import { CommitSearch } from './commit-search';
import { EndpointPicker, type PickerFile } from './endpoint-picker';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';import { Icon, type IconName } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { COVERAGE_FILL, COVERAGE_LABEL } from '@/lib/coverage';
import { diffFrom, resolveFrom, searchCommits } from '@/lib/commits';
import { endpointKey } from '@/lib/plan';
import { withOverlayParams, type PageParams } from '@/lib/overlay';
import {
  commits,
  coverage,
  coverageTotals,
  currentProject,
  lastDraftedFrom,
  rules,
} from '@/lib/mock/data';
import type { CoverageState } from '@/lib/mock/types';

const SOURCES = ['changes', 'endpoints', 'blank'] as const;
type Source = (typeof SOURCES)[number];

const STEPS = ['source', 'scope', 'drafting'] as const;
type Step = (typeof STEPS)[number];

const STATES = ['none', 'draft', 'failing', 'approved', 'all'] as const;
type StateFilter = (typeof STATES)[number];

const DOORS: { key: Source; icon: IconName; label: string; hint: string }[] = [
  {
    key: 'changes',
    icon: 'branch',
    label: 'From what changed',
    hint: 'Point at a commit and everything since it. GritQA works out what those changes reach.',
  },
  {
    key: 'endpoints',
    icon: 'endpoint',
    label: 'Pick endpoints',
    hint: 'Choose from the gaps yourself, grouped by the file they live in.',
  },
  {
    key: 'blank',
    icon: 'plan',
    label: 'Describe a journey',
    hint: 'Say what it should prove in plain words and let the requests be worked out.',
  },
];

const SCOPE_COPY: Record<Source, { title: string; subtitle: string }> = {
  changes: {
    title: 'What moved',
    subtitle: 'Pick where to read from. Everything above that line goes into the drafts.',
  },
  endpoints: {
    title: 'Choose what to cover',
    subtitle: 'Tick the endpoints you want plans for.',
  },
  blank: {
    title: 'Describe the journey',
    subtitle: 'You say what it should prove; the requests get worked out for you.',
  },
};

function isSource(value: string | undefined): value is Source {
  return SOURCES.some((s) => s === value);
}

function isStep(value: string | undefined): value is Step {
  return STEPS.some((s) => s === value);
}

function isState(value: string | undefined): value is StateFilter {
  return STATES.some((s) => s === value);
}

/** Resolves an `only=METHOD /path` key back to the endpoint and the file it lives in. */
function findEndpoint(key: string) {
  for (const file of coverage) {
    const endpoint = file.endpoints.find((e) => endpointKey(e) === key);
    if (endpoint) return { key, file: file.file, method: endpoint.method, path: endpoint.path };
  }
  return undefined;
}

function pickerFiles(filter: StateFilter, only?: string[]): PickerFile[] {
  return coverage
    .filter((file) => !only || only.includes(file.file))
    .map((file) => ({
      file: file.file,
      endpoints: file.endpoints
        .filter((e) => filter === 'all' || e.state === filter)
        .map((e) => ({ key: endpointKey(e), method: e.method, path: e.path, state: e.state })),
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

function Section({
  label,
  meta,
  className,
  children,
}: {
  label: string;
  meta?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('border-b border-rule-soft last:border-b-0', className)}>
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2 sm:px-5">
        <h3 className="font-mono text-[9.5px] tracking-[0.14em] text-ink-subtle uppercase">
          {label}
        </h3>
        {meta && <span className="ml-auto shrink-0">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * Drafting a plan, without losing the page you were reading. Three steps on the
 * URL so the whole thing stays server-rendered and linkable.
 */
export function GenerateModal({
  params,
  pathname,
  closeHref,
}: {
  params: PageParams;
  pathname: string;
  closeHref: string;
}) {
  const askedSource = typeof params.from === 'string' ? params.from : undefined;
  const askedStep = typeof params.g === 'string' ? params.g : undefined;
  const askedState = typeof params.state === 'string' ? params.state : undefined;
  const askedFrom = typeof params.since === 'string' ? params.since : undefined;
  const query = typeof params.q === 'string' ? params.q : undefined;
  const askedOnly = typeof params.only === 'string' ? params.only : undefined;

  const indexed = currentProject.lastIndexedLabel !== null;
  const source: Source = isSource(askedSource) ? askedSource : 'changes';
  const step: Step = isStep(askedStep) ? askedStep : askedSource ? 'scope' : 'source';

  /* Arriving from one endpoint: show its file, with that endpoint already ticked. */
  const focus = askedOnly ? findEndpoint(askedOnly) : undefined;
  const stateFilter: StateFilter = isState(askedState) ? askedState : focus ? 'all' : 'none';

  const href = (patch: Record<string, string | undefined>) =>
    withOverlayParams(pathname, params, patch);

  if (!indexed) {
    return (
      <Modal
        id="generate-modal"
        closeHref={closeHref}
        label="draft plans"
        eyebrow="Draft plans"
        title="Nothing to read yet"
        subtitle="GritQA writes plans from your own routes, so it needs to read the project once before it can draft anything."
      >
        <div className="p-4 sm:p-5">
          <EmptyState
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
        </div>
      </Modal>
    );
  }

  const from = resolveFrom(commits, askedFrom, lastDraftedFrom);
  const diff = diffFrom(commits, from);
  const shown = searchCommits(commits, query);
  const pickable = pickerFiles(stateFilter, focus ? [focus.file] : undefined);
  const activeRules = rules.filter((r) => r.isActive);

  const rail = (
    <WizardRail
      active={step}
      layout="row"
      label="Drafting steps"
      steps={[
        { key: 'source', label: 'Where from', hint: 'Pick a starting point' },
        { key: 'scope', label: 'What to cover', hint: 'Narrow it down' },
        { key: 'drafting', label: 'Drafting', hint: 'GritQA writes it' },
      ]}
      hrefFor={(key) => href({ g: key })}
    />
  );

  return (
    <Modal
      id="generate-modal"
      closeHref={closeHref}
      label="draft plans"
      eyebrow="Draft plans"
      title={step === 'source' ? 'Where should the drafts come from?' : SCOPE_COPY[source].title}
      subtitle={step === 'source' ? undefined : SCOPE_COPY[source].subtitle}
      rail={step === 'drafting' ? undefined : rail}
      footer={
        step === 'source' ? (
          <p className="text-[11.5px] leading-snug text-ink-subtle">
            Every draft lands in the review queue. Nothing runs until you say so.
          </p>
        ) : step === 'scope' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={href({ g: 'source' })}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              <Icon name="arrowRight" size={14} className="rotate-180" />
              Back
            </Link>
            <Link
              href={href({ g: 'drafting' })}
              className={buttonVariants({ variant: 'primary', size: 'sm', className: 'ml-auto' })}
            >
              <Icon name="sparkle" size={14} />
              {source === 'blank' ? 'Draft it' : 'Draft the plans'}
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dashboard/queue"
              className={buttonVariants({ variant: 'primary', size: 'sm' })}
            >
              <Icon name="plan" size={14} />
              Go to the review queue
            </Link>
            <Link
              href={closeHref}
              scroll={false}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              Keep reading
            </Link>
          </div>
        )
      }
    >
      {step === 'source' && (
        <ul className="divide-y divide-rule-soft">
          {DOORS.map((door) => (
            <li key={door.key}>
              <Link
                href={href({ from: door.key, g: 'scope', state: undefined, q: undefined })}
                className="flex items-start gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-app-hover sm:px-5"
              >
                <span className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-rule bg-app text-ink-muted">
                  <Icon name={door.icon} size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[13.5px] font-medium text-ink">{door.label}</span>
                    {door.key === 'changes' && diff && (
                      <Badge variant="count" size="sm" className="nums">
                        {diff.files.length} files
                      </Badge>
                    )}
                    {door.key === 'endpoints' && (
                      <Badge variant="count" size="sm" className="nums">
                        {coverageTotals.none} gaps
                      </Badge>
                    )}
                  </span>
                  <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-muted">
                    {door.hint}
                  </span>
                </span>
                <Icon
                  name="chevronRight"
                  size={14}
                  className="mt-1.5 shrink-0 text-rule-strong"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {step === 'scope' && source === 'changes' && (
        <>
          <Section
            label="History"
            meta={
              <span className="nums font-mono text-[11px] text-ink-subtle">
                {shown.length} of {commits.length}
              </span>
            }
          >
            <div className="px-4 pb-3 sm:px-5">
              <CommitSearch action={href({ q: undefined })} defaultValue={query ?? ''} />
            </div>
            <CommitHistory
              commits={shown}
              all={commits}
              from={from}
              hrefFor={(hash) => href({ since: hash })}
            />
          </Section>

          {diff ? (
            <Section
              label="What that covers"
              meta={
                <span className="nums font-mono text-[11px]">
                  <span className="text-pass">+{diff.additions}</span>{' '}
                  <span className="text-fail">&minus;{diff.deletions}</span>
                </span>
              }
            >
              <div className="px-4 pb-3.5 sm:px-5">
                <p className="flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-ink-subtle">
                  <Icon name="branch" size={12} />
                  {diff.branch}
                  <span aria-hidden="true">·</span>
                  <span className="nums">
                    {diff.commitCount === 1
                      ? `1 commit, ${diff.commit}`
                      : `${diff.commitCount} commits, up to ${diff.commit}`}
                  </span>
                </p>

                <ul className="mt-2.5 flex flex-col gap-1.5">
                  {diff.files.map((file) => (
                    <li key={file.path} className="flex items-center gap-2.5">
                      <Icon name="code" size={13} className="shrink-0 text-ink-subtle" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-muted">
                        {file.path}
                      </span>
                      <span className="nums shrink-0 font-mono text-[11px]">
                        <span className="text-pass">+{file.additions}</span>{' '}
                        <span className="text-fail">&minus;{file.deletions}</span>
                      </span>
                    </li>
                  ))}
                </ul>

                <p className="mt-3 border-t border-rule-soft pt-3 text-[12px] leading-relaxed text-ink-subtle">
                  A change to a shared model or a service method reaches endpoints that never appear
                  in the diff, so GritQA works out what these files affect rather than covering only
                  what is visible here.
                </p>
              </div>
            </Section>
          ) : (
            <div className="p-4 sm:p-5">
              <EmptyState
                size="sm"
                icon="branch"
                title="Nothing has changed since the last read"
                description="Pick a commit above to read from, or choose endpoints by hand."
                action={
                  <Link
                    href={href({ from: 'endpoints', g: 'scope' })}
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                  >
                    <Icon name="endpoint" size={14} />
                    Pick endpoints
                  </Link>
                }
              />
            </div>
          )}
        </>
      )}

      {step === 'scope' && source === 'endpoints' && (
        <>
          <Section label="Which to show">
            {focus && (
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 pb-2.5 text-[12.5px] text-ink-muted sm:px-5">
                <span>
                  Narrowed to{' '}
                  <span className="font-mono text-[11.5px] text-ink">{focus.file}</span>, with{' '}
                  <span className="font-mono text-[11.5px] text-ink">
                    {focus.method} {focus.path}
                  </span>{' '}
                  already picked.
                </span>
                <Link
                  href={href({ only: undefined, state: undefined })}
                  className="font-medium text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
                >
                  Show every file
                </Link>
              </p>
            )}
            <div className="max-w-full overflow-x-auto px-4 pb-3.5 sm:px-5">
              <Segmented
                className="w-max"
                label="Which endpoints to show"
                active={stateFilter}
                options={[
                  {
                    key: 'none',
                    label: 'The gaps',
                    href: href({ state: undefined }),
                    dot: 'bg-rule-strong',
                    count: coverageTotals.none,
                  },
                  {
                    key: 'failing',
                    label: 'Failing',
                    href: href({ state: 'failing' }),
                    dot: 'bg-fail',
                    count: coverageTotals.failing,
                  },
                  {
                    key: 'draft',
                    label: 'In review',
                    href: href({ state: 'draft' }),
                    dot: 'bg-warn',
                    count: coverageTotals.draft,
                  },
                  {
                    key: 'all',
                    label: 'Everything',
                    href: href({ state: 'all' }),
                    count: coverageTotals.total,
                  },
                ]}
              />
            </div>
          </Section>

          {pickable.length === 0 ? (
            <div className="p-4 sm:p-5">
              <EmptyState
                size="sm"
                icon="endpoint"
                title="Nothing in this state"
                description="Try Everything, or come back after the next run."
              />
            </div>
          ) : (
            <EndpointPicker files={pickable} preselected={focus ? [focus.key] : undefined} />
          )}

          <Section label="What shapes the drafts">
            <div className="px-4 pb-3.5 sm:px-5">
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                {activeRules.length} of your rules are on, and every draft follows them — the order
                requests go out in, what gets checked, and what stands in for a third party.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {activeRules.map((rule) => (
                  <Badge key={rule.publicId} variant="count" size="sm">
                    {rule.name}
                  </Badge>
                ))}
              </div>
            </div>
          </Section>
        </>
      )}

      {step === 'scope' && source === 'blank' && (
        <>
          <div className="flex flex-col gap-4 p-4 sm:p-5">
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
                className="w-full resize-y rounded-md border border-rule-strong bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed text-ink transition-colors duration-150 placeholder:text-ink-subtle hover:border-ink-subtle"
              />
            </Field>

            <Field
              label="Where should it run?"
              hint="The address your machine will call. It never leaves your machine."
            >
              <Input dense defaultValue="http://localhost:8080" className="font-mono" />
            </Field>
          </div>

          <Section label="Or start from the gaps">
            <div className="px-4 pb-3.5 sm:px-5">
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                {coverageTotals.none} of your {coverageTotals.total} endpoints have nothing covering
                them. Picking from that list is usually faster than describing a journey from
                scratch.
              </p>
              <Link
                href={href({ from: 'endpoints', g: 'scope' })}
                className={buttonVariants({
                  variant: 'secondary',
                  size: 'sm',
                  className: 'mt-3',
                })}
              >
                <Icon name="endpoint" size={14} />
                Pick from the gaps
              </Link>
            </div>
          </Section>
        </>
      )}

      {step === 'drafting' && (
        <div className="flex flex-col items-center px-4 py-10 text-center sm:px-5">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-rule bg-app text-ink-muted">
            <Icon name="sparkle" size={18} />
          </span>

          <h3 className="mt-3.5 text-[15px] leading-tight font-semibold text-ink">
            Writing the drafts
          </h3>
          <p className="mt-1.5 max-w-[26rem] text-[12.5px] leading-relaxed text-ink-muted">
            {source === 'changes' && diff
              ? diff.commitCount === 1
                ? `Reading one commit and the ${diff.files.length} files it touched.`
                : `Reading ${diff.commitCount} commits and the ${diff.files.length} files they touched.`
              : source === 'endpoints'
                ? 'Working through the endpoints you picked, one plan at a time.'
                : 'Turning your brief into requests, in the order they need to happen.'}
          </p>

          <span
            aria-hidden="true"
            className="mt-5 h-[3px] w-[min(18rem,80%)] overflow-hidden rounded-full bg-rule"
          >
            <span className="animate-handoff block h-full w-full rounded-full bg-ink" />
          </span>

          <p className="mt-5 max-w-[26rem] text-[12px] leading-relaxed text-ink-subtle">
            You will get steps to read, not a finished test. Every draft waits in the review queue
            until you approve it.
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            {(['none', 'draft'] as CoverageState[]).map((state) => (
              <span key={state} className="flex items-center gap-1.5">
                <span className={cn('h-2.5 w-2.5 rounded-[3px]', COVERAGE_FILL[state])} />
                <span className="text-[11.5px] text-ink-muted">{COVERAGE_LABEL[state]}</span>
                <span className="nums text-[11.5px] font-medium text-ink">
                  {coverageTotals[state]}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
