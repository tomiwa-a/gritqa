import { StubPage } from '@/components/app/stub-page';

export const metadata = { title: 'Rules · GritQA' };

export default function RulesPage() {
  return (
    <StubPage
      icon="rules"
      nav="Rules"
      title="Your team's testing standards"
      description="Ordering, mocks, assertions, and fixtures. Set them once and every plan drafted after that respects them."
      next="A rule editor per category, with the plans each rule currently affects listed underneath so a change is never a surprise."
    />
  );
}
