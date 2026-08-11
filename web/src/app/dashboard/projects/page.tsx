import { StubPage } from '@/components/app/stub-page';

export const metadata = { title: 'Projects · GritQA' };

export default function ProjectsPage() {
  return (
    <StubPage
      icon="projects"
      nav="Projects"
      title="Every codebase you've connected"
      description="One project per repository. Plans, runs, rules, and mocks all belong to the project they were made for."
      next="The full project list with branch, last index, and coverage at a glance — plus the flow for connecting a new repository."
    />
  );
}
