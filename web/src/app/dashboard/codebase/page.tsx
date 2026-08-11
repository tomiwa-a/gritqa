import { StubPage } from '@/components/app/stub-page';

export const metadata = { title: 'Codebase · GritQA' };

export default function CodebasePage() {
  return (
    <StubPage
      icon="codebase"
      nav="Codebase"
      title="What GritQA found in your project"
      description="The routes, handlers, and models the CLI picked up on its last pass — the same map the coverage grid is built from."
      next="A browsable index by file and route, showing which plans cover each endpoint and what changed since the last index."
    />
  );
}
