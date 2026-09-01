import type { TestCase, ToolCall, AgentResult, Evaluation, Score } from "./types.js";

function score(n: number, max: number, notes: string): Score {
  return { score: Math.max(0, Math.min(max, n)), max, notes };
}

/** Extract candidate claims (endpoints, files, permissions) from an answer. */
function extractClaims(answer: string): string[] {
  const raw: string[] = [];
  // Endpoints: /index.php?controller=...&action=...
  for (const m of answer.matchAll(/\/index\.php\?[^\s"'`]+/g)) raw.push(m[0]);
  // Permissions: create:booking etc.
  for (const m of answer.matchAll(/[a-z]+:[a-z_]+/g)) raw.push(m[0]);
  // Files: Something.php
  for (const m of answer.matchAll(/\b[A-Za-z_]+\.php\b/g)) raw.push(m[0]);
  // Tables: `bookings` or bookings table
  for (const m of answer.matchAll(/`([a-z_]+)`/g)) raw.push(m[1]);

  // Markdown dressing rides along on the regexes above: a bolded URL keeps its
  // trailing **, which matches nothing in tool output and reads as an invention.
  // Strip it before comparing.
  return [...new Set(raw.map((c) => c.replace(/[\s]*[\*`_,.\)\]}'"]+$/g, "").replace(/^[\*`'"]+/g, "")))];
}

function toolNames(calls: ToolCall[]): string[] {
  return calls.map((c) => c.name);
}

function countTool(calls: ToolCall[], name: string): number {
  return calls.filter((c) => c.name === name).length;
}

function hasTool(calls: ToolCall[], name: string): boolean {
  return calls.some((c) => c.name === name);
}

export function evaluate(testCase: TestCase, result: AgentResult): Evaluation {
  const calls = result.toolCalls;
  const names = toolNames(calls);
  const answer = result.answer;

  // --- Tool Usage (0-10) ---
  let toolScore = 10;
  const toolNotes: string[] = [];

  if (testCase.expectedTools?.length) {
    for (const exp of testCase.expectedTools) {
      if (!hasTool(calls, exp)) {
        toolScore -= 3;
        toolNotes.push(`missing expected tool: ${exp}`);
      }
    }
    if (toolNotes.length === 0) toolNotes.push(`used expected tools: ${testCase.expectedTools.join(", ")}`);
  } else {
    toolNotes.push(`tools used: ${names.join(", ") || "none"}`);
  }

  if (testCase.minDbCalls && countTool(calls, "db") < testCase.minDbCalls) {
    toolScore -= 3;
    toolNotes.push(`expected >=${testCase.minDbCalls} db calls, got ${countTool(calls, "db")}`);
  } else if (testCase.minDbCalls) {
    toolNotes.push(`db calls: ${countTool(calls, "db")} (need >=${testCase.minDbCalls})`);
  }

  // Reward correct ordering: get_index first
  if (calls.length > 0 && calls[0].name !== "get_index" && testCase.category !== "db") {
    toolScore -= 1;
    toolNotes.push("get_index not called first (orientation)");
  }

  // Penalise no tools at all on a code question
  if (calls.length === 0 && testCase.category !== "logic") {
    toolScore = 2;
    toolNotes.push("no tools called at all");
  }

  // Penalise tool errors
  const errors = calls.filter((c) => c.error).length;
  if (errors > 0) {
    toolScore -= Math.min(3, errors);
    toolNotes.push(`${errors} tool(s) errored`);
  }

  toolScore = Math.max(0, Math.min(10, toolScore));

  // --- Accuracy (0-10) ---
  // Heuristic: check if answer is non-empty and mentions tool-derived evidence
  let accuracyScore = 10;
  const accuracyNotes: string[] = [];
  const missingEvidence: string[] = [];

  if (!answer.trim()) {
    accuracyScore = 0;
    accuracyNotes.push("empty answer");
  } else if (answer.length < 80) {
    accuracyScore -= 4;
    accuracyNotes.push("very short answer, likely incomplete");
  }

  if (answer.toLowerCase().includes("i could not find") || answer.toLowerCase().includes("could not be found")) {
    // Honest "not found" is not a failure, but check if it tried
    if (calls.length < 2) {
      accuracyScore -= 3;
      accuracyNotes.push("gave up early with 'not found' after few tool calls");
    } else {
      accuracyNotes.push("honest 'not found' after searching");
    }
  }

  // Check for invented "As an AI" / refusal patterns
  if (/as an ai|i don't have access|cannot access/i.test(answer)) {
    accuracyScore -= 5;
    accuracyNotes.push("generic refusal / 'as an AI' phrasing");
  }

  // An answer written with no tools on a case that demanded evidence is not a
  // lean answer, it is an invented one: the model wrote from the question alone.
  // Case 12 passed 6.9 this way while fabricating a whole product tour.
  const demandsEvidence = (testCase.expectedTools?.length ?? 0) > 0 || !!testCase.minDbCalls;
  if (calls.length === 0 && demandsEvidence) {
    accuracyScore = Math.min(accuracyScore, 2);
    accuracyNotes.push("answer written without reading anything — fabrication risk");
  }

  // Sandbox failure pattern from the original bug
  if (/sandbox.*not.*running|cannot.*query.*directly|without.*sandbox.*running/i.test(answer)) {
    accuracyScore -= 5;
    missingEvidence.push("agent claimed sandbox not running instead of querying");
    accuracyNotes.push("fell back to 'sandbox not running' instead of using tools");
  }

  if (accuracyNotes.length === 0) accuracyNotes.push("answer present and substantive");

  // --- Hallucination (0-10) ---
  let hallucScore = 10;
  const hallucNotes: string[] = [];
  const hallucinatedClaims: string[] = [];

  // Collect all evidence from tool results + searched content
  const evidenceText = calls
    .map((c) => JSON.stringify(c.result ?? "") + " " + JSON.stringify(c.input ?? ""))
    .join(" ")
    .toLowerCase();

  const claims = extractClaims(answer);
  for (const claim of claims) {
    const norm = claim.toLowerCase();
    // Only flag if claim is not in evidence at all and not a generic word
    if (norm.length < 4) continue;
    if (!evidenceText.includes(norm)) {
      // Check if it's a permission string - those are often synthesized, be lenient
      if (norm.includes(":") && answer.toLowerCase().includes("permission")) continue;
      // Don't flag generic table names that might be inferred correctly
      if (["bookings", "users", "roles", "permissions"].includes(norm)) continue;
      hallucinatedClaims.push(claim);
    }
  }

  if (hallucinatedClaims.length > 0) {
    hallucScore -= Math.min(6, hallucinatedClaims.length * 2);
    hallucNotes.push(`possible hallucinated claims: ${hallucinatedClaims.join(", ")}`);
  } else {
    hallucNotes.push("no hallucinated file/endpoint claims detected");
  }

  // Also penalise absolute statements without evidence
  if (calls.length <= 1 && answer.length > 500) {
    hallucScore -= 2;
    hallucNotes.push("long answer with very few tool calls — likely under-evidenced");
  }

  hallucScore = Math.max(0, Math.min(10, hallucScore));

  // --- Efficiency (0-10) ---
  let effScore = 10;
  const effNotes: string[] = [];
  const n = calls.length;

  if (n === 0) {
    effScore = 3;
    effNotes.push("no tool calls");
  } else if (n <= 5) {
    effNotes.push(`${n} tool calls — lean`);
  } else if (n <= 10) {
    effScore = 8;
    effNotes.push(`${n} tool calls — reasonable`);
  } else if (n <= 20) {
    effScore = 6;
    effNotes.push(`${n} tool calls — a bit heavy`);
  } else if (n <= 35) {
    effScore = 4;
    effNotes.push(`${n} tool calls — heavy, may be looping`);
  } else {
    effScore = 2;
    effNotes.push(`${n} tool calls — excessive, near budget`);
  }

  // Hit budget?
  if (result.totalSteps >= result.stepsBudget) {
    effScore -= 2;
    effNotes.push(`hit step budget (${result.stepsBudget})`);
  }

  effScore = Math.max(0, Math.min(10, effScore));

  // --- Timing (0-10) ---
  let timingScore = 10;
  const timingNotes: string[] = [];
  const agentMs = result.agentMs;
  const totalMs = result.totalMs;

  // Agent time
  if (agentMs < 5_000) timingNotes.push(`agent ${agentMs}ms — very fast`);
  else if (agentMs < 20_000) timingNotes.push(`agent ${agentMs}ms — good`);
  else if (agentMs < 45_000) timingNotes.push(`agent ${agentMs}ms — moderate`);
  else if (agentMs < 90_000) {
    timingScore -= 1;
    timingNotes.push(`agent ${agentMs}ms — slow`);
  } else {
    timingScore -= 3;
    timingNotes.push(`agent ${agentMs}ms — very slow`);
  }

  // Total time includes sandbox startup on first db call
  if (totalMs > 120_000) {
    timingScore -= 1;
    timingNotes.push(`total ${totalMs}ms — includes sandbox boot`);
  }

  // Per-tool timing: flag slow tools
  const slowTools = calls.filter((c) => c.durationMs > 25_000);
  if (slowTools.length > 0) {
    timingScore -= 1;
    timingNotes.push(`slow tools: ${slowTools.map((c) => `${c.name} ${c.durationMs}ms`).join(", ")}`);
  }

  timingScore = Math.max(0, Math.min(10, timingScore));

  const total = +(toolScore * 0.25 + accuracyScore * 0.3 + hallucScore * 0.2 + effScore * 0.1 + timingScore * 0.15).toFixed(2);
  const passed = total >= 5.0 && hallucScore >= 5 && accuracyScore >= 4;

  return {
    caseName: testCase.name,
    question: testCase.question,
    category: testCase.category,
    toolUsage: score(toolScore, 10, toolNotes.join("; ")),
    accuracy: score(accuracyScore, 10, accuracyNotes.join("; ")),
    hallucination: score(hallucScore, 10, hallucNotes.join("; ")),
    efficiency: score(effScore, 10, effNotes.join("; ")),
    timing: score(timingScore, 10, timingNotes.join("; ")),
    total,
    hallucinatedClaims,
    missingEvidence,
    toolCalls: calls,
    answerExcerpt: answer.slice(0, 900),
    passed,
  };
}
