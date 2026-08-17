import Link from 'next/link';
import { MethodBadge } from '@/components/ui/method-badge';
import { Icon } from '@/components/ui/icon';
import { Badge } from '@/components/ui/badge';
import { PanelDismiss } from './panel-dismiss';
import { assertionPredicate, assertionTarget, variablesUsedBy } from '@/lib/plan';
import type { PlanFailureSeed, PlanStepSpec } from '@/lib/mock/types';
import { cn } from '@/lib/cn';

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-rule-soft px-4 py-3.5 first:border-t-0">
      <h4 className="font-mono text-[10.5px] tracking-[0.12em] text-ink-subtle uppercase">
        {label}
      </h4>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function Pairs({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="flex flex-col gap-1.5">
      {rows.map(([key, value]) => (
        <div key={key} className="flex gap-3 font-mono text-[11.5px]">
          <dt className="w-[9rem] shrink-0 truncate text-ink-subtle">{key}</dt>
          <dd className="min-w-0 flex-1 break-all text-ink-muted">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-rule-dark bg-surface-dark px-3.5 py-3 font-mono text-[11.5px] leading-[1.7] text-ink-inverse/80">
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
}: {
  step: PlanStepSpec;
  index: number;
  total: number;
  closeHref: string;
  prevHref?: string;
  nextHref?: string;
  failure?: PlanFailureSeed | null;
}) {
  const broke = failure?.stepId === step.id;
  const uses = variablesUsedBy(step);
  const headers = Object.entries(step.request.headers ?? {}) as [string, string][];
  const query = Object.entries(step.request.query ?? {}) as [string, string][];

  return (
    <div className="fixed inset-0 z-40">
      <PanelDismiss closeHref={closeHref} label="Close step details" />

      <aside
        aria-label={`Step ${index + 1}: ${step.name}`}
        className={cn(
          'absolute inset-y-0 right-0 flex w-full flex-col overflow-hidden',
          'border-l border-rule bg-app-panel shadow-menu',
          'sm:w-[min(30rem,92vw)] sm:rounded-l-xl',
        )}
      >
        <header className="shrink-0 border-b border-rule">
          <div className="flex items-center gap-1 px-3 pt-2.5">
            <span className="nums font-mono text-[10.5px] tracking-[0.12em] text-ink-subtle uppercase">
              step {index + 1} / {total}
            </span>
            <span className="ml-auto flex items-center gap-0.5">
              <Step href={prevHref} dir="prev" />
              <Step href={nextHref} dir="next" />
              <Link
                href={closeHref}
                scroll={false}
                aria-label="Close step details"
                className="ml-1 flex h-6 w-6 items-center justify-center rounded text-ink-subtle transition-colors duration-150 hover:bg-app-hover hover:text-ink"
              >
                <Icon name="close" size={14} />
              </Link>
            </span>
          </div>

          <div className="flex items-start gap-3 px-4 pt-1.5 pb-3.5">
            <span className="nums mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-rule bg-app font-mono text-[11px] text-ink-subtle">
              {index + 1}
            </span>
            <p className="min-w-0 flex-1 text-[13.5px] leading-snug font-medium text-ink">
              {step.name}
            </p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {broke && (
            <div className="flex gap-2.5 border-b border-fail/20 bg-fail-soft/50 px-4 py-3">
              <Icon name="alert" size={14} className="mt-px shrink-0 text-fail" />
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-ink">
                  v{failure.version} failed on this step, {failure.whenLabel.toLowerCase()}
                </p>
                <p className="mt-1 font-mono text-[11.5px] text-ink-muted">
                  expected {failure.expected} · got {failure.actual}
                </p>
              </div>
            </div>
          )}

          <Block label="What it does">
            <p className="text-[13px] leading-relaxed text-ink-muted">{step.description}</p>
          </Block>

          <Block label="Request">
            <div className="flex flex-wrap items-center gap-2.5">
              <MethodBadge method={step.request.method} />
              <span className="min-w-0 break-all font-mono text-[12px] text-ink">
                {step.request.url}
              </span>
            </div>
            {query.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] text-ink-subtle">Query</p>
                <Pairs rows={query} />
              </div>
            )}
          </Block>

          {headers.length > 0 && (
            <Block label="Headers">
              <Pairs rows={headers} />
            </Block>
          )}

          {step.request.body && (
            <Block label="Body">
              <Json value={step.request.body} />
            </Block>
          )}

          {uses.length > 0 && (
            <Block label="Values it spends">
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
            </Block>
          )}

          {step.extract.length > 0 && (
            <Block label="Values it produces">
              <dl className="flex flex-col gap-2">
                {step.extract.map((e) => (
                  <div key={e.name} className="flex flex-wrap items-baseline gap-x-2 font-mono text-[11.5px]">
                    <dt className="text-punch-red">{e.name}</dt>
                    <dd className="text-ink-muted">
                      <span className="text-ink-subtle">← </span>
                      {e.path}
                      <span className="text-ink-subtle"> ({e.source})</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </Block>
          )}

          <Block label={`Checks (${step.assertions.length})`}>
            <ul className="flex flex-col gap-2">
              {step.assertions.map((a, i) => (
                <li key={i} className="flex items-baseline gap-2.5">
                  <Icon name="check" size={12} className="mt-1 shrink-0 text-pass" />
                  <span className="min-w-0 text-[12.5px] text-ink-muted">
                    <span className="font-mono text-ink">{assertionTarget(a)}</span>{' '}
                    {assertionPredicate(a)}
                  </span>
                </li>
              ))}
            </ul>
          </Block>

          <Block label="If it fails">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={step.onFailure === 'abort' ? 'fail' : 'warn'} size="sm">
                {step.onFailure === 'abort' ? 'Stop the run' : 'Carry on'}
              </Badge>
              {step.retry && step.retry.maxAttempts > 1 ? (
                <span className="nums text-[12px] text-ink-muted">
                  after {step.retry.maxAttempts} attempts, {step.retry.delayMs}ms apart
                </span>
              ) : (
                <span className="text-[12px] text-ink-muted">no retry</span>
              )}
            </div>
            {step.dependsOn.length > 0 && (
              <p className="nums mt-2.5 text-[12px] text-ink-subtle">
                Skipped if step{step.dependsOn.length > 1 ? 's' : ''}{' '}
                {step.dependsOn.map((d) => d.replace('s', '')).join(', ')} never got there.
              </p>
            )}
          </Block>
        </div>
      </aside>
    </div>
  );
}
