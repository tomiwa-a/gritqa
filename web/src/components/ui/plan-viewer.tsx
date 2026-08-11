import { cn } from '@/lib/cn';
import { MethodBadge, type Method } from './method-badge';
import { Leader } from './rule';

export type PlanStep = {
  id: string;
  name: string;
  method: Method;
  path: string;
  /** Variables pulled out of the response for later steps. */
  extract?: { name: string; from: string }[];
  /** Assertions run against the response. */
  assert?: string[];
  /** Variables consumed from earlier steps — renders the chaining. */
  uses?: string[];
  status?: 'pass' | 'fail' | 'skip' | 'draft';
};

const STATUS = {
  pass: { label: 'pass', cls: 'text-pass' },
  fail: { label: 'fail', cls: 'text-fail' },
  skip: { label: 'skip', cls: 'text-skip' },
  draft: { label: 'draft', cls: 'text-ink-subtle' },
} as const;

/**
 * Renders a generated test plan the way the product actually stores it —
 * ordered steps, extracted variables, assertions, and the chaining between
 * them. This is the artifact the product is selling, so it gets a real
 * component rather than a screenshot.
 */
export function PlanViewer({
  name,
  steps,
  duration,
  className,
}: {
  name: string;
  steps: PlanStep[];
  duration?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-rule bg-surface',
        'shadow-[0_1px_2px_rgba(27,29,46,0.05),0_16px_40px_-28px_rgba(27,29,46,0.22)]',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-rule bg-surface-sunken px-4 py-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-subtle">
          plan
        </span>
        <span className="truncate text-sm font-medium text-ink">{name}</span>
        <span className="nums ml-auto shrink-0 font-mono text-[11px] text-ink-subtle">
          {steps.length} steps{duration && ` · ${duration}`}
        </span>
      </div>

      {/* Steps */}
      <ol className="divide-y divide-rule">
        {steps.map((step, i) => (
          <li key={step.id} className="px-4 py-3.5">
            <div className="flex items-center gap-3">
              <span className="nums shrink-0 font-mono text-[11px] text-ink-subtle">
                {String(i + 1).padStart(2, '0')}
              </span>
              <MethodBadge method={step.method} />
              <span className="truncate font-mono text-[12.5px] text-ink">{step.path}</span>
              {step.status && (
                <span
                  className={cn(
                    'ml-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.14em]',
                    STATUS[step.status].cls,
                  )}
                >
                  {STATUS[step.status].label}
                </span>
              )}
            </div>

            {/* Detail rail, indented to align under the method badge */}
            {(step.uses || step.extract || step.assert) && (
              <dl className="mt-2.5 space-y-1 pl-[2.4rem] text-[12px]">
                {step.uses?.map((u) => (
                  <div key={u} className="flex items-baseline">
                    <dt className="font-mono text-ink-subtle">uses</dt>
                    <Leader />
                    <dd className="font-mono text-punch-red">{`{{${u}}}`}</dd>
                  </div>
                ))}
                {step.extract?.map((e) => (
                  <div key={e.name} className="flex items-baseline">
                    <dt className="font-mono text-ink-subtle">extract</dt>
                    <Leader />
                    <dd className="font-mono text-ink-muted">
                      <span className="text-punch-red">{e.name}</span>
                      <span className="text-ink-subtle"> ← </span>
                      {e.from}
                    </dd>
                  </div>
                ))}
                {step.assert?.map((a) => (
                  <div key={a} className="flex items-baseline">
                    <dt className="font-mono text-ink-subtle">assert</dt>
                    <Leader />
                    <dd className="font-mono text-ink-muted">{a}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
