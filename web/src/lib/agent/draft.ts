import { generateObject, generateText, isStepCount } from 'ai';
import { resolveModel } from './model';
import { openResearch } from './research';
import { revisionSchema, type RevisionDraft } from './plan-schema';
import type { TestPlanDetail, TestingRule } from '@/lib/model';

/**
 * The agent, in two passes: look at the code, then write the plan.
 *
 * The obvious shape is one call with the tools *and* the output schema attached,
 * and it is worse for a reason that costs real time. Tool calls here reach into
 * the developer's machine -- reading files, opening a sandbox, describing a
 * schema -- and a structured-output retry re-runs the whole conversation. So a
 * model that gets the JSON slightly wrong on its first try would do all of that
 * again to fix a missing field. Splitting the two means a reshape is a reshape:
 * cheap, local, and with the research already in hand.
 *
 * It also makes the transcript a thing that exists. The findings from pass one
 * are the agent's own account of what it went and read, which is what a developer
 * asking "why did it write that" is actually asking about.
 */

/**
 * How many tool calls one draft may make.
 *
 * A budget rather than a natural stop, because the failure mode without one is
 * not an error -- it is an agent quietly reading a hundred files while somebody
 * watches a spinner. Twelve is enough to find a route, read its handler, follow
 * one layer down and check the schema, which is the shape of nearly every real
 * question. A draft that needed more was probably asked something too broad, and
 * the honest answer to that is a plan built on what it did manage to read.
 */
const RESEARCH_STEPS = 12;

/**
 * The rules of the house, and they are rules about the *product* rather than
 * about prose style.
 *
 * The approval gate is the load-bearing one. GritQA's whole promise is that
 * nothing runs until a human says so, and an agent that believes it is shipping
 * tests writes differently from one that knows it is writing a proposal -- it
 * hedges less, and it does not quietly soften an assertion to make a green run
 * more likely.
 */
const HOUSE_RULES = `
You are GritQA's planning agent. You write API test plans for one project, and a
plan you write is a *proposal*: a human reads it and approves it before anything
executes. Never soften a check to make a run more likely to pass -- a failing
test that is right is the outcome this product exists to produce.

Research before you write. You have tools onto the developer's actual codebase;
use them to find the real routes, the real request shapes and the real status
codes. Do not infer an endpoint from a name, and do not invent a field. If you
could not establish something, say so in the summary rather than guessing at it.

Paths in \`covers\` are route patterns -- /customers/:id/orders, never
/customers/42/orders. Coverage is keyed by pattern, so a concrete id there joins
to nothing.

Never write a credential into a plan. Reference it: {{$ENV.STRIPE_KEY}}. The plan
is stored, shown on screen and copied into a job payload, and a literal secret
would travel through all three.
`.trim();

/** Rules the developer set, grouped the way they were written. */
function rulesPrompt(rules: TestingRule[]): string {
  const active = rules.filter((rule) => rule.isActive);
  if (active.length === 0) return '';

  const heading: Record<TestingRule['category'], string> = {
    ordering: 'Ordering',
    mock: 'Mocks',
    assertion: 'Assertions',
    fixture: 'Fixtures',
  };

  const byCategory = active.reduce<Map<string, string[]>>((acc, rule) => {
    const key = heading[rule.category];
    acc.set(key, [...(acc.get(key) ?? []), `- ${rule.name}: ${rule.detail}`]);
    return acc;
  }, new Map());

  const body = [...byCategory]
    .map(([category, lines]) => `${category}\n${lines.join('\n')}`)
    .join('\n\n');

  /* Stated as binding, because they are: a developer who wrote a rule down is not
     offering the model a suggestion. The switched-off ones are not sent at all --
     `is_active` is how someone says "not this time" without deleting it. */
  return `\nThe developer's standing rules for this project. Follow them.\n\n${body}\n`;
}

