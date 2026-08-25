export type TestCase = {
  name: string;
  question: string;
  category: "code-reading" | "multi-file" | "db" | "permission" | "cross-verify" | "logic";
  expectedTools?: string[];
  minDbCalls?: number;
  rubric: {
    completeness: string;
    accuracy: string;
    hallucination: string;
  };
  /** Optional follow-up turns to test goal tracking. Each is a question after the first answer. */
  followUps?: string[];
  /** Timeout for this case in ms, default 180_000 */
  timeoutMs?: number;
};

export type ToolCall = {
  seq: number;
  name: string;
  input: unknown;
  result?: unknown;
  error?: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
};

export type AgentResult = {
  answer: string;
  toolCalls: ToolCall[];
  totalSteps: number;
  mcpStartupMs: number;
  mcpConnectMs: number;
  agentMs: number;
  totalMs: number;
  modelLabel: string;
  stoppedReason?: string;
  stepsBudget: number;
};

export type Score = { score: number; max: number; notes: string };

export type Evaluation = {
  caseName: string;
  question: string;
  category: string;
  toolUsage: Score;
  accuracy: Score;
  hallucination: Score;
  efficiency: Score;
  timing: Score;
  total: number;
  hallucinatedClaims: string[];
  missingEvidence: string[];
  toolCalls: ToolCall[];
  answerExcerpt: string;
  passed: boolean;
};

export type RunReport = {
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  modelLabel: string;
  cases: Evaluation[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    avgScore: number;
    avgAgentMs: number;
    avgToolCalls: number;
  };
};
