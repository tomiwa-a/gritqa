import { stepInconsistency } from '@/lib/agent/plan-schema';
import { stepKindOf, unloadable } from '@/lib/plan';
import type { Endpoint, PlanAssertion, PlanChange, PlanStepSpec, StepCheck } from '@/lib/model';

/**
 * A plan somebody is editing by hand, and the two things that has to produce:
 * every reason it would not run, and an account of what moved.
 *
 * Both were the agent's until now. The gate lived in the wire path, so a plan built
 * in a form could reach a machine and be refused there; the account came out of the
 * model, so a hand edit would have arrived at `plan_revisions` with nothing in the
 * `changes` column and a version number as its only record. Neither needs a model --
 * comparing two structures and checking them against the runner's rules is reading,
 * not judgment -- so both are here, and the editor is held to exactly the bar
 * `Validate()` holds a plan to before its first request.
 */

export type EditedPlan = {
  name: string;
  description: string;
  variables: Record<string, string>;
  covers: Endpoint[];
  steps: PlanStepSpec[];
  assumptions: string[];
};

/** `stepId` is null for something wrong with the plan rather than with one step. */
export type PlanProblem = { stepId: string | null; problem: string };

/**
 * Every reason this plan would be refused, not the first.
 *
 * `unloadable` and the Go validator both stop at the first, which is right for a
 * loader and wrong for an editor: fixing one problem only to be shown the next is
 * how a form with eight bad steps takes eight round trips.
 */
export function planProblems(plan: EditedPlan): PlanProblem[] {
  const out: PlanProblem[] = [];
  const add = (stepId: string | null, problem: string) => out.push({ stepId, problem });

  if (!plan.name.trim()) add(null, 'The plan has no name.');
  if (plan.steps.length === 0) add(null, 'A plan needs at least one step.');

  const ids = new Set<string>();
  for (const step of plan.steps) {
    if (!step.id.trim()) add(step.id, 'This step has no id, so nothing can depend on it.');
    else if (ids.has(step.id)) add(step.id, `Another step already has the id ${step.id}.`);
    ids.add(step.id);
  }

  for (const step of plan.steps) {
    if (!step.name.trim()) add(step.id, 'This step has no name.');

    const bad = stepInconsistency(step);
    if (bad) add(step.id, `This step ${bad}.`);

    for (const [i, check] of step.assertions.entries()) {
      if (check.operator !== 'exists' && check.expected === undefined) {
        add(
          step.id,
          `Check ${i + 1} asserts ${check.target} ${check.operator} with nothing to compare against.`,
        );
      }
    }

    for (const dep of step.dependsOn) {
      if (dep === step.id) add(step.id, 'This step depends on itself.');
      else if (!ids.has(dep)) add(step.id, `This step depends on ${dep}, which is not in the plan.`);
    }
  }

  for (const id of circular(plan.steps, ids)) {
    add(id, 'This step and the ones it depends on wait on each other, so the run never starts.');
  }

  const reference = unloadable(plan);
  if (reference) add(null, `${reference[0].toUpperCase()}${reference.slice(1)}.`);

  return out;
}

/**
 * The steps `Order()` could never place. Kahn's, and a dependency that is missing or
 * self-referential counts as satisfied here so one mistake is not reported twice.
 */
function circular(steps: PlanStepSpec[], known: Set<string>): string[] {
  const placed = new Set<string>();
  for (let moved = true; moved; ) {
    moved = false;
    for (const step of steps) {
      if (placed.has(step.id)) continue;
      const ready = step.dependsOn.every(
        (dep) => placed.has(dep) || dep === step.id || !known.has(dep),
      );
      if (ready) {
        placed.add(step.id);
        moved = true;
      }
    }
  }
  return steps.filter((step) => !placed.has(step.id)).map((step) => step.id);
}

/** Where a plan-level change is filed, since the diff view groups by step name. */
const PLAN = 'The plan itself';

/**
 * What moved between two versions, in the shape `plan_revisions.changes` already
 * holds and `PlanDiff` already renders.
 *
 * Steps are matched by id, never by position, so moving one reads as a move rather
 * than as a delete and an unrelated insert.
 */
export function changesBetween(before: EditedPlan, after: EditedPlan): PlanChange[] {
  const out: PlanChange[] = [];
  const was = new Map(before.steps.map((step) => [step.id, step]));
  const now = new Map(after.steps.map((step) => [step.id, step]));

  if (before.name !== after.name) {
    out.push(moved(PLAN, 'renamed the plan', before.name, after.name));
  }
  if (before.description !== after.description) {
    out.push(moved(PLAN, 'rewrote what the plan proves', before.description, after.description));
  }
  for (const [name, from, to] of pairs(before.variables, after.variables)) {
    if (from === undefined) out.push(moved(PLAN, `added the variable ${name}`, '', to ?? ''));
    else if (to === undefined) out.push(moved(PLAN, `removed the variable ${name}`, from, ''));
    else out.push(moved(PLAN, `changed the variable ${name}`, from, to));
  }
  if (text(before.assumptions) !== text(after.assumptions)) {
    out.push({
      kind: 'value_changed',
      stepName: PLAN,
      detail: `now takes ${count(after.assumptions.length, 'thing')} on faith`,
    });
  }

  for (const step of after.steps) {
    if (!was.has(step.id)) {
      out.push({
        kind: 'step_added',
        stepName: label(step),
        detail: `added a ${stepKindOf(step)} step`,
      });
    }
  }
  for (const step of before.steps) {
    if (!now.has(step.id)) {
      out.push({
        kind: 'step_removed',
        stepName: label(step),
        detail: `removed the ${stepKindOf(step)} step`,
      });
    }
  }

  const kept = after.steps.filter((step) => was.has(step.id));
  const order = before.steps.filter((step) => now.has(step.id)).map((step) => step.id);
  for (const [i, step] of kept.entries()) {
    const from = order.indexOf(step.id);
    if (from !== i) {
      out.push({
        kind: 'step_reordered',
        stepName: label(step),
        detail: from < i ? 'runs later than it did' : 'runs earlier than it did',
        from: `position ${from + 1}`,
        to: `position ${i + 1}`,
      });
    }
    out.push(...stepChanges(was.get(step.id)!, step));
  }

  return out;
}

