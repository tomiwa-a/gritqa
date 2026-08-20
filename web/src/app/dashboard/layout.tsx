import { AppShell } from '@/components/app/app-shell';
import { MachinePulse } from '@/components/app/machine-pulse';
import { shellDataOf } from '@/components/app/shell-data';
import {
  getCurrentProject,
  getMachineStatus,
  getPlansAwaitingReview,
  getProjects,
  getUser,
} from '@/lib/data';

/**
 * The shell is a client island — it holds the collapse and mobile-nav state — so
 * the reading happens here, once per navigation, and goes down as one prop.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, projects, currentProject, plansAwaitingReview, machine] = await Promise.all([
    getUser(),
    getProjects(),
    getCurrentProject(),
    getPlansAwaitingReview(),
    getMachineStatus(),
  ]);

  // Narrowed on purpose: the shell is a client island, so whatever goes in here
  // ships to the browser on every navigation.
  const data = shellDataOf({
    user,
    projects,
    currentProject,
    reviewCount: plansAwaitingReview.length,
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
