import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { buttonVariants } from '@/components/ui/button';
import { WIZARD_STEPS, stepHref, type WizardStepKey } from './wizard-rail';
import { cn } from '@/lib/cn';

export function WizardStep({
  step,
  title,
  lede,
  visual,
  children,
  os,
}: {
  step: WizardStepKey;
  title: string;
  lede: string;
  visual: React.ReactNode;
  children: React.ReactNode;
  os?: string;
}) {
  const index = WIZARD_STEPS.findIndex((s) => s.key === step);
  const prev = WIZARD_STEPS[index - 1];
  const next = WIZARD_STEPS[index + 1];

  return (
    <section className="overflow-hidden rounded-xl border border-rule bg-app-panel shadow-panel">
      <div className="grid xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 p-5 sm:p-6">
          <p className="nums font-mono text-[11px] tracking-[0.16em] text-ink-subtle uppercase">
            Step {index + 1} of {WIZARD_STEPS.length}
          </p>
          <h2 className="mt-2 text-[21px] leading-tight font-semibold tracking-[-0.02em] text-ink">
            {title}
          </h2>
          <p className="mt-2 max-w-[54ch] text-[13.5px] leading-relaxed text-ink-muted">{lede}</p>

          <div className="mt-5">{children}</div>
        </div>

        <div className="border-t border-rule bg-surface-dark bg-grid-dark p-5 xl:border-t-0 xl:border-l">
          {visual}
        </div>
      </div>

      <footer className="flex items-center gap-2 border-t border-rule bg-app px-5 py-3.5 sm:px-6">
        {prev ? (
          <Link
            href={stepHref(prev.key, os)}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2')}
          >
            <Icon name="arrowRight" size={14} className="rotate-180" />
            Back
          </Link>
        ) : (
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2')}
          >
            Skip setup
          </Link>
        )}

        <span className="nums ml-auto hidden font-mono text-[11.5px] text-ink-subtle sm:block">
          {String(index + 1).padStart(2, '0')} / {String(WIZARD_STEPS.length).padStart(2, '0')}
        </span>

        {next ? (
          <Link
            href={stepHref(next.key, os)}
            className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'ml-auto sm:ml-3')}
          >
            {next.label}
            <Icon name="arrowRight" size={14} />
          </Link>
        ) : (
          <Link
            href="/dashboard/queue"
            className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'ml-auto sm:ml-3')}
          >
            Open the review queue
            <Icon name="arrowRight" size={14} />
          </Link>
        )}
      </footer>
    </section>
  );
}
