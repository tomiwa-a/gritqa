import { StubPage } from '@/components/app/stub-page';

export const metadata = { title: 'Test plans · GritQA' };

export default function TestPlansPage() {
  return (
    <StubPage
      icon="plan"
      nav="Test plans"
      title="Your test suite, in plain language"
      description="Approved plans, drafts, and archived ones — each versioned, so you can see what changed and when."
      next="The plan library and editor: reorder steps, adjust request bodies, edit assertions, and diff a new version against the one you approved."
    />
  );
}