function stepChanges(before: PlanStepSpec, after: PlanStepSpec): PlanChange[] {
  const out: PlanChange[] = [];
  const stepName = label(after);

  const had = new Map(before.assertions.map((check) => [key(check), check]));
  const has = new Map(after.assertions.map((check) => [key(check), check]));
  for (const [id, check] of has) {
    if (!had.has(id)) {
      out.push({ kind: 'assertion_added', stepName, detail: `now checks ${words(check)}` });
    }
  }
  for (const [id, check] of had) {
    if (!has.has(id)) {
      out.push({ kind: 'assertion_removed', stepName, detail: `no longer checks ${words(check)}` });
    }
  }

  for (const field of FIELDS) {
    const from = field.read(before);
    const to = field.read(after);
    if (from !== to) out.push(moved(stepName, `changed ${field.label}`, from, to));
  }
  return out;
}

const FIELDS: { label: string; read: (step: PlanStepSpec) => string }[] = [
  { label: 'the name', read: (s) => s.name },
  { label: 'why it is here', read: (s) => s.description },
  { label: 'the method', read: (s) => s.request?.method ?? '' },
  { label: 'the url', read: (s) => s.request?.url ?? '' },
  { label: 'the headers', read: (s) => text(s.request?.headers) },
  { label: 'the query', read: (s) => text(s.request?.query) },
  { label: 'the body', read: (s) => text(s.request?.body) },
  { label: 'the statement', read: (s) => s.action?.statement ?? '' },
  { label: 'what the statement is for', read: (s) => s.action?.target ?? '' },
  { label: 'the command', read: (s) => s.action?.command ?? '' },
  { label: 'what it hands to later steps', read: (s) => text(s.extract) },
  { label: 'what happens when it fails', read: (s) => s.onFailure },
  { label: 'the retry', read: (s) => text(s.retry) },
  { label: 'what it waits for', read: (s) => s.dependsOn.join(', ') },
];

/**
 * A hand edit's receipt, written from the diff rather than by a model.
 *
 * The thread renders `instruction` as the developer's turn and `summary` as GritQA's,
 * and on a hand edit GritQA did nothing -- so the honest thing for it to say is what
 * it observed.
 */
export function noteOn(changes: PlanChange[]): string {
  if (changes.length === 0) return 'Saved by hand, with nothing about the plan changed.';

  const tally: [PlanChange['kind'], string][] = [
    ['step_added', 'step added'],
    ['step_removed', 'step removed'],
    ['step_reordered', 'step moved'],
    ['assertion_added', 'check added'],
    ['assertion_removed', 'check removed'],
    ['value_changed', 'value changed'],
  ];
  const parts = tally
    .map(([kind, word]) => [changes.filter((c) => c.kind === kind).length, word] as const)
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}${n === 1 ? '' : 's'}`);

  return `Edited by hand: ${parts.join(', ')}.`;
}

function moved(stepName: string, detail: string, from: string, to: string): PlanChange {
  return { kind: 'value_changed', stepName, detail, from: clip(from), to: clip(to) };
}

/** Every name either side declares, so an addition and a removal both surface. */
function pairs(
  before: Record<string, string>,
  after: Record<string, string>,
): [string, string | undefined, string | undefined][] {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return names
    .filter((name) => before[name] !== after[name])
    .map((name) => [name, before[name], after[name]]);
}

function key(check: PlanAssertion): string {
  return `${check.type} ${check.operator} ${check.target} ${check.expected ?? ''}`;
}

function words(check: PlanAssertion): string {
  if (check.operator === 'exists') return `${check.target} is there`;
  return `${check.target} ${check.operator} ${check.expected}`;
}

/**
 * Which checks still describe the plan after somebody edited it by hand.
 *
 * A verdict is about a step's text. Edit the step and the verdict is about text that
 * is no longer there -- so a `confirmed` carried blindly across an edit is the worst
 * possible outcome of having verification at all: a badge saying the code was read,
 * on a step nobody has read.
 *
 * Kept only where the step is byte-identical, dropped everywhere else, and a dropped
 * check reads as unverified rather than as a problem. Comparing serialisations rather
 * than fields on purpose: a check covers everything about a step, so anything at all
 * moving is enough to invalidate it, and a field-by-field rule would be a second
 * opinion about which parts of a step a verdict was really about.
 */
export function checksAfter(
  before: PlanStepSpec[],
  after: PlanStepSpec[],
  checks: StepCheck[],
): StepCheck[] {
  const was = new Map(before.map((step) => [step.id, JSON.stringify(step)]));
  const now = new Map(after.map((step) => [step.id, JSON.stringify(step)]));

  return checks.filter((check) => {
    const then = was.get(check.stepId);
    return then !== undefined && then === now.get(check.stepId);
  });
}

function label(step: PlanStepSpec): string {
  return step.name.trim() || step.id || 'an unnamed step';
}

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** `PlanDiff` draws from and to on one line, so a pasted body cannot be the whole of it. */
function clip(value: string): string {
  if (!value) return 'nothing';
  return value.length > 120 ? `${value.slice(0, 120)}…` : value;
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
