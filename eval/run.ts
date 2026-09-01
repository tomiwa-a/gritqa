#!/usr/bin/env tsx
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import chalk from "chalk";
import { startMcp } from "./src/cli.js";
import { connectMcp } from "./src/mcp.js";
import { runAgent, runConversation } from "./src/agent.js";
import { evaluate } from "./src/evaluator.js";
import { printEvaluation, printReport } from "./src/report.js";
import type { TestCase, RunReport } from "./src/types.js";

// Load web/.env.local so GCP_PROJECT_ID etc are available without manual export
function loadDotEnv() {
  const candidates = [
    join(resolve(import.meta.dirname ?? "."), "..", "web", ".env.local"),
    join(resolve(import.meta.dirname ?? "."), ".env.local"),
    join(process.cwd(), "web", ".env.local"),
    join(process.cwd(), ".env.local"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const text = readFileSync(p, "utf-8");
      for (const line of text.split("\n")) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const k = m[1];
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (process.env[k] === undefined) process.env[k] = v;
      }
      break;
    } catch {}
  }
}
loadDotEnv();

const EVAL_ROOT = resolve(import.meta.dirname ?? ".");
const CASES_DIR = join(EVAL_ROOT, "cases");
const RESULTS_DIR = join(EVAL_ROOT, "results");

function parseArgs(): { question?: string; all?: boolean; caseFile?: string; category?: string; projectRoot?: string; dryRun?: boolean } {
  const args = process.argv.slice(2);
  const out: ReturnType<typeof parseArgs> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--all") out.all = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--case=")) out.caseFile = a.slice("--case=".length);
    else if (a.startsWith("--category=")) out.category = a.slice("--category=".length);
    else if (a.startsWith("--project=")) out.projectRoot = a.slice("--project=".length);
    else if (a === "--help" || a === "-h") {
      console.log(`Usage:
  npx tsx eval/run.ts "What are the reservation endpoints?" [--project=PATH]
  npx tsx eval/run.ts --case=eval/cases/01-reservation-endpoints.json
  npx tsx eval/run.ts --all [--category=code-reading]
  npx tsx eval/run.ts --all --project=/path/to/hotel-project

Options:
  --project=PATH   Project root for MCP tools (default: auto-detect via gritqa config)
  --category=NAME  Filter --all by category
  --help           Show this help
`);
      process.exit(0);
    } else if (!a.startsWith("-")) {
      out.question = out.question ? `${out.question} ${a}` : a;
    }
  }
  return out;
}

