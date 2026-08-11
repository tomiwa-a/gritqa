import { StubPage } from '@/components/app/stub-page';

export const metadata = { title: 'Runs · GritQA' };

export default function RunsPage() {
  return (
    <StubPage
      icon="runs"
      nav="Runs"
      title="Every execution, newest first"
      description="One row per run, with the step that broke called out by name instead of buried in a log."
      next="A filterable history with a per-run timeline: each request, the response it got, the assertion that decided the outcome, and the timing beside it."
    />
  );
}
