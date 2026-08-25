import chalk from "chalk";
import type { Evaluation, RunReport, ToolCall } from "./types.js";

function bar(score: number, max: number): string {
  const pct = score / max;
  const filled = Math.round(pct * 10);
  const empty = 10 - filled;
  const ch = "█".repeat(filled) + "░".repeat(empty);
  if (pct >= 0.8) return chalk.green(ch);
  if (pct >= 0.5) return chalk.yellow(ch);
  return chalk.red(ch);
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function toolDigest(c: ToolCall): string {
  const input = c.input as Record<string, unknown> | undefined;
  const subject = (() => {
    if (!input) return "";
    if (typeof input.sql === "string") return (input.sql as string).replace(/\s+/g, " ").slice(0, 80);
    if (typeof input.query === "string") return `"${(input.query as string).slice(0, 60)}"`;
    if (typeof input.path === "string") return input.path as string;
    const first = Object.values(input).find((v) => typeof v === "string") as string | undefined;
    return first ? first.slice(0, 80) : "";
  })();
  const status = c.error ? chalk.red("error") : chalk.green("ok");
  const dur = chalk.dim(fmtMs(c.durationMs));
  return `  ${String(c.seq).padStart(2)}. ${chalk.cyan(c.name.padEnd(16))} ${subject ? chalk.dim(subject) : ""}  ${status} ${dur}${c.error ? chalk.red(` — ${c.error.slice(0, 120)}`) : ""}`;
}

export function printEvaluation(ev: Evaluation): void {
  console.log("");
  console.log(chalk.bold("─".repeat(64)));
  console.log(chalk.bold(` ${ev.passed ? chalk.green("PASS") : chalk.red("FAIL")}  ${ev.caseName}  ${chalk.dim(`[${ev.category}]`)}  ${chalk.bold(`${ev.total.toFixed(1)}/10`)}`));
  console.log(chalk.bold("─".repeat(64)));
  console.log(chalk.dim(` Q: ${ev.question}`));
  console.log("");

  if (ev.toolCalls.length) {
    console.log(chalk.bold(" Tool calls:"));
    for (const c of ev.toolCalls) console.log(toolDigest(c));
    console.log("");
  } else {
    console.log(chalk.yellow(" No tool calls recorded."));
    console.log("");
  }

  const rows: [string, number, string][] = [
    ["Tool Usage", ev.toolUsage.score, ev.toolUsage.notes],
    ["Accuracy", ev.accuracy.score, ev.accuracy.notes],
    ["Hallucination", ev.hallucination.score, ev.hallucination.notes],
    ["Efficiency", ev.efficiency.score, ev.efficiency.notes],
    ["Timing", ev.timing.score, ev.timing.notes],
  ];

  console.log(chalk.bold(" Scores:"));
  for (const [label, s, notes] of rows) {
    const b = bar(s, 10);
    console.log(`  ${b}  ${label.padEnd(13)} ${String(s).padStart(2)}/10  ${chalk.dim(notes)}`);
  }
  console.log(`  ${chalk.dim("─".repeat(40))}`);
  console.log(`  ${chalk.bold(`TOTAL ${ev.total.toFixed(1)}/10`)}  ${ev.passed ? chalk.green("pass") : chalk.red("fail")}`);
  console.log("");

  if (ev.hallucinatedClaims.length) {
    console.log(chalk.yellow(` Possible hallucinations: ${ev.hallucinatedClaims.join(", ")}`));
  }
  if (ev.missingEvidence.length) {
    console.log(chalk.yellow(` Missing evidence: ${ev.missingEvidence.join("; ")}`));
  }

  console.log(chalk.dim(" Answer excerpt:"));
  console.log(chalk.dim(`  ${ev.answerExcerpt.replace(/\n/g, "\n  ").slice(0, 900)}`));
  console.log("");
}

export function printReport(report: RunReport): void {
  console.log("");
  console.log(chalk.bold("═".repeat(64)));
  console.log(chalk.bold(` GritQA Agent Evaluation Report`));
  console.log(chalk.dim(` Model: ${report.modelLabel}`));
  console.log(chalk.dim(` Started: ${report.startedAt}  •  Total: ${fmtMs(report.totalMs)}`));
  console.log(chalk.bold("═".repeat(64)));

  for (const ev of report.cases) printEvaluation(ev);

  console.log(chalk.bold("─".repeat(64)));
  console.log(chalk.bold(" Summary"));
  console.log(`  Cases:   ${report.summary.total}  •  ${chalk.green(`${report.summary.passed} passed`)}  •  ${chalk.red(`${report.summary.failed} failed`)}`);
  console.log(`  Avg:     ${report.summary.avgScore.toFixed(1)}/10`);
  console.log(`  Avg time:${fmtMs(report.summary.avgAgentMs)} agent  •  ${report.summary.avgToolCalls.toFixed(1)} tool calls/case`);
  console.log(chalk.bold("─".repeat(64)));
  console.log(chalk.dim(` Results saved to results/${report.startedAt.replace(/[:.]/g, "-")}.json`));
  console.log("");
}
