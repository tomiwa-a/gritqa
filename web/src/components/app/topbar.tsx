import { Icon, type IconName } from '@/components/ui/icon';
import { MobileNavTrigger } from './app-shell';
import { CliStatus } from './cli-status';
import { Notifications } from './notifications';
import { getCurrentProject } from '@/lib/data';

export async function Topbar({
  icon,
  title,
  action,
}: {
  icon: IconName;
  title: string;
  action?: React.ReactNode;
}) {
  const currentProject = await getCurrentProject();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-rule bg-app-panel px-4 sm:px-6">
      <MobileNavTrigger />
      <Icon name={icon} size={16} className="hidden text-ink-subtle sm:block" />
      <h1 className="truncate text-sm font-medium text-ink">{title}</h1>

      <div className="ml-auto flex items-center gap-2">
        <CliStatus
          lastSeenLabel={currentProject.lastIndexedLabel}
          className="hidden md:inline-flex"
        />
        <Notifications />
        {action}
      </div>
    </header>
  );
}
