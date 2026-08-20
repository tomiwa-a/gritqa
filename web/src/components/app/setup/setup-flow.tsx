import { StepCard, type StepState } from './step-card';
import { InstallStep, ConnectStep, FirstPlanStep } from './steps';
import { ProviderStep } from './provider-step';
import { cn } from '@/lib/cn';

const BAR: Record<StepState, string> = {
  done: 'bg-pass',
  active: 'bg-ink',
  todo: 'bg-rule-strong',
};

export function SetupFlow({ done, aiKeyMasked }: { done: number; aiKeyMasked: string | null }) {
  const steps = [
    {
      short: 'Install',
      title: 'Install the CLI',
      description: 'One binary. It runs where your code already lives.',
      body: <InstallStep />,
    },
    {
      short: 'Connect',
      title: 'Connect this machine',
      description: 'Point it at a project once and it links itself to your account.',
      body: <ConnectStep />,
    },
    {
      short: 'Provider',
      title: 'Choose who drafts your tests',
      description: 'Bring your own key, or write every plan by hand instead.',
      body: <ProviderStep masked={aiKeyMasked} />,
    },
    {
      short: 'Review',
      title: 'Review what it drafts',
      description: 'Nothing runs until you have read it and said yes.',
      body: <FirstPlanStep />,
    },
  ];

  const stateFor = (index: number): StepState => {
    if (index <= done) return 'done';
    if (index === done + 1) return 'active';
    return 'todo';
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-rule bg-app-panel p-4 shadow-panel">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-medium text-ink">Four steps, about ten minutes</span>
          <span className="nums text-[12px] text-ink-muted">
            {Math.min(done, steps.length)} of {steps.length} done
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
          {steps.map((step, i) => {
            const state = stateFor(i + 1);
            return (
              <div key={step.short} className="flex flex-col gap-1.5">
                <span className={cn('h-1 rounded-full', BAR[state])} />
                <span
                  className={cn(
                    'text-[11.5px]',
                    state === 'todo' ? 'text-ink-subtle' : 'font-medium text-ink',
                  )}
                >
                  {step.short}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {steps.map((step, i) => (
        <StepCard
          key={step.short}
          index={i + 1}
          title={step.title}
          description={step.description}
          state={stateFor(i + 1)}
        >
          {step.body}
        </StepCard>
      ))}
    </div>
  );
}
