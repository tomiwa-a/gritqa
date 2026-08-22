import type { CoverageFile, PlanDiffContext } from './model';

/**
 * The brief a draft is written from, composed out of a selection.
 *
 * This is the piece the wizard was missing. Two of its three doors pick a *scope* --
 * a set of ticked endpoints, a range of commits -- and `draftPlanAction` takes prose,
 * so both doors had nowhere to go and the footer sent you to the third one instead.
 *
 * Composed and then shown in the brief box rather than posted straight through, for
 * one reason: a list of paths says which code, and only a person can say what the
 * journey is supposed to prove. The composed text is the half a selection already
 * knows, filled in so there is something to edit rather than a blank box after four
 * clicks of picking.
 *
 * Scope and nothing else. How to write a good plan is `HOUSE_RULES`'s job and saying
 * it twice would mean two places to keep true -- so these say which endpoints, where
 * they live, and that the journey may need steps nobody ticked.
 */

export type PickedEndpoint = { file: string; method: string; path: string };

/* Words to ten, digits after -- past that a numeral reads as the count it is. */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function count(n: number) {
  return n < WORDS.length ? WORDS[n] : String(n);
}

function byFile(picks: PickedEndpoint[]) {
  const groups = new Map<string, PickedEndpoint[]>();
  for (const pick of picks) {
    const group = groups.get(pick.file);
    if (group) group.push(pick);
    else groups.set(pick.file, [pick]);
  }
  return groups;
}

/** What the endpoints door hands over: the ticked endpoints, grouped by the file that registers them. */
export function briefForEndpoints(picks: PickedEndpoint[]): string {
  if (picks.length === 0) return '';

  if (picks.length === 1) {
    const [only] = picks;
    return [
      `Cover ${only.method} ${only.path} in one journey. It is registered in ${only.file}.`,
      '',
      'Work out what has to exist before it can run.',
    ].join('\n');
  }

  const lines: string[] = [];
  for (const [file, endpoints] of byFile(picks)) {
    lines.push(file);
    for (const endpoint of endpoints) lines.push(`  ${endpoint.method} ${endpoint.path}`);
  }

  return [
    `Cover these ${count(picks.length)} endpoints in one journey:`,
    '',
    lines.join('\n'),
    '',
    'Work out the order they have to happen in, and what has to exist before the first one can run.',
  ].join('\n');
}

/**
 * What the diff door hands over.
 *
 * `diffFrom` deliberately does not guess which endpoints a change reaches, so the
 * crossing happens here instead and it is a lookup rather than a guess: the index
 * knows which endpoints each file registers, and a changed file's endpoints are the
 * surface that change is reachable through. Files with none are still listed -- a
 * helper or a model is exactly the kind of change worth a plan, and the agent can
 * go and read it.
 */
export function briefForChanges(diff: PlanDiffContext, coverage: CoverageFile[]): string {
  const endpointsIn = (path: string) =>
    coverage.find((file) => file.file === path)?.endpoints ?? [];

  const lines: string[] = [];
  let reachable = 0;
  for (const file of diff.files) {
    lines.push(`${file.path}  +${file.additions} -${file.deletions}`);
    for (const endpoint of endpointsIn(file.path)) {
      lines.push(`  ${endpoint.method} ${endpoint.path}`);
      reachable += 1;
    }
  }

  const range =
    diff.commitCount === 1 || diff.commitCount === undefined
      ? `commit ${diff.commit} on ${diff.branch}`
      : `${diff.commitCount} commits on ${diff.branch}, up to ${diff.commit}`;

  return [
    `Cover what changed in ${range} -- "${diff.message}".`,
    '',
    lines.join('\n'),
    '',
    reachable > 0
      ? 'Prove the behaviour those changes affect, through the endpoints listed under each file.'
      : 'Work out which endpoints reach that code, and prove the behaviour the changes affect.',
  ].join('\n');
}
