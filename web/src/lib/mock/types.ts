import type { Method } from '@/components/ui/method-badge';

export type Provider = 'github' | 'gitlab';

export type User = {
  publicId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  provider: Provider;
  hasAiKey: boolean;
  aiKeyMasked: string | null;
};

export type Project = {
  publicId: string;
  name: string;
  repoUrl: string | null;
  localPath: string;
  defaultBranch: string;
  status: 'active' | 'archived';
  lastIndexedLabel: string | null;
  fileCount: number;
  endpointCount: number;
};

export type TestPlanStatus = 'draft' | 'approved' | 'archived';
export type ExecutionStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error';
export type StepStatus = 'pending' | 'passed' | 'failed' | 'skipped' | 'error';
export type RuleCategory = 'ordering' | 'mock' | 'assertion' | 'fixture';

export type TestPlan = {
  publicId: string;
  name: string;
  description: string;
  status: TestPlanStatus;
  version: number;
  triggerSource: 'git_push' | 'manual';
  createdLabel: string;
  stepCount: number;
  assertionCount: number;
  endpointCount: number;
  lastRun: { status: ExecutionStatus; passed: number; total: number; label: string } | null;
};

export type StepResult = {
  stepName: string;
  status: StepStatus;
  method: Method;
  path: string;
  responseStatus: number | null;
  responseTimeMs: number | null;
};

export type TestExecution = {
  publicId: string;
  planName: string;
  status: ExecutionStatus;
  durationMs: number | null;
  startedLabel: string;
  steps: StepResult[];
};

export type TestingRule = {
  publicId: string;
  name: string;
  category: RuleCategory;
  isActive: boolean;
  detail: string;
};

export type CoverageState = 'approved' | 'draft' | 'failing' | 'none';

export type EndpointCoverage = {
  method: Method;
  path: string;
  state: CoverageState;
};

export type CoverageFile = {
  file: string;
  endpoints: EndpointCoverage[];
};

export type AuditTone = 'plan' | 'run' | 'rule' | 'project' | 'account';

export type AuditEntry = {
  id: number;
  action: string;
  label: string;
  tone: AuditTone;
  whenLabel: string;
  ip: string;
};
