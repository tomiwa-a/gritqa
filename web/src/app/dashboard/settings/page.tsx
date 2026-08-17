import Link from 'next/link';
import { SettingsShell } from '@/components/app/settings/settings-shell';
import { SettingRow } from '@/components/app/settings/setting-row';
import { DangerZone } from '@/components/app/settings/danger-zone';
import { Panel } from '@/components/app/panel';
import { Avatar } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icon';
import { Button, buttonVariants } from '@/components/ui/button';
import { user } from '@/lib/mock/data';

export const metadata = { title: 'Account · Settings · GritQA' };

const PROVIDER_LABEL = { github: 'GitHub', gitlab: 'GitLab' } as const;

export default function AccountSettingsPage() {
  const provider = PROVIDER_LABEL[user.provider];

  return (
    <SettingsShell
      active="account"
      title="Account"
      description="Everything here comes from the account you signed in with."
    >
      <Panel title="You" bodyClassName="p-0">
        <div className="flex items-center gap-3.5 border-b border-rule-soft px-4 py-4">
          <Avatar name={user.name} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium text-ink">{user.name}</p>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12.5px] text-ink-muted">
              <Icon name={user.provider} size={12} className="shrink-0 text-ink-subtle" />
              {user.email}
            </p>
          </div>
        </div>

        <SettingRow
          label="Name and email"
          hint={`Held by ${provider}. Change it there and it updates the next time you sign in.`}
          control={
            <a
              href={
                user.provider === 'github'
                  ? 'https://github.com/settings/profile'
                  : 'https://gitlab.com/-/profile'
              }
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              Open {provider}
              <Icon name="external" size={13} />
            </a>
          }
        />

        <SettingRow
          label="Sign-in method"
          hint="The only way into this account. There is no password to lose."
          value={provider}
        />

        <SettingRow label="Account ID" hint="Quote this if you ever write to us." value={user.publicId} mono />
      </Panel>

      <Panel title="This browser" bodyClassName="p-0">
        <SettingRow
          label="Signed in here"
          hint="Signing out ends this session. Runs already going keep going."
          control={
            <Link href="/login" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              <Icon name="signOut" size={13} />
              Sign out
            </Link>
          }
        />
      </Panel>

      <DangerZone title="Close the account">
        <SettingRow
          label="Delete everything"
          hint="Your projects, plans, and run history go with it. Your code is untouched — it was never ours."
          control={
            <Button variant="danger" size="sm">
              Delete account
            </Button>
          }
        />
      </DangerZone>
    </SettingsShell>
  );
}
