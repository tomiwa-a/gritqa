import { AppShell } from '@/components/app/app-shell';
import { MachinePulse } from '@/components/app/machine-pulse';
import { shellDataOf } from '@/components/app/shell-data';
import {
  getCurrentProjectOrNull,
  getMachineStatus,
  getPlansAwaitingReview,
  getProjects,
  getUser,
} from '@/lib/data';
import { currentScope } from '@/lib/db/scope';
import { workRunning } from '@/lib/db/work';

/**
 * The shell is a client island — it holds the collapse and mobile-nav state — so
 * the reading happens here, once per navigation, and goes down as one prop.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  /* `currentScope` and not `requireScope`, which is the difference between this layout
     redirecting a stranger to /login and 500ing at them: every seam function beside it
     either tolerates no scope or redirects, and the layout must not be the one thing that
     throws. No scope means no count, and `getUser()` below sends them to sign in. */
  const scope = await currentScope();

  const [user, projects, currentProject, plansAwaitingReview, machine, workCount] =
    await Promise.all([
      getUser(),
      getProjects(),
      getCurrentProjectOrNull(),
      getPlansAwaitingReview(),
      getMachineStatus(),
      scope ? workRunning(scope.projectId) : 0,
    ]);

  // Narrowed on purpose: the shell is a client island, so whatever goes in here
  // ships to the browser on every navigation.
  const data = shellDataOf({
    user,
    projects,
    currentProject,
    reviewCount: plansAwaitingReview.length,
    workCount,
  });

  return (
    <AppShell data={data}>
      {/* One poller for the whole dashboard, in the layout so it survives navigation
          between pages rather than restarting its timer on every one. */}
      <MachinePulse connected={machine.connected} />
      {children}
    </AppShell>
  );
}
