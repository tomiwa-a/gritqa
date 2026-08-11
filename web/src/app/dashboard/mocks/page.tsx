import { StubPage } from '@/components/app/stub-page';

export const metadata = { title: 'Mock server · GritQA' };

export default function MocksPage() {
  return (
    <StubPage
      icon="mock"
      nav="Mock server"
      title="Stand-ins for everything you don't own"
      description="Payment providers, mail, storage — answered locally so a test run never touches a live account."
      next="The endpoint list with editable responses, delays, and failure modes, plus a log of what each run actually called."
    />
  );
}