async function loadCases(filter?: { category?: string; singleFile?: string }): Promise<TestCase[]> {
  if (filter?.singleFile) {
    const raw = await readFile(resolve(filter.singleFile), "utf-8");
    return [JSON.parse(raw) as TestCase];
  }
  let files: string[] = [];
  try {
    files = (await readdir(CASES_DIR)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const cases: TestCase[] = [];
  for (const f of files) {
    const raw = await readFile(join(CASES_DIR, f), "utf-8");
    const c = JSON.parse(raw) as TestCase;
    if (filter?.category && c.category !== filter.category) continue;
    cases.push(c);
  }
  return cases;
}

function resolveProjectRoot(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (process.env.GRITQA_PROJECT_ROOT) return resolve(process.env.GRITQA_PROJECT_ROOT);
  // Try known hotel/loanapp locations before falling back to repo root
  const candidates = [
    "/Users/pitersonsmartpro/Downloads/hotel",
    "/Users/pitersonsmartpro/Downloads/hotel/api",
    "/Users/pitersonsmartpro/RiderProjects/LoanApp",
    resolve(EVAL_ROOT, ".."),
  ];
  for (const c of candidates) {
    try {
      const fs = readFileSync(join(c, "composer.json"), "utf-8");
      if (fs) return c;
    } catch {}
    try {
      const fs2 = readFileSync(join(c, ".gritqa", "config.yaml"), "utf-8");
      if (fs2) return c;
    } catch {}
  }
  return resolve(EVAL_ROOT, "..");
}

async function main() {
  const args = parseArgs();
  const startedAt = new Date().toISOString();
  const wallStartedAt = Date.now();

  // Determine what to run
  let cases: TestCase[] = [];
  if (args.question) {
    cases = [
      {
        name: "Ad-hoc question",
        question: args.question,
        category: "code-reading",
        rubric: {
          completeness: "Answer the question completely",
          accuracy: "Answer must be grounded in tool results",
          hallucination: "No invented files/endpoints",
        },
      },
    ];
  } else if (args.dryRun) {
    // Dry run does not need cases; will just probe MCP
    cases = [];
  } else {
    cases = await loadCases({ category: args.category, singleFile: args.caseFile });
    if (args.all && cases.length === 0) {
      console.log(chalk.yellow("No cases found in eval/cases/. Add JSON files first."));
      process.exit(0);
    }
    if (!args.all && !args.caseFile && cases.length === 0) {
      console.log(chalk.yellow('No question given. Try: npx tsx eval/run.ts "Your question"  or  npx tsx eval/run.ts --all'));
      process.exit(0);
    }
    if (!args.all && !args.caseFile) {
      // No --all and no --case: pick first case as demo? Instead require explicit
      console.log(chalk.yellow("Specify --all, --case=FILE, or a question string."));
      process.exit(0);
    }
  }

  const projectRoot = resolveProjectRoot(args.projectRoot);
  console.log(chalk.dim(`Project root: ${projectRoot}`));
  console.log(chalk.dim(`Cases: ${cases.length}`));

  // Start MCP once for all cases (reuse; sandbox auto-starts per db call)
  console.log(chalk.dim("Starting gritqa MCP server..."));
  const { handle, startupMs } = await startMcp(projectRoot);
  console.log(chalk.dim(`MCP up at ${handle.url} in ${startupMs}ms`));

  if (args.dryRun) {
    console.log(chalk.green("Dry run OK — MCP server is up and reachable."));
    console.log(chalk.dim(` URL: ${handle.url}`));
    console.log(chalk.dim(` Token: ${handle.token.slice(0, 8)}...`));
    // Do not connect MCP client in dry-run; just verify the server started.
    await Promise.race([handle.kill().catch(() => {}), new Promise<void>((res) => setTimeout(res, 1000))]);
    process.exit(0);
  }

  let mcpSession: Awaited<ReturnType<typeof connectMcp>> | null = null;
  try {
    mcpSession = await connectMcp(handle);
    console.log(chalk.dim(`MCP connected (${mcpSession.serverName}) in ${mcpSession.connectMs}ms`));
    console.log(chalk.dim(`Tools: ${Object.keys(mcpSession.tools).join(", ")}`));
    console.log("");

    const evaluations: RunReport["cases"] = [];
    let modelLabel = mcpSession.serverName;

    for (const tc of cases) {
      console.log(chalk.bold(`\n▶ ${tc.name} [${tc.category}]`));
      console.log(chalk.dim(`  Q: ${tc.question}`));
      // Conversations pay per turn, so their budget scales with the turn count;
      // a single turn gets room for one model retry after a hang.
      const timeoutMs =
        tc.timeoutMs ??
        (tc.followUps?.length
          ? Math.min(600_000, 150_000 * (tc.followUps.length + 1))
          : 240_000);

      const runPromise = (async () => {
        // If followUps present, run as conversation
        if (tc.followUps?.length) {
          const { turns } = await runConversation({
            question: tc.question,
            followUps: tc.followUps,
            mcp: mcpSession!,
            mcpStartupMs: startupMs,
          });
          // Evaluate on the last turn's answer but include all tool calls
          const last = turns[turns.length - 1];
          const allCalls = turns.flatMap((t) => t.toolCalls);
          return { ...last, toolCalls: allCalls };
        }
        return runAgent({
          question: tc.question,
          mcp: mcpSession!,
          mcpStartupMs: startupMs,
        });
      })();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Case timed out after ${timeoutMs}ms`)), timeoutMs)
      );

      let result: Awaited<typeof runPromise>;
      try {
        result = await Promise.race([runPromise, timeoutPromise]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(chalk.red(`  ✘ ${msg}`));
        evaluations.push({
          caseName: tc.name,
          question: tc.question,
          category: tc.category,
          toolUsage: { score: 0, max: 10, notes: msg },
          accuracy: { score: 0, max: 10, notes: msg },
          hallucination: { score: 0, max: 10, notes: msg },
          efficiency: { score: 0, max: 10, notes: msg },
          timing: { score: 0, max: 10, notes: msg },
          total: 0,
          hallucinatedClaims: [],
          missingEvidence: [msg],
          toolCalls: [],
          answerExcerpt: msg,
          passed: false,
        });
        continue;
      }

      modelLabel = result.modelLabel;
      console.log(chalk.dim(`  → ${result.toolCalls.length} tool calls in ${result.agentMs}ms (total ${result.totalMs}ms)`));
      for (const c of result.toolCalls) {
        const err = c.error ? chalk.red(` ✘ ${c.error.slice(0, 160)}`) : "";
        console.log(chalk.dim(`    - ${c.name} ${fmtInput(c.input)} ${fmtMs(c.durationMs)}${err}`));
      }

      const ev = evaluate(tc, result);
      evaluations.push(ev);
      printEvaluation(ev);
    }

    const totalMs = Date.now() - wallStartedAt;
    const passed = evaluations.filter((e) => e.passed).length;
    const avgScore = evaluations.length ? evaluations.reduce((s, e) => s + e.total, 0) / evaluations.length : 0;
    const avgAgentMs = evaluations.length
      ? evaluations.reduce((s, e) => s + e.toolCalls.reduce((a, c) => a + c.durationMs, 0), 0) / evaluations.length
      : 0;
    const avgToolCalls = evaluations.length ? evaluations.reduce((s, e) => s + e.toolCalls.length, 0) / evaluations.length : 0;

    const report: RunReport = {
      startedAt,
      finishedAt: new Date().toISOString(),
      totalMs,
      modelLabel,
      cases: evaluations,
      summary: {
        total: evaluations.length,
        passed,
        failed: evaluations.length - passed,
        avgScore,
        avgAgentMs,
        avgToolCalls,
      },
    };

    printReport(report);

    // Save results
    await mkdir(RESULTS_DIR, { recursive: true });
    const outName = `${startedAt.replace(/[:.]/g, "-")}.json`;
    await writeFile(join(RESULTS_DIR, outName), JSON.stringify(report, null, 2), "utf-8");
    console.log(chalk.dim(`Saved: eval/results/${outName}`));

    if (report.summary.failed > 0) process.exitCode = 1;
  } finally {
    if (mcpSession) {
      await Promise.race([
        mcpSession.close().catch(() => {}),
        new Promise<void>((res) => setTimeout(res, 3000)),
      ]);
    }
    await Promise.race([handle.kill().catch(() => {}), new Promise<void>((res) => setTimeout(res, 3000))]);
  }
}

function fmtInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  if (typeof o.sql === "string") return (o.sql as string).replace(/\s+/g, " ").slice(0, 70);
  if (typeof o.query === "string") return `"${(o.query as string).slice(0, 50)}"`;
  if (typeof o.path === "string") return o.path as string;
  return JSON.stringify(o).slice(0, 70);
}
function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

main().catch((e) => {
  console.error(chalk.red(e instanceof Error ? e.message : String(e)));
  if (e instanceof Error && e.stack) console.error(chalk.dim(e.stack));
  process.exit(1);
});
