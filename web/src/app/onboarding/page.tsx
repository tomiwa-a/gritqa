import Link from 'next/link';
import { Wordmark } from '@/components/ui/wordmark';
import { Icon } from '@/components/ui/icon';
import { buttonVariants } from '@/components/ui/button';
import { SetupFlow } from '@/components/app/setup/setup-flow';
import { user } from '@/lib/mock/data';
import { cn } from '@/lib/cn';

export const metadata = {
  title: 'Set up GritQA',
  description: 'Install the CLI, connect your project, and approve your first plan.',
  robots: { index: false },
};

export default function OnboardingPage() {
  return (
    <div className="min-h-screen bg-app">
      <header className="sticky top-0 z-30 border-b border-rule bg-app-panel">
        <div className="mx-auto flex h-14 max-w-[1000px] items-center gap-3 px-4 sm:px-6">
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

      <main id="main" className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6 sm:py-10">
        <p className="text-[12px] font-medium tracking-[0.14em] text-ink-subtle uppercase">
          Welcome, {user.name.split(' ')[0]}
        </p>
        <h1 className="mt-2 text-[26px] leading-tight font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
          Let us get GritQA reading your code.
        </h1>
        <p className="mt-2.5 max-w-[58ch] text-[14px] leading-relaxed text-ink-muted">
          Your tests run on your machine, against your database, from a plan you have read. The CLI
          is the piece that does that — everything below sets it up once.
        </p>

        <div className="mt-7">
          <SetupFlow done={0} />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule bg-app-panel px-4 py-3.5 shadow-panel">
          <p className="text-[12.5px] text-ink-muted">
            You can leave and come back — the dashboard keeps these steps under CLI setup.
          </p>
          <Link
            href="/dashboard"
            className={buttonVariants({ variant: 'primary', size: 'sm' })}
          >
            Go to the dashboard
            <Icon name="arrowRight" size={14} />
          </Link>
        </div>
      </main>
    </div>
  );
}
