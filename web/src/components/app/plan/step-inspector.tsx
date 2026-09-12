import Link from 'next/link';
import { StepBadge } from '@/components/ui/step-badge';
import { Icon } from '@/components/ui/icon';
import { Fence, Prose } from '@/components/ui/prose';
import { Badge } from '@/components/ui/badge';
import { Drawer, DrawerBlock } from '../drawer';
import { CheckNote } from './step-checks';
import { assertionPredicate, assertionTarget, stepKindOf, variablesUsedBy } from '@/lib/plan';
import type { PlanFailureSeed, PlanStepSpec, StepCheck, StepKind } from '@/lib/model';

/**
 * What the block holding the payload is called, per kind. Three words rather than one
 * generic one: a reader scanning the drawer for what this step will actually do is
 * looking for the noun, and "Payload" is a noun about the format instead.
 */
const BLOCK: Record<StepKind, string> = {
  http: 'Request',
  sql: 'Statement',
  shell: 'Command',
};

/** The language the payload is coloured as. Both are in `langOf`'s six. */
const LANG: Record<'sql' | 'shell', string> = { sql: 'sql', shell: 'bash' };

function Pairs({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="flex flex-col gap-1.5">
      {rows.map(([key, value]) => (
        <div key={key} className="flex gap-2.5 font-mono text-[11px]">
          <dt className="w-[6.5rem] shrink-0 truncate text-ink-subtle">{key}</dt>
          <dd className="min-w-0 flex-1 break-all text-ink-muted">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-rule-dark bg-surface-dark px-3 py-2.5 font-mono text-[11px] leading-[1.7] text-ink-inverse/80">
      <code>{JSON.stringify(value, null, 2)}</code>
    </pre>
  );
}

function Step({ href, dir }: { href?: string; dir: 'prev' | 'next' }) {
  const label = dir === 'prev' ? 'Previous step' : 'Next step';
  const chevron = (
    <Icon name="chevronRight" size={13} className={dir === 'prev' ? 'rotate-180' : undefined} />
  );

  if (!href) {
    return (
      <span
        aria-hidden
        className="flex h-6 w-6 items-center justify-center rounded text-ink-subtle/35"
      >
        {chevron}
      </span>
    );
  }

  return (
    <Link
      href={href}
      scroll={false}
      aria-label={label}
      title={label}
      className="flex h-6 w-6 items-center justify-center rounded text-ink-subtle transition-colors duration-150 hover:bg-app-hover hover:text-ink"
    >
      {chevron}
    </Link>
  );
}

export function StepInspector({
  step,
  index,
  total,
  closeHref,
  prevHref,
  nextHref,
  failure,
  check,
  planPublicId,
}: {
  step: PlanStepSpec;
  index: number;
  total: number;
  closeHref: string;
  prevHref?: string;
  nextHref?: string;
  failure?: PlanFailureSeed | null;
  check?: StepCheck;
  planPublicId: string;
}) {
  const broke = failure?.stepId === step.id;
  const uses = variablesUsedBy(step);
  const kind = stepKindOf(step);
  /* Optional chained, and that is the fix rather than a refinement of it: these two
     lines read `step.request.headers` before anything had established there was a
     request, so opening any step that was not one took the drawer down with it. */
  const request = step.request;
  const headers = Object.entries(request?.headers ?? {}) as [string, string][];
  const query = Object.entries(request?.query ?? {}) as [string, string][];
  const run = kind === 'sql' ? step.action?.statement : step.action?.command;

  return (
    <Drawer
      id="step-inspector"
      closeHref={closeHref}
      label={`Step ${index + 1} of ${total}: ${step.name}`}
      eyebrow={`step ${index + 1} / ${total}`}
      title={step.name}
      nav={
        <span className="mt-1 flex shrink-0 items-center gap-0.5">
          <Step href={prevHref} dir="prev" />
          <Step href={nextHref} dir="next" />
        </span>
      }
    >
      {broke && (
        <div className="flex gap-2.5 border-b border-fail/20 bg-fail-soft/50 px-4 py-3">
          <Icon name="alert" size={14} className="mt-px shrink-0 text-fail" />
          <div className="min-w-0">
            <p className="text-[12.5px] leading-snug font-medium text-ink">
              v{failure.version} failed on this step, {failure.whenLabel.toLowerCase()}
            </p>
            <p className="mt-1 font-mono text-[11px] text-ink-muted">
              expected {failure.expected} · got {failure.actual}
            </p>
          </div>
        </div>
      )}

      <CheckNote check={check} planPublicId={planPublicId} />

      <DrawerBlock label="What it does">
        <Prose>{step.description}</Prose>
      </DrawerBlock>

      <DrawerBlock label={BLOCK[kind]}>
        <div className="flex flex-wrap items-center gap-2">
          <StepBadge kind={kind} method={request?.method} />
          {request ? (
            <span className="min-w-0 break-all font-mono text-[11.5px] text-ink">
              {request.url}
            </span>
          ) : (
            <span className="text-[11.5px] text-ink-muted">
              {kind === 'shell'
                ? "Runs in GritQA's own container, with the project mounted"
                : step.action?.target === 'setup'
                  ? "Writes, against GritQA's own copy of the database"
                  : "Reads GritQA's own copy of the database for evidence"}
            </span>
          )}
        </div>

        {/* Verbatim and coloured, not collapsed to one line the way the spine shows it.
            This is the drawer somebody opens to read what will run before they approve
            it, so a statement's line breaks are part of what they are reading. */}
        {kind !== 'http' && run && <Fence code={run} tag={LANG[kind]} />}

        {query.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] text-ink-subtle">Query</p>
            <Pairs rows={query} />
          </div>
        )}
      </DrawerBlock>

      {headers.length > 0 && (
        <DrawerBlock label="Headers">
          <Pairs rows={headers} />
        </DrawerBlock>
      )}

      {request?.body && (
        <DrawerBlock label="Body">
          <Json value={request.body} />
        </DrawerBlock>
      )}

      {uses.length > 0 && (
        <DrawerBlock label="Values it spends">
          <ul className="flex flex-wrap gap-1.5">
            {uses.map((name) => (
              <li
                key={name}
                className="rounded border border-punch-red/25 bg-fail-soft/60 px-1.5 py-0.5 font-mono text-[11px] text-punch-red"
              >
                {`{{${name}}}`}
              </li>
            ))}
          </ul>
        </DrawerBlock>
      )}

      {step.extract.length > 0 && (
        <DrawerBlock label="Values it produces">
          <dl className="flex flex-col gap-2">
            {step.extract.map((e) => (
              <div
                key={e.name}
                className="flex flex-wrap items-baseline gap-x-2 font-mono text-[11px]"
              >
                <dt className="text-punch-red">{e.name}</dt>
                <dd className="min-w-0 break-all text-ink-muted">
                  <span className="text-ink-subtle">← </span>
                  {e.path}
                  <span className="text-ink-subtle"> ({e.source})</span>
                </dd>
              </div>
            ))}
          </dl>
        </DrawerBlock>
      )}

      <DrawerBlock label="Checks" meta={String(step.assertions.length)}>
        <ul className="flex flex-col gap-2">
          {step.assertions.map((a, i) => (
            <li key={i} className="flex items-baseline gap-2">
              <Icon name="check" size={12} className="mt-1 text-pass" />
              <span className="min-w-0 text-[12px] leading-snug text-ink-muted">
                <span className="font-mono break-all text-ink">{assertionTarget(a)}</span>{' '}
                {assertionPredicate(a)}
              </span>
            </li>
          ))}
        </ul>
      </DrawerBlock>

      <DrawerBlock label="If it fails">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={step.onFailure === 'abort' ? 'fail' : 'warn'} size="sm">
            {step.onFailure === 'abort' ? 'Stop the run' : 'Carry on'}
          </Badge>
          {step.retry && step.retry.maxAttempts > 1 ? (
            <span className="nums text-[11.5px] text-ink-muted">
              after {step.retry.maxAttempts} attempts, {step.retry.delayMs}ms apart
            </span>
          ) : (
            <span className="text-[11.5px] text-ink-muted">no retry</span>
          )}
        </div>
        {step.dependsOn.length > 0 && (
          <p className="nums mt-2.5 text-[11.5px] leading-snug text-ink-subtle">
            Skipped if step{step.dependsOn.length > 1 ? 's' : ''}{' '}
            {step.dependsOn.map((d) => d.replace('s', '')).join(', ')} never got there.
          </p>
        )}
      </DrawerBlock>
    </Drawer>
  );
}
