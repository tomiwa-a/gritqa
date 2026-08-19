import Link from 'next/link';
import { Modal } from '../modal';
import { CommitHistory } from './commit-history';
import { CommitSearch } from './commit-search';
import { EndpointPicker, type PickerFile } from './endpoint-picker';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { diffFrom, resolveFrom, searchCommits } from '@/lib/commits';
import { endpointKey } from '@/lib/plan';
import { withOverlayParams, type PageParams } from '@/lib/overlay';
import {
  getCommits,
  getCoverage,
  getCoverageTotals,
  getCurrentProject,
  getLastDraftedFrom,
} from '@/lib/data';
import type { CoverageFile } from '@/lib/mock/types';

const SOURCES = ['changes', 'endpoints', 'blank'] as const;
type Source = (typeof SOURCES)[number];

const STEPS = ['source', 'scope', 'drafting'] as const;
type Step = (typeof STEPS)[number];

const STATES = ['none', 'draft', 'failing', 'approved', 'all'] as const;
type StateFilter = (typeof STATES)[number];

/** Hints stay to one line — this box is 30rem wide and every line costs height. */
const DOORS: { key: Source; icon: IconName; label: string; hint: string }[] = [
  {
    key: 'changes',
    icon: 'branch',
    label: 'From what changed',
    hint: 'A commit, and everything since it.',
  },
  {
    key: 'endpoints',
    icon: 'endpoint',
    label: 'Pick endpoints',
    hint: 'Choose from the gaps yourself.',
  },
  {
    key: 'blank',
    icon: 'plan',
    label: 'Describe a journey',
    hint: 'Say what it should prove, in plain words.',
  },
];

const SCOPE_TITLE: Record<Source, string> = {
  changes: 'What moved',
  endpoints: 'Choose what to cover',
  blank: 'Describe the journey',
};

const STEP_NUMBER: Record<Step, number> = { source: 1, scope: 2, drafting: 3 };

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
function findEndpoint(coverage: CoverageFile[], key: string) {
  for (const file of coverage) {
    const endpoint = file.endpoints.find((e) => endpointKey(e) === key);
    if (endpoint) return { key, file: file.file, method: endpoint.method, path: endpoint.path };
  }
  return undefined;
}

