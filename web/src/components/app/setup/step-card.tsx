import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

export type StepState = 'done' | 'active' | 'todo';

const MARK: Record<StepState, string> = {
  done: 'border-pass bg-pass text-white',
  active: 'border-ink bg-ink text-ink-inverse',
  todo: 'border-rule-strong bg-app text-ink-subtle',
};

const NOTE: Record<StepState, string | null> = {
  done: 'Done',
  active: 'You are here',
  todo: null,
};

export function StepCard({
  index,
  title,
  description,
  state,
  children,
}: {
  index: number;
  title: string;
  description: string;
  state: StepState;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-xl border bg-app-panel shadow-panel',
        state === 'active' ? 'border-ink/15' : 'border-rule',
      )}
    >
      <header className="flex items-start gap-3 border-b border-rule-soft px-4 py-3.5">
        <span
          className={cn(
            'nums mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[12px] font-semibold',
            MARK[state],
          )}
        >
          {state === 'done' ? <Icon name="check" size={13} strokeWidth={2.2} /> : index}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-medium text-ink">{title}</h3>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-muted">{description}</p>
        </div>

        {NOTE[state] && (
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
              state === 'done' ? 'bg-pass-soft text-pass' : 'bg-app-active text-ink-muted',
            )}
          >
            {NOTE[state]}
          </span>
        )}
      </header>

      <div className="p-4">{children}</div>
    </section>
  );
}
