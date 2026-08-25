import { generateObject, generateText, isStepCount } from 'ai';
import type { LanguageModel, ToolSet } from 'ai';
import { checksFor, checksSchema } from './plan-schema';
import { unwatched, watching } from './watch';
import { observedRoutes } from '@/lib/db/contracts';
import { currentScope } from '@/lib/db/scope';
import type { Watcher } from './watch';
import type { ObservedRoute, PlanStepSpec, StepCheck } from '@/lib/model';

/**
 * Pass three: check the plan against the code before a human is asked to read it.
 *
 * The gap this closes was measurable. Across every draft this project had stored, the
 * agent made three tool calls in total -- one `get_index`, one `search`, one
 * `read_file` -- and never once opened the sandbox or queried the database. Then pass
 * two wrote the steps with no tools at all. So field names, status codes and half the
 * routes came out of the model's priors, and the only thing standing between that and
 * an approved plan was shape validation: `stepFromWire` asks whether a sql step has a
 * statement, `loadable` asks whether every {{name}} resolves. Neither asks whether the
 * route exists.
 *
 * Judging is deliberately not fixing. A pass that repaired what it found would be the
 * model grading its own homework and then quietly correcting the marks, and the plan
 * that landed would be one nobody -- including the model -- had read end to end. What
 * lands instead is the plan as written with a verdict attached to each step, which is
 * the same division of labour the runner keeps: `Allowed()` in the CLI lets a repairer
 * change a request and never an assertion, because a claim about what the code should
 * do is the human's to make.
 *
 * Never fatal. A verification that cannot run -- the machine went away, the model
 * failed, the sandbox would not boot -- returns no checks, and no checks reads as
 * unverified, which is honest and is what every plan written before today is.
 */

/**
 * How many tool calls a verification may make, and it scales with the plan.
 *
 * A check is N questions: fourteen steps is fourteen routes to find and fourteen sets
 * of field names to read. A flat budget would spend itself on the first four steps and
 * file the other ten as `unsupported`, which is a worse failure than not checking at
 * all -- it looks like evidence.
 *
 * The floor and the cap both went up with the research budgets they sit beside. Sixty
 * was under two calls a step on a long plan, which is one route lookup and nothing
 * left to read the fields with.
 */
function budget(steps: number): number {
  return Math.min(12 + 4 * steps, 100);
}

/** Routes a run has really called, as evidence a route exists and answers. */
async function recorded(): Promise<ObservedRoute[]> {
  try {
    const scope = await currentScope();
    if (!scope) return [];
    return await observedRoutes(scope.projectId);
  } catch {
    /* No history is the same answer as no matching route: nothing is confirmed by it. */
    return [];
  }
}

function evidencePrompt(routes: ObservedRoute[]): string {
  if (routes.length === 0) {
    return [
      'No run has called this API yet, so there is no recorded traffic to check against.',
      'Everything has to come off the code and the database.',
    ].join(' ');
  }

  const lines = routes
    .map((route) => `- ${route.method} ${route.path} answered ${route.status ?? '?'}`)
    .join('\n');

  return [
    'Endpoints a real run has already called on this project, with the status each',
    'one answered. A step matching one of these is confirmed as far as the route goes,',
    'and a step whose route is absent here is not thereby wrong -- it may simply never',
    'have been exercised.',
    '',
    lines,
  ].join('\n');
}