/** The current plan, as text, so the model refines a thing rather than guessing at it. */
function planPrompt(detail: TestPlanDetail): string {
  return [
    `Plan: ${detail.name} (v${detail.version}, ${detail.status})`,
    detail.description && `About: ${detail.description}`,
    `Base URL: ${detail.baseUrl}`,
    `Variables: ${JSON.stringify(detail.variables)}`,
    `Steps:\n${JSON.stringify(detail.steps, null, 2)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The last failure, when there is one, because it changes what a refinement is
 * for.
 *
 * A developer who marked a failure `bad_test` is telling the agent the plan was
 * wrong, not the code -- and that is the single most useful sentence available
 * when rewriting it. `real_bug` is the opposite instruction: leave the assertion
 * alone, it caught something.
 */
function failurePrompt(detail: TestPlanDetail): string {
  const failure = detail.previousFailure;
  if (!failure) return '';

  const read = {
    real_bug:
      'The developer judged this a real bug in the code. Do not weaken the check that caught it.',
    bad_test: 'The developer judged this a bad test. The plan was wrong here, not the code.',
    undecided: 'The developer looked at this and could not tell which was wrong.',
  }[failure.verdict];

  return `\nThe last run failed at step ${failure.stepId}: expected ${failure.expected}, got ${failure.actual}. ${read}\n`;
}

export type Refinement = RevisionDraft & {
  /** The agent's own account of what it read. Kept for the transcript, not shown as prose. */
  findings: string;
  /** Which model wrote it, for the record. Never a key. */
  modelLabel: string;
};

/**
 * One turn: an instruction in, a whole next version out.
 *
 * Returns the plan as it should now read rather than a patch. A patch would have
 * to be applied by something, and that something would be a second place where a
 * plan's shape is known -- the version that lands is the version the agent wrote,
 * and `plan_revisions.changes` is the account of the difference rather than the
 * mechanism of it.
 */
export async function refinePlan(input: {
  detail: TestPlanDetail;
  instruction: string;
  rules: TestingRule[];
}): Promise<Refinement> {
  const { model, label } = await resolveModel();
  const research = await openResearch();

  const context = [
    HOUSE_RULES,
    rulesPrompt(input.rules),
    failurePrompt(input.detail),
    `\nThe plan as it stands:\n${planPrompt(input.detail)}`,
  ].join('\n');

  try {
    /* Pass one. No schema, because the job is to go and look -- and a model
       working towards a shape reads less than one working towards an answer. */
    const investigation = await generateText({
      model,
      system: context,
      prompt: [
        `The developer asks: "${input.instruction}"`,
        '',
        'Research whatever you need in the codebase to answer it well, then report',
        'what you found: the routes and handlers you read, the request and response',
        'shapes you confirmed, and anything you looked for and could not establish.',
        'Do not write the plan yet.',
      ].join('\n'),
      tools: research.tools,
      stopWhen: isStepCount(RESEARCH_STEPS),
    });

    /* Pass two. The tools are deliberately absent: this is a shaping call, and a
       model that can still reach for a file here will keep researching instead of
       committing to an answer. */
    const shaped = await generateObject({
      model,
      schema: revisionSchema,
      system: context,
      prompt: [
        `The developer asked: "${input.instruction}"`,
        '',
        'What you found when you looked:',
        investigation.text,
        '',
        `Write the plan as it should now read, in full, as version ${input.detail.version + 1}.`,
        'Carry over every step the instruction does not touch, unchanged and with the',
        'same ids, so that what you return is the whole plan and not a fragment of it.',
        '',
        'Then account for the difference: `summary` is what you changed and why,',
        'addressed to the developer who asked, and `changes` is the same thing per',
        'step so the diff can be read without prose.',
      ].join('\n'),
    });

    return { ...shaped.object, findings: investigation.text, modelLabel: label };
  } finally {
    /* Always. An open session holds the project's SQLite handle and possibly a
       sandbox on the developer's machine, and a thrown error is exactly when
       nothing else is going to clean either of them up. */
    await research.close().catch(() => {});
  }
}
