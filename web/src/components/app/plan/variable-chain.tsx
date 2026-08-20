import Link from 'next/link';
import { variableChain } from '@/lib/plan';
import type { TestPlanDetail } from '@/lib/model';
import { cn } from '@/lib/cn';

function stepList(indexes: number[]) {
  const n = [...new Set(indexes)].sort((a, b) => a - b).map((i) => i + 1);
  if (n.length === 1) return `step ${n[0]}`;
  return `steps ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

export function VariableChain({
  plan,
  stepHrefFor,
  className,
}: {
  plan: TestPlanDetail;
  stepHrefFor?: (stepId: string) => string;
  className?: string;
}) {
  const links = variableChain(plan);
  if (links.length === 0) return null;

  const columns = plan.steps.length;

  return (
    <div className={className}>
      <div className="border-b border-rule-soft px-4 py-3.5">
        <p className="max-w-[70ch] text-[13px] leading-relaxed text-ink-muted">
          A step can only use a value some earlier step handed it. Read a row left to right: the
          solid dot is the step that produces the value, every ring after it is a step that spends
          it, and the line between them is how long that value has to stay alive.
        </p>
        <p className="mt-2 max-w-[70ch] text-[12.5px] leading-relaxed text-ink-subtle">
          This is what makes the run a journey instead of {columns} unrelated requests — and it is
          why a step that breaks early takes the ones after it down with it.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: 232 + columns * 56 }}>
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-rule-soft bg-app px-4 py-2 text-left text-[10.5px] font-medium tracking-[0.06em] text-ink-subtle uppercase"
              >
                Value
              </th>
              {plan.steps.map((step, i) => {
                const href = stepHrefFor?.(step.id);
                return (
                  <th
                    key={step.id}
                    scope="col"
                    className="w-14 border-b border-rule-soft bg-app py-1.5 text-center"
                  >
                    {href ? (
                      <Link
                        href={href}
                        scroll={false}
                        title={`Open step ${i + 1}: ${step.name}`}
                        className="nums mx-auto flex h-6 w-6 items-center justify-center rounded font-mono text-[10.5px] font-medium text-ink-subtle transition-colors duration-150 hover:bg-app-active hover:text-ink"
                      >
                        {i + 1}
                      </Link>
                    ) : (
                      <span
                        title={step.name}
                        className="nums font-mono text-[10.5px] font-medium text-ink-subtle"
                      >
                        {i + 1}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {links.map((link) => {
              const born = link.origin.kind === 'step' ? link.origin.index : -1;
              const spent = new Set(link.consumers.map((c) => c.index));
              const lastSpent = Math.max(...link.consumers.map((c) => c.index));
              const spentBy = stepList(link.consumers.map((c) => c.index));

              return (
                <tr key={link.name} className="border-b border-rule-soft last:border-b-0">
                  <td className="px-4 py-2.5 align-middle">
                    <p className="font-mono text-[12px] text-punch-red">{link.name}</p>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-ink-subtle">
                      {link.origin.kind === 'seed' ? (
                        <>Set before the run, then spent by {spentBy}.</>
                      ) : (
                        <>
                          Step {born + 1} reads it from{' '}
                          <span className="font-mono text-ink-muted">{link.origin.path}</span>, then{' '}
                          {spentBy} {link.consumers.length === 1 ? 'spends' : 'spend'} it.
                        </>
                      )}
                    </p>
                  </td>

                  {plan.steps.map((step, i) => {
                    const isBirth = i === born;
                    const isSpend = spent.has(i);
                    const inFlight = i > born && i <= lastSpent;

                    return (
                      <td key={step.id} className="relative h-12 text-center align-middle">
                        {inFlight && (
                          <span
                            aria-hidden
                            className="absolute inset-y-0 left-0 my-auto h-px w-full bg-rule-strong"
                          />
                        )}
                        {(isBirth || isSpend) && (
                          <span
                            className={cn(
                              'relative z-10 mx-auto block h-2 w-2 rounded-full',
                              isBirth ? 'bg-punch-red' : 'border border-punch-red bg-app-panel',
                            )}
                          >
                            <span className="sr-only">
                              {isBirth ? 'produced by' : 'used by'} step {i + 1}
                            </span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rule-soft px-4 py-2.5 text-[11.5px] text-ink-subtle">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-punch-red" />
          the step that produces it
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full border border-punch-red bg-app-panel" />
          a step that spends it
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-px w-4 bg-rule-strong" />
          carried between them
        </span>
      </p>
    </div>
  );
}