/** The plan as the checker reads it: every field a claim, nothing summarised away. */
function stepsPrompt(steps: PlanStepSpec[]): string {
  return steps
    .map((step, index) => {
      const kind = step.kind ?? 'http';
      const payload =
        kind === 'http'
          ? JSON.stringify(step.request ?? {}, null, 2)
          : JSON.stringify(step.action ?? {}, null, 2);
      return [
        `${index + 1}. ${step.id} [${kind}] ${step.name}`,
        payload,
        `asserts: ${JSON.stringify(step.assertions)}`,
        step.extract.length ? `extracts: ${JSON.stringify(step.extract)}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

const CHECK_RULES = `
You are checking a test plan somebody is about to be asked to approve. You are not
rewriting it: return a verdict per step and nothing else, even where you can see
exactly what the fix would be -- say what the code has instead, in the note, and let
the developer make the edit.

Check what the plan asserts about the code, not whether it is a good test:

- the route. Does this path exist, character for character, including any query
  string or file name in it? \`get_index\` lists every endpoint the project has and
  where it is registered. A path that has been tidied into the one a framework
  *ought* to use is wrong.
- the field names. Does the handler read the fields the request sends, and does it
  return the ones the assertions read? \`read_file\` on the handler settles it. For a
  \`sql\` step, do those columns exist -- \`start_sandbox\` then \`db\` against
  information_schema is how you find out, and it is worth the two calls.
- the status codes. Does the handler have a path that returns what the step expects?
  A step asserting 401 against a handler that answers 400 for a bad credential is a
  step that will fail for the wrong reason.

Use the tools. A verdict you reasoned out without reading anything is exactly the
mistake this pass exists to catch, and \`unsupported\` is the honest answer where you
could not reach the evidence -- it is not a worse verdict than \`confirmed\`, it is a
different fact. Guessing \`confirmed\` is the one outcome that makes this pass worse
than useless.
`.trim();

/**
 * The plan's steps, each with a verdict. Empty when verification could not run.
 *
 * `findings` is what the checker went and read, kept for the transcript beside pass
 * one's -- and it is the part worth keeping when a verdict is disputed, because it is
 * the evidence rather than the conclusion.
 */
export type Verification = { checks: StepCheck[]; findings: string };

export async function verifyPlan(input: {
  model: LanguageModel;
  tools: ToolSet;
  steps: PlanStepSpec[];
  variables: Record<string, string>;
  baseUrl: string;
  /** Where to narrate the reading, when this is queued work. */
  watch?: Watcher;
}): Promise<Verification> {
  if (input.steps.length === 0) return { checks: [], findings: '' };
  const watch = input.watch ?? unwatched;

  const routes = await recorded();
  const plan = [
    'The plan to check, step by step. Every url is relative to',
    `${input.baseUrl}, and {{name}} refers to one of these values the run supplies:`,
    JSON.stringify(input.variables),
    '',
    stepsPrompt(input.steps),
    '',
    evidencePrompt(routes),
  ].join('\n');

  try {
    /* Reading, then verdicts. `generateObject` in this version of the SDK takes
       neither tools nor a step budget, so the two cannot be one call -- which is the
       same constraint that shaped passes one and two, and the same consolation: the
       reading survives a reshape. */
    const investigation = await generateText({
      model: input.model,
      system: CHECK_RULES,
      prompt: [
        plan,
        '',
        'Go and read what settles each step: the routes in the index, the handlers, the',
        'columns in information_schema. Report what you found step by step -- what you',
        'read, what it said, and where you could not establish anything. Do not give',
        'verdicts yet.',
      ].join('\n'),
      tools: input.tools,
      stopWhen: isStepCount(budget(input.steps.length)),
      ...watching(watch, 'verify'),
    });

    const out = await generateObject({
      model: input.model,
      schema: checksSchema,
      system: CHECK_RULES,
      prompt: [
        plan,
        '',
        'What you found when you looked:',
        investigation.text,
        '',
        'Now one verdict per step, in the order above, using the ids exactly as written.',
        'A step you did not manage to establish anything about is `unsupported`.',
      ].join('\n'),
    });

    return {
      checks: checksFor(
        out.object,
        input.steps.map((step) => step.id),
      ),
      findings: investigation.text,
    };
  } catch (error) {
    /* A plan that could not be checked is still a plan. The log names the reason and
       the developer sees an unverified plan, which is what they had yesterday. */
    const why = error instanceof Error ? error.message : String(error);
    console.warn(`verify: ${why}`);
    /* Recorded rather than only logged, because a plan that arrives with no checks on
       it looks the same as a plan nobody thought to check. Not `failed`: the job did
       not fail, and the plan is about to be written. */
    watch.note({
      phase: 'verify',
      kind: 'note',
      label: 'Could not check the steps against the code, so the plan arrives unverified.',
      detail: { why },
    });
    return { checks: [], findings: '' };
  }
}
