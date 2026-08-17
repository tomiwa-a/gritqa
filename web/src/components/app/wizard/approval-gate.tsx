import { plansAwaitingReview } from '@/lib/mock/data';

const STEPS = [
  { method: 'POST', path: '/quotes', carries: 'quote_id' },
  { method: 'POST', path: '/checkout', carries: 'order_id' },
  { method: 'POST', path: '/pay', carries: null },
];

const METHOD_TONE: Record<string, string> = {
  GET: 'text-series-1',
  POST: 'text-series-2',
  PATCH: 'text-series-3',
  PUT: 'text-series-4',
  DELETE: 'text-series-5',
};

const plan = plansAwaitingReview[0];

export function ApprovalGate() {
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="rounded-lg border border-rule-dark bg-surface-dark-raised p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10.5px] tracking-[0.16em] text-term-dim uppercase">
            plan · draft
          </span>
          <span className="nums font-mono text-[10.5px] text-term-dim">
            {plan.assertionCount} assertions
          </span>
        </div>

        <p className="mt-1.5 text-[12.5px] leading-snug font-medium text-ink-inverse">{plan.name}</p>

        <ul className="mt-3 flex flex-col gap-1.5">
          {STEPS.map((step, i) => (
            <li key={step.path} className="flex items-baseline gap-2 font-mono text-[11px]">
              <span className="nums w-3 shrink-0 text-term-dim">{i + 1}</span>
              <span className={METHOD_TONE[step.method]}>{step.method}</span>
              <span className="truncate text-ink-dim">{step.path}</span>
              {step.carries && (
                <span className="ml-auto shrink-0 text-term-dim">→ {step.carries}</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 flex gap-3">
        <span aria-hidden className="mt-3 w-6 shrink-0 border-t border-l border-rule-dark" style={{ height: 44 }} />

        <div className="min-w-0 flex-1">
          <div className="rounded-lg border border-term-pass/25 bg-term-pass/5 px-3 py-2">
            <p className="font-mono text-[10.5px] tracking-[0.08em] text-term-pass uppercase">
              you approve
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-ink-dim">
              It runs on your machine, against a throwaway database.
            </p>
          </div>

          <div className="mt-2 rounded-lg border border-rule-dark px-3 py-2">
            <p className="font-mono text-[10.5px] tracking-[0.08em] text-term-dim uppercase">
              you do not
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-term-dim">
              It stays a draft. Nothing touches your code.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
