import Link from 'next/link';
import { Wordmark } from '@/components/ui/wordmark';
import { Icon } from '@/components/ui/icon';
import { buttonVariants } from '@/components/ui/button';
import { WizardRail, WIZARD_STEPS, type WizardStepKey } from '@/components/app/wizard/wizard-rail';
import { WizardStep } from '@/components/app/wizard/wizard-step';
import { MachineDiagram } from '@/components/app/wizard/machine-diagram';
import { WaitingBeacon } from '@/components/app/wizard/waiting-beacon';
import { ApprovalGate } from '@/components/app/wizard/approval-gate';
import { StepInstall } from '@/components/app/wizard/step-install';
import { StepConnect } from '@/components/app/wizard/step-connect';
import { StepReview } from '@/components/app/wizard/step-review';
import { OS_KEYS, type OsKey } from '@/components/app/wizard/platform-picker';
import { user } from '@/lib/mock/data';
import { cn } from '@/lib/cn';

export const metadata = {
  title: 'Set up GritQA',
  description: 'Install the CLI, connect your project, and approve your first plan.',
  robots: { index: false },
};

const COPY: Record<WizardStepKey, { title: string; lede: string }> = {
  install: {
    title: 'Put the CLI on your machine',
    lede: 'One binary. It reads your code and runs your tests where your code already lives — nothing is uploaded to us to be executed.',
  },
  connect: {
    title: 'Point it at a project',
    lede: 'Run it once inside a repo. It learns your routes, handlers, and models, then reports back here so both sides are looking at the same project.',
  },
  review: {
    title: 'Nothing runs until you approve it',
    lede: 'Plans arrive as drafts. You read what a plan would send and what it would assert, then approve it or leave it sitting there.',
  },
};

const VISUAL: Record<WizardStepKey, React.ReactNode> = {
  install: <MachineDiagram />,
  connect: <WaitingBeacon />,
  review: <ApprovalGate />,
};

function stepFrom(value: string | undefined): WizardStepKey {
  return WIZARD_STEPS.some((s) => s.key === value) ? (value as WizardStepKey) : 'install';
}

function osFrom(value: string | undefined): OsKey {
  return OS_KEYS.includes(value as OsKey) ? (value as OsKey) : 'mac';
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; os?: string }>;
}) {
  const params = await searchParams;
  const step = stepFrom(params.step);
  const os = osFrom(params.os);

  return (
    <div className="min-h-screen bg-app">
      <header className="sticky top-0 z-30 border-b border-rule bg-app-panel">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-3 px-4 sm:px-6">
          <Wordmark />
          <span className="ml-auto hidden items-center gap-1.5 text-[12.5px] text-ink-muted sm:flex">
            <Icon name={user.provider} size={13} className="text-ink-subtle" />
            {user.email}
          </span>
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: 'ghost', size: 'xs' }), 'sm:ml-3')}
          >
            Skip for now
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6 sm:py-10">
        <p className="text-[12px] font-medium tracking-[0.14em] text-ink-subtle uppercase">
          Welcome, {user.name.split(' ')[0]}
        </p>
        <h1 className="mt-2 text-[26px] leading-tight font-semibold tracking-[-0.025em] text-ink sm:text-[29px]">
          Three things, then you are running tests.
        </h1>

        <div className="mt-7 grid gap-6 lg:grid-cols-[196px_minmax(0,1fr)] lg:gap-8">
          <WizardRail active={step} os={os} />

          <div className="min-w-0">
            <WizardStep step={step} os={os} {...COPY[step]} visual={VISUAL[step]}>
              {step === 'install' && (
                <StepInstall os={os} hrefFor={(next) => `/onboarding?step=install&os=${next}`} />
              )}
              {step === 'connect' && <StepConnect />}
              {step === 'review' && <StepReview />}
            </WizardStep>

            <p className="mt-4 text-[12px] leading-snug text-ink-subtle">
              You can leave and come back — this page remembers nothing you have to redo, and the
              dashboard keeps a link to it.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
