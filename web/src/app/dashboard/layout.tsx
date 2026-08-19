import { AppShell } from '@/components/app/app-shell';
import type { ShellData } from '@/components/app/sidebar';
import { getCurrentProject, getPlansAwaitingReview, getProjects, getUser } from '@/lib/data';

/**
 * The shell is a client island — it holds the collapse and mobile-nav state — so
 * the reading happens here, once per navigation, and goes down as one prop.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, projects, currentProject, plansAwaitingReview] = await Promise.all([
    getUser(),
    getProjects(),
    getCurrentProject(),
    getPlansAwaitingReview(),
  ]);

  const data: ShellData = {
    user,
    projects,
    currentProject,
    reviewCount: plansAwaitingReview.length,
  };

  return <AppShell data={data}>{children}</AppShell>;
}
