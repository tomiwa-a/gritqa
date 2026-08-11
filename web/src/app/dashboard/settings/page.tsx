import { StubPage } from '@/components/app/stub-page';

export const metadata = { title: 'Settings · GritQA' };

export default function SettingsPage() {
  return (
    <StubPage
      icon="settings"
      nav="Settings"
      title="Account, access, and your AI provider"
      description="Who you signed in as, which machines are connected, and the provider GritQA drafts plans with."
      next="Profile, connected machines, provider and key management, notification preferences, and the audit trail of what ran when."
    />
  );
}
