import Link from 'next/link';
import { Topbar } from '@/components/app/topbar';
import { PageBody } from '@/components/app/page-body';
import { EmptyState } from '@/components/app/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

/**
 * What every project-scoped page renders when the signed-in developer owns no
 * project yet. The shell and its nav still load around it — this replaces only
 * the page body, so Skip lands on a dashboard that explains itself instead of
 * bouncing back to onboarding.
 *
 * Projects are born on the CLI: run it once in a repo and approve the pairing.
 * Nothing in the browser inserts a project row, so the call to action points at
 * setup, which is the page that teaches exactly that.
 */
export function NoProjectGate({ icon, title }: { icon: IconName; title: string }) {
  return (
    <>
      <Topbar icon={icon} title={title} />
      <PageBody>
        <EmptyState
          icon="projects"
          title="Create a project first"
          description="GritQA works from inside a repository. Run the CLI once in your project folder and approve the pairing here — then this page has something to show."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link
                href="/dashboard/setup"
                className={cn(buttonVariants({ variant: 'accent', size: 'sm' }))}
              >
                <Icon name="terminal" size={14} />
                Connect your first repo
              </Link>
              <Link
                href="/onboarding"
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
              >
                Back to setup guide
              </Link>
            </div>
          }
        />
      </PageBody>
    </>
  );
}
