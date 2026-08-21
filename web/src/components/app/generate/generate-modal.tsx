import Link from 'next/link';
import { Modal } from '../modal';
import { CommitHistory } from './commit-history';
import { CommitSearch } from './commit-search';
import { DraftForm } from './draft-form';
import { EndpointPicker, type PickerFile } from './endpoint-picker';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
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
  getLastBaseUrl,
  getLastDraftedFrom,
} from '@/lib/data';
import type { CoverageFile } from '@/lib/model';

const SOURCES = ['changes', 'endpoints', 'blank'] as const;
type Source = (typeof SOURCES)[number];

/**
 * Two steps on the URL, not three. Drafting used to be one, which is how the
 * wizard managed to show a progress bar over no work -- a `<Link>` to `g=drafting`
 * cost nothing and looked like everything. It belongs to `DraftForm` now, which is
 * on step three for exactly as long as the agent is reading.
 */
const STEPS = ['source', 'scope'] as const;
type Step = (typeof STEPS)[number];

const STATES = ['none', 'draft', 'failing', 'approved', 'all'] as const;
type StateFilter = (typeof STATES)[number];

/**
 * Hints stay to one line — this box is 30rem wide and every line costs height.
 *
 * `needsIndex` is the honest split. Two of these read what the CLI pushed up: a
 * commit list to pick a range from, an endpoint list to tick. The third reads
 * nothing, because the agent goes and looks while it drafts — so it works on a
 * project the CLI has never indexed, which is every project on its first day.
 */
const DOORS: {
  key: Source;
  icon: IconName;
  label: string;
  hint: string;
  needsIndex: boolean;
}[] = [
  {
    key: 'changes',
    icon: 'branch',
    label: 'From what changed',
    hint: 'A commit, and everything since it.',
    needsIndex: true,
  },
  {
    key: 'endpoints',
    icon: 'endpoint',
    label: 'Pick endpoints',
    hint: 'Choose from the gaps yourself.',
    needsIndex: true,
  },
  {
    key: 'blank',
    icon: 'plan',
    label: 'Describe a journey',
    hint: 'Say what it should prove, in plain words.',
    needsIndex: false,
  },
];

/** `blank` is here to keep the record exhaustive; that step renders its own modal. */
const SCOPE_TITLE: Record<Source, string> = {
  changes: 'What moved',
  endpoints: 'Choose what to cover',
  blank: 'Describe the journey',
};

const STEP_NUMBER: Record<Step, number> = { source: 1, scope: 2 };

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
  const [commits, coverage, coverageTotals, currentProject, lastDraftedFrom, baseUrl] =
    await Promise.all([
      getCommits(),
      getCoverage(),
      getCoverageTotals(),
      getCurrentProject(),
      getLastDraftedFrom(),
      getLastBaseUrl(),
    ]);

  const askedSource = typeof params.from === 'string' ? params.from : undefined;
  const askedStep = typeof params.g === 'string' ? params.g : undefined;
  const askedState = typeof params.state === 'string' ? params.state : undefined;
  const askedFrom = typeof params.since === 'string' ? params.since : undefined;
  const query = typeof params.q === 'string' ? params.q : undefined;
  const askedOnly = typeof params.only === 'string' ? params.only : undefined;

  /**
   * The index gates two of the three doors, not the wizard.
   *
   * It used to gate all of it, which was correct when a draft was assembled from a
   * payload the CLI had already pushed. It is not correct now: the agent researches
   * live through the CLI's tools, so a described journey needs nothing to have been
   * read in advance -- and blocking it meant the one door that works before the
   * first index was the one behind a screen saying nothing could be drafted yet.
   */
  const indexed = currentProject.lastIndexedLabel !== null;
  const source: Source = isSource(askedSource) ? askedSource : indexed ? 'changes' : 'blank';
  const step: Step = isStep(askedStep) ? askedStep : askedSource ? 'scope' : 'source';

  /* Arriving from one endpoint: show its file, with that endpoint already ticked. */
  const focus = askedOnly ? findEndpoint(coverage, askedOnly) : undefined;
  const stateFilter: StateFilter = isState(askedState) ? askedState : focus ? 'all' : 'none';

  const href = (patch: Record<string, string | undefined>) =>
    withOverlayParams(pathname, params, patch);

  /* The one door that needs nothing read first, and the only surface that drafts.
     It owns its own Modal because the submit button and the progress panel sit on
     opposite sides of the footer and both have to know the draft is in flight. */
  if (step === 'scope' && source === 'blank') {
    return (
      <DraftForm
        closeHref={closeHref}
        backHref={href({ g: 'source' })}
        gapsHref={href({ from: 'endpoints', g: 'scope' })}
        gapCount={coverageTotals.none}
        defaultBaseUrl={baseUrl}
        canPickGaps={indexed && coverageTotals.none > 0}
      />
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
      title={step === 'source' ? 'Where should the drafts come from?' : SCOPE_TITLE[source]}
      progress={{ current: STEP_NUMBER[step], total: 3 }}
      footer={
        step === 'source' ? (
          <p className="text-[11.5px] leading-snug text-ink-subtle">
            Every draft lands in the review queue. Nothing runs until you say so.
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <Link
              href={href({ g: 'source' })}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              <Icon name="arrowRight" size={14} className="rotate-180" />
              Back
            </Link>
            {/* Drafting from a diff or from a set of ticked endpoints still has to
                compose the brief for you, and it does not yet. So this goes where
                drafting actually happens rather than to a bar that fills up. */}
            <Link
              href={href({ from: 'blank', g: 'scope' })}
              className={buttonVariants({ variant: 'primary', size: 'sm', className: 'ml-auto' })}
            >
              <Icon name="sparkle" size={14} />
              Describe it instead
            </Link>
          </div>
        )
      }
    >
      {step === 'source' && (
        <ul className="divide-y divide-rule-soft">
          {DOORS.map((door) => {
            /* A door that reads an index nobody has written yet stays visible and stops
               being a link. Hiding it would leave the wizard looking like it only ever
               had one way in; a link to an empty picker would be a dead end wearing a
               chevron. The hint says which thing is missing instead. */
            const shut = door.needsIndex && !indexed;
            const body = (
              <>
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-app',
                    shut ? 'border-rule-soft text-rule-strong' : 'border-rule text-ink-muted',
                  )}
                >
                  <Icon name={door.icon} size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-[13.5px] font-medium',
                        shut ? 'text-ink-subtle' : 'text-ink',
                      )}
                    >
                      {door.label}
                    </span>
                    {!shut && door.key === 'changes' && diff && (
                      <Badge variant="count" size="sm" className="nums">
                        {diff.files.length} files
                      </Badge>
                    )}
                    {!shut && door.key === 'endpoints' && (
                      <Badge variant="count" size="sm" className="nums">
                        {coverageTotals.none} gaps
                      </Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-ink-subtle">
                    {shut ? 'Needs the CLI to read your code first.' : door.hint}
                  </span>
                </span>
                {!shut && (
                  <Icon name="chevronRight" size={14} className="shrink-0 text-rule-strong" />
                )}
              </>
            );

            return (
              <li key={door.key}>
                {shut ? (
                  <span className="flex items-center gap-3 px-4 py-3">{body}</span>
                ) : (
                  <Link
                    href={href({ from: door.key, g: 'scope', state: undefined, q: undefined })}
                    className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-app-hover"
                  >
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
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
    </Modal>
  );
}
