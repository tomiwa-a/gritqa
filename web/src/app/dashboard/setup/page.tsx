import { StubPage } from '@/components/app/stub-page';

export const metadata = { title: 'CLI setup · GritQA' };

export default function SetupPage() {
  return (
    <StubPage
      icon="terminal"
      nav="CLI setup"
      title="Get the CLI on this machine"
      description="GritQA reads your project locally and talks to this dashboard. The CLI is how that starts."
      next="Install instructions, the command to connect this project, your provider key, and the first plan to approve — the same four steps the sidebar is counting."
    />
  );
}
