import { variableChain } from '@/lib/plan';
import type { TestPlanDetail } from '@/lib/mock/types';
import { cn } from '@/lib/cn';

export function VariableChain({ plan, className }: { plan: TestPlanDetail; className?: string }) {
  const links = variableChain(plan);
  if (links.length === 0) return null;

  const columns = plan.steps.length;

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse" style={{ minWidth: 120 + columns * 64 }}>
        <thead>
          <tr>
            <th
              scope="col"
              className="border-b border-rule-soft bg-app px-4 py-2 text-left text-[10.5px] font-medium tracking-[0.06em] text-ink-subtle uppercase"
            >
              Value
            </th>
            {plan.steps.map((step, i) => (
              <th
                key={step.id}
                scope="col"
                title={step.name}
                className="nums w-16 border-b border-rule-soft bg-app py-2 font-mono text-[10.5px] font-medium text-ink-subtle"
              >
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {links.map((link) => {
            const born = link.origin.kind === 'step' ? link.origin.index : -1;
            const spent = new Set(link.consumers.map((c) => c.index));
            const lastSpent = Math.max(...link.consumers.map((c) => c.index));

            return (
              <tr key={link.name} className="border-b border-rule-soft last:border-b-0">
                <td className="px-4 py-2.5 align-middle">
                  <p className="font-mono text-[12px] text-punch-red">{link.name}</p>
                  <p className="mt-0.5 font-mono text-[10.5px] text-ink-subtle">
                    {link.origin.kind === 'seed'
                      ? 'set before the run'
                      : `step ${born + 1} · ${link.origin.path}`}
                  </p>
                </td>

                {plan.steps.map((step, i) => {
                  const isBirth = i === born;
                  const isSpend = spent.has(i);
                  const inFlight = i > born && i <= lastSpent;

                  return (
                    <td key={step.id} className="relative h-11 text-center align-middle">
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

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[11.5px] text-ink-subtle">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-punch-red" />
          produced here
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full border border-punch-red bg-app-panel" />
          used here
        </span>
      </p>
    </div>
  );
}
