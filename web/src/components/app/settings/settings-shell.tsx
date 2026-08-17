import { Topbar } from '../topbar';
import { PageBody } from '../page-body';
import { AppPageHeader } from '../page-header';
import { SettingsNav, type SettingsKey } from './settings-nav';

export function SettingsShell({
  active,
  title,
  description,
  action,
  children,
}: {
  active: SettingsKey;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <Topbar icon="settings" title="Settings" />
      <PageBody>
        <div className="grid gap-5 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-8">
          <SettingsNav active={active} />

          <div className="min-w-0 max-w-[760px]">
            <AppPageHeader title={title} description={description} action={action} />
            <div className="mt-5 flex flex-col gap-4">{children}</div>
          </div>
        </div>
      </PageBody>
    </>
  );
}
