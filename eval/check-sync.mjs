#!/usr/bin/env node
// The eval's system prompt claims to be a carbon copy of the web app's ASK_RULES.
// This is the check that makes the claim true: both files must carry the same
// template literal, or a voice change on one side silently stops applying to the
// other. Run: node check-sync.mjs (also wired as npm run check-sync).
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const files = [
  join(root, "src", "agent.ts"),
  join(root, "..", "web", "src", "lib", "agent", "ask.ts"),
];

function extract(source, file) {
  const marker = source.match(/export const ASK_RULES = `/)
    ? "export const ASK_RULES = `"
    : "const ASK_RULES = `";
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`${file}: no ASK_RULES found`);
  const end = source.indexOf("`.trim();", start);
  if (end === -1) throw new Error(`${file}: ASK_RULES is not closed with \`.trim();`);
  return source.slice(start + marker.length, end).replace(/\r\n/g, "\n");
}

const [evalSource, webSource] = await Promise.all(files.map((f) => readFile(f, "utf-8")));
const evalRules = extract(evalSource, files[0]);
const webRules = extract(webSource, files[1]);

if (evalRules === webRules) {
  console.log("check-sync: ASK_RULES identical in eval/src/agent.ts and web/src/lib/agent/ask.ts");
} else {
  console.error("check-sync: ASK_RULES have drifted!");
  console.error(`  eval: ${JSON.stringify(evalRules.slice(0, 120))}...`);
  console.error(`  web:  ${JSON.stringify(webRules.slice(0, 120))}...`);
  process.exit(1);
}