function pickerFiles(coverage: CoverageFile[], filter: StateFilter, only?: string[]): PickerFile[] {
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
      <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
        <h3 className="font-mono text-[9.5px] tracking-[0.14em] text-ink-subtle uppercase">
          {label}
        </h3>
        {meta && <span className="ml-auto shrink-0">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

/** Nothing to pick from, said in the body rather than in a box inside a box. */
function Nothing({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 py-10 text-center">
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {children}
    </div>
  );
}

/**
 * Drafting a plan, without losing the page you were reading. Three steps on the
 * URL so the whole thing stays server-rendered and linkable.
 */
export async function GenerateModal({
  params,
  pathname,
  closeHref,
}: {
  params: PageParams;
  pathname: string;
  closeHref: string;
}) {
  const [commits, coverage, coverageTotals, currentProject, lastDraftedFrom] = await Promise.all([
    getCommits(),
    getCoverage(),
    getCoverageTotals(),
    getCurrentProject(),
    getLastDraftedFrom(),
  ]);

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
  const focus = askedOnly ? findEndpoint(coverage, askedOnly) : undefined;
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
        footer={
          <Link
            href="/dashboard/setup"
            className={buttonVariants({ variant: 'primary', size: 'sm' })}
          >
            <Icon name="terminal" size={14} />
            Set up the CLI
          </Link>
        }
      >
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-rule bg-app text-ink-subtle">
            <Icon name="terminal" size={18} />
          </span>
          <p className="text-[13.5px] leading-relaxed text-ink-muted">
            Plans are written from your own routes, so the project has to be read once before
            anything can be drafted. Point the CLI at your repository — it reads the shape and sends
            that up, never the code.
          </p>
        </div>
      </Modal>
    );
  }

  const from = resolveFrom(commits, askedFrom, lastDraftedFrom);
  const diff = diffFrom(commits, from);
  const shown = searchCommits(commits, query);
  const pickable = pickerFiles(coverage, stateFilter, focus ? [focus.file] : undefined);

  return (
    <Modal
      id="generate-modal"
      closeHref={closeHref}
      label="draft plans"
      eyebrow={`Draft plans · Step ${STEP_NUMBER[step]} of 3`}
      title={
        step === 'source'
          ? 'Where should the drafts come from?'
          : step === 'scope'
            ? SCOPE_TITLE[source]
            : 'Writing the drafts'
      }
      progress={{ current: STEP_NUMBER[step], total: 3 }}
      footer={
        step === 'source' ? (
          <p className="text-[11.5px] leading-snug text-ink-subtle">
            Every draft lands in the review queue. Nothing runs until you say so.
          </p>
        ) : step === 'scope' ? (
          <div className="flex items-center gap-2">
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
          <div className="flex items-center gap-2">
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
              className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'ml-auto' })}
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
                className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-app-hover"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-rule bg-app text-ink-muted">
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
                  <span className="mt-0.5 block truncate text-[12px] text-ink-subtle">
                    {door.hint}
                  </span>
                </span>
                <Icon name="chevronRight" size={14} className="shrink-0 text-rule-strong" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {step === 'scope' && source === 'changes' && (
        <>
          <Section
            label="Read from"
            meta={
              <span className="nums font-mono text-[11px] text-ink-subtle">
                {shown.length} of {commits.length}
              </span>
            }
          >
            <div className="px-4 pb-2.5">
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
              <div className="px-4 pb-3">
                <p className="flex flex-wrap items-center gap-x-2 font-mono text-[11.5px] text-ink-subtle">
                  <Icon name="branch" size={12} />
                  {diff.branch}
                  <span aria-hidden="true">·</span>
                  <span className="nums">
                    {diff.commitCount === 1
                      ? `1 commit, ${diff.commit}`
                      : `${diff.commitCount} commits, up to ${diff.commit}`}
                  </span>
                </p>

                <ul className="mt-2 flex flex-col gap-1.5">
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
              </div>
            </Section>
          ) : (
            <Nothing title="Nothing has changed since the last read">
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                Pick an older commit above, or choose endpoints by hand.
              </p>
              <Link
                href={href({ from: 'endpoints', g: 'scope' })}
                className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'mt-1' })}
              >
                <Icon name="endpoint" size={14} />
                Pick endpoints
              </Link>
            </Nothing>
          )}
        </>
      )}

      {step === 'scope' && source === 'endpoints' && (
        <>
          {focus && (
            <p className="flex flex-wrap items-baseline gap-x-2 border-b border-rule-soft px-4 py-2.5 text-[12px] text-ink-muted">
              <span className="font-mono text-[11.5px] text-ink">{focus.file}</span>
              <span>only.</span>
              <Link
                href={href({ only: undefined, state: undefined })}
                className="font-medium text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
              >
                Show every file
              </Link>
            </p>
          )}

          <div className="max-w-full overflow-x-auto border-b border-rule-soft px-4 py-2.5">
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

          {pickable.length === 0 ? (
            <Nothing title="Nothing in this state">
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                Try Everything, or come back after the next run.
              </p>
            </Nothing>
          ) : (
            <EndpointPicker files={pickable} preselected={focus ? [focus.key] : undefined} />
          )}
        </>
      )}

      {step === 'scope' && source === 'blank' && (
        <div className="flex flex-col gap-3.5 p-4">
          <Field label="What should this plan be called?">
            <Input dense placeholder="Refunds never exceed the original charge" />
          </Field>

          <Field
            label="What should it prove?"
            hint="Plain words. This is the whole brief the draft is written from."
          >
            <textarea
              rows={3}
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

          {/* The escape hatch stays a line, not a section. */}
          <p className="text-[12px] text-ink-subtle">
            Or{' '}
            <Link
              href={href({ from: 'endpoints', g: 'scope' })}
              className="font-medium text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
            >
              pick from the {coverageTotals.none} gaps
            </Link>{' '}
            instead — usually faster than describing one.
          </p>
        </div>
      )}

      {step === 'drafting' && (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-rule bg-app text-ink-muted">
            <Icon name="sparkle" size={18} />
          </span>

          <h3 className="mt-3.5 text-[15px] leading-tight font-semibold text-ink">
            Writing the drafts
          </h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">
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
            className="mt-5 h-[3px] w-[min(14rem,80%)] overflow-hidden rounded-full bg-rule"
          >
            <span className="animate-handoff block h-full w-full rounded-full bg-ink" />
          </span>

          <p className="mt-5 text-[12px] leading-relaxed text-ink-subtle">
            You get steps to read, not a finished test. Every draft waits for your approval.
          </p>
        </div>
      )}
    </Modal>
  );
}
