/**
 * Wire contract: every key the web can write into plan_json must exist in the
 * CLI's accepted shape, or a strict decode kills the run before its first step.
 *
 * The dashboard merged review metadata (checks) into plan_json without telling
 * the runner, whose DisallowUnknownFields turned the next queued run into
 * `json: unknown field "checks"`. This script fails the same way at check time:
 * web keys (TypeScript types + the planJson literals) must be a subset of CLI
 * tags (Go structs in internal/plan), compared case-insensitively because Go's
 * unmarshal is.
 *
 *   node check-wire.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

function cliTags() {
  const tags = new Map();
  for (const file of ['cli/internal/plan/plan.go', 'cli/internal/plan/wire.go']) {
    const src = read(file);
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/json:"([^",]+)(?:,[^"]*)?"/g)) {
        if (m[1] !== '-') tags.set(m[1].toLowerCase(), `${file}:${i + 1}`);
      }
    });
  }
  return tags;
}

/** Collect `key`/`key?` names from named TS object types, recursing into nesting. */
function tsKeys(src, names) {
  const found = new Map();
  for (const name of names) {
    const at = src.indexOf(`type ${name} = {`);
    if (at < 0) throw new Error(`type ${name} not found`);
    let depth = 0;
    let i = src.indexOf('{', at);
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) break;
      } else if (depth >= 1) {
        // Keys start at a boundary: after an opener, a comma, or whitespace.
        // Without this every suffix of an identifier ("escription" in
        // "description") reports as its own key.
        if (i > 0 && !/[\s{,;]/.test(src[i - 1])) continue;
        const m = src.slice(i).match(/^([A-Za-z_$][\w$]*)\??:/);
        if (m) found.set(m[1].toLowerCase(), name);
      }
    }
  }
  return found;
}

/** Collect keys of every `planJson: { ... }` literal (balanced braces). */
function planJsonKeys(src) {
  const found = new Map();
  let at = 0;
  while ((at = src.indexOf('planJson: {', at)) >= 0) {
    let depth = 0;
    let i = src.indexOf('{', at);
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) break;
      } else if (depth === 1) {
        if (i > 0 && !/[\s{,;]/.test(src[i - 1])) continue;
        const m = src.slice(i).match(/^([A-Za-z_$][\w$]*)\s*:/);
        if (m) found.set(m[1].toLowerCase(), 'planJson');
      }
    }
    at = i;
  }
  return found;
}

const tags = cliTags();
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\S\r\n])\/\/.*$/gm, '$1');
const model = stripComments(read('web/src/lib/model.ts'));
const drafts = stripComments(read('web/src/lib/db/drafts.ts'));

const web = new Map([
  ...tsKeys(model, ['PlanStepSpec', 'PlanAction', 'PlanExtraction', 'PlanAssertion', 'StepCheck', 'Endpoint']),
  ...planJsonKeys(drafts),
]);

// Type-only helpers that never reach JSON are excluded by construction: only
// object-literal keys inside the named types are collected.

const missing = [...web.entries()].filter(([key]) => !tags.has(key));
if (missing.length > 0) {
  for (const [key, from] of missing) {
    console.error(`wire contract broken: web key "${key}" (from ${from}) has no CLI json tag`);
  }
  process.exit(1);
}
console.log(`wire contract holds: ${web.size} web keys, all accepted by the CLI`);
