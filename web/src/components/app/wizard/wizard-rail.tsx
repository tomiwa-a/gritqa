import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

export type WizardStepKey = 'install' | 'connect' | 'review';

export const WIZARD_STEPS: { key: WizardStepKey; label: string; hint: string }[] = [
  { key: 'install', label: 'Install the CLI', hint: 'One binary on your machine' },
  { key: 'connect', label: 'Connect a project', hint: 'It reads your routes' },
  { key: 'review', label: 'Review a plan', hint: 'You decide what runs' },
];

export function stepHref(key: WizardStepKey, os?: string) {
  return os ? `/onboarding?step=${key}&os=${os}` : `/onboarding?step=${key}`;
}

export function WizardRail({ active, os }: { active: WizardStepKey; os?: string }) {
  const index = WIZARD_STEPS.findIndex((s) => s.key === active);

  return (
    <nav aria-label="Setup steps" className="lg:sticky lg:top-6">
      <ol className="hidden lg:flex lg:flex-col">
        {WIZARD_STEPS.map((step, i) => {
          const done = i < index;
          const on = i === index;
          const last = i === WIZARD_STEPS.length - 1;

          return (
            <li key={step.key} className="relative flex gap-3 pb-6 last:pb-0">
              {!last && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-7 left-[13px] w-px',
                    'h-[calc(100%-1.75rem)]',
                    done ? 'bg-pass' : 'bg-rule',
                  )}
                />
              )}

              <Link
                href={stepHref(step.key, os)}
                aria-current={on ? 'step' : undefined}
                className="group flex min-w-0 flex-1 gap-3"
              >
                <span
                  className={cn(
                    'nums relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11.5px] font-semibold',
                    done && 'border-pass bg-pass text-white',
                    on && 'border-ink bg-ink text-ink-inverse',
                    !done && !on && 'border-rule-strong bg-app-panel text-ink-subtle',
                  )}
                >
                  {done ? <Icon name="check" size={13} strokeWidth={2.2} /> : i + 1}
                </span>

                <span className="min-w-0 pt-1">
                  <span
                    className={cn(
                      'block text-[13px] leading-tight transition-colors duration-150',
                      on ? 'font-medium text-ink' : 'text-ink-muted group-hover:text-ink',
                    )}
                  >
                    {step.label}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-tight text-ink-subtle">
                    {step.hint}
                  </span>
                </span>
              </Link>

              {on && (
                <span
                  aria-hidden
                  className="absolute top-3 -left-3 h-4 w-[2px] rounded-full bg-punch-red"
                />
              )}
            </li>
          );
        })}
      </ol>

      <ol className="flex gap-1.5 lg:hidden">
        {WIZARD_STEPS.map((step, i) => (
          <li key={step.key} className="flex-1">
            <Link href={stepHref(step.key, os)} className="block">
              <span
                className={cn(
                  'block h-1 rounded-full',
                  i < index ? 'bg-pass' : i === index ? 'bg-ink' : 'bg-rule-strong',
                )}
              />
              <span
                className={cn(
                  'mt-1.5 block truncate text-[11px]',
                  i === index ? 'font-medium text-ink' : 'text-ink-subtle',
                )}
              >
                {step.label}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
