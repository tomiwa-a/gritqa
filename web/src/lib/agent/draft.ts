import { generateObject, generateText, isStepCount } from 'ai';
import { resolveModel } from './model';
import { openResearch } from './research';
import {
  PlanShapeError,
  draftFromWire,
  revisionFromWire,
  wireDraftSchema,
  wireRevisionSchema,
  type PlanDraft,
  type RevisionDraft,
} from './plan-schema';
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
 * Pass two, with one correction turn.
 *
 * A reply can satisfy the schema and still not be a plan: `stepFromWire` refuses a
 * payload that contradicts its own `kind`, and `loadable` refuses one the runner could
 * not interpolate. Both used to throw straight out of a call that had already spent
 * minutes researching, and take the research down with them -- so the refusal that
 * exists to be loud was also the most expensive way to fail. Quoting the mistake back
 * and asking once costs a reshape, which is what pass two is for. The CLI has done
 * exactly this since M2 (`draft/prompt.go`'s `correction`); this is the same turn on
 * the other side of the seam.
 *
 * Only a shape error earns the second call. A model or transport failure would spend
 * the same minutes to fail the same way.
 */
async function shaped<T>(attempt: (correction: string) => Promise<T>): Promise<T> {
  try {
    return await attempt('');
  } catch (error) {
    if (!(error instanceof PlanShapeError)) throw error;
    console.warn(`draft: ${error.message} -- asking for a correction`);
    return attempt(
      [
        '',
        `Your last answer did not load: ${error.message}`,
        'Send the whole plan again with that fixed, and change nothing else about it.',
      ].join('\n'),
    );
  }
}

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

A path is copied, never composed. Take it character for character from what you
read -- including any query string, prefix or file name in it -- because that is
what the project routes on, and a path you tidied into the one the framework
*ought* to use is a 404 on every step that touches it.

Paths in \`covers\` are route patterns -- /customers/:id/orders, never
/customers/42/orders. Coverage is keyed by pattern, so a concrete id there joins
to nothing.

Never write a credential into a plan. Give it a variable -- adminPassword -- with
a value that is plainly a placeholder, and reference it as {{adminPassword}}. The
developer's own config maps that name to an environment variable on their machine,
and the resolved value overrides whatever the plan declares, so the secret never
has to be written down here. Note the names that need mapping in \`assumptions\`: an
unmapped one refuses the run before the first request, which is a better outcome
than a 401 that reads as a bug in the code.

Every {{name}} is either a variable the plan declares or a value an earlier step
extracted, with one exception the engine supplies: {{runId}} is different on every
run. Use it wherever a value has to be new, or the second run fails on a row the
first one left behind -- guest-{{runId}}@example.com rather than a literal address
somebody has to remember to change. Nothing else is supplied for you: no date
arithmetic, no now(), no random, and no way to read the environment from a step. A
date is a literal -- 2026-09-01 -- declared once as a variable so the request that
sends it and the assertion that checks it read the same one. A {{name}} nothing
supplies is a step that sends those characters to the API verbatim.

The other direction is a tell too: a value a step extracts and no later step
reads is a value you meant to send and did not.

Most steps are requests. Two other kinds exist, and both are for the things a
request cannot do:

A \`sql\` step with \`action.target: "verify"\` reads the database for evidence. Write
one whenever an endpoint changes something and its own response does not prove it:
a 201 with an id in it is the code's account of what it did, not a row. Assert on
\`rowCount\`, or on \`valueEquals\` with a target into the result -- rows[0].total.
Never string-match a result set; a query returns values, not text.

A \`sql\` step with \`action.target: "setup"\` writes, and it is how a plan gets the
data it needs to exist. Prefer it to spending three requests on a sign-up and a
login before the feature under test: those steps fail for their own reasons, and
when they do the report reads as a failure of the thing you were proving.

A \`shell\` step runs a command inside GritQA's container, with the project mounted.
It is the last resort, for the project's own tooling -- a migration, a cache to
clear, a fixture script that already exists. Assert on \`exitCode\`, or
\`stdoutContains\` where the command prints something worth reading. If a request or
a statement can do the job, one of those is the step to write.
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
    const revision = await shaped(async (correction) => {
      const out = await generateObject({
        model,
        schema: wireRevisionSchema,
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
          correction,
        ].join('\n'),
      });
      return revisionFromWire(out.object);
    });

    return { ...revision, findings: investigation.text, modelLabel: label };
  } finally {
    /* Always. An open session holds the project's SQLite handle and possibly a
       sandbox on the developer's machine, and a thrown error is exactly when
       nothing else is going to clean either of them up. */
    await research.close().catch(() => {});
  }
}

export type Draft = PlanDraft & {
  /** The agent's own account of what it read. Kept for the transcript, not shown as prose. */
  findings: string;
  /** Which model wrote it, for the record. Never a key. */
  modelLabel: string;
};

/**
 * A plan from nothing but a sentence about what it should prove.
 *
 * The same two passes as a refinement, and for a stronger reason: there is no
 * existing plan here to fall back on, so everything the draft says about the API has
 * to have come from reading the API. A model asked to research and emit JSON in one
 * call does noticeably less of the reading, because it is working towards a shape.
 *
 * The brief is the developer's own words and it is deliberately not parsed. Turning
 * "refund part of a charge, then try to refund more than what is left" into steps is
 * the whole job; a form that made them pick endpoints and methods first would be
 * asking them to do it by hand and then also describe it.
 *
 * A draft that came out of a conversation is handed what that conversation found, and
 * still researches. Skipping pass one on the strength of it would be drafting with no
 * connection to the machine at all -- and a conversation held ten minutes ago is a
 * cache, which is the one thing research is not allowed to be: a plan built on a
 * previous state of the tree is confidently wrong about code that has since changed.
 * It would also make the unreachable-CLI failure impossible to hit on this path,
 * quietly making an unverified plan cheaper to produce than a verified one. What the
 * prior findings buy is the difference between confirming a route and finding it.
 */
export async function draftPlan(input: {
  /** What the plan should prove, in the developer's words. */
  brief: string;
  /** Where the plan will run. Recorded on the plan, not called during drafting. */
  baseUrl: string;
  /** A name the developer supplied, if they bothered. The agent writes one otherwise. */
  name?: string;
  rules: TestingRule[];
  /**
   * What a conversation already established about this code, when the draft came out
   * of one. Context for pass one, not a substitute for it -- see below.
   */
  priorFindings?: string;
}): Promise<Draft> {
  const { model, label } = await resolveModel();
  const research = await openResearch();

  const context = [HOUSE_RULES, rulesPrompt(input.rules)].join('\n');

  try {
    const investigation = await generateText({
      model,
      system: context,
      prompt: [
        `The developer wants a test plan that proves this: "${input.brief}"`,
        ...(input.priorFindings
          ? [
              '',
              'You already looked at this code, in a conversation that led here. What you',
              'found then:',
              input.priorFindings,
              '',
              'Confirm it and fill the gaps rather than starting over. Anything you already',
              'established needs one check that it is still true, not a fresh investigation;',
              'spend the reading on what a plan needs and a conversation did not cover.',
            ]
          : []),
        '',
        'Go and find out how the code actually does it. The routes involved and their',
        'real paths, the exact field names each one reads off the request and returns in',
        'its response, which of them need a signed-in caller and how the code expects that',
        'credential to arrive -- a header, a cookie, a parameter -- and what has to exist',
        'before a step can run. Find out which values a run is already given, so the plan',
        'refers to those rather than inventing an account that does not exist.',
        'Report what you read and what you could not establish. Do not write the plan yet.',
      ].join('\n'),
      tools: research.tools,
      stopWhen: isStepCount(RESEARCH_STEPS),
    });

    const draft = await shaped(async (correction) => {
      const out = await generateObject({
        model,
        schema: wireDraftSchema,
        system: context,
        prompt: [
          `The developer asked for: "${input.brief}"`,
          '',
          'What you found when you looked:',
          investigation.text,
          '',
          `The plan will run against ${input.baseUrl}, so every step's url is relative to that.`,
          input.name
            ? `The developer named it "${input.name}". Keep that name.`
            : 'Name it yourself, after what it proves.',
          '',
          'Now write the plan: the steps in the order they have to happen, each one',
          'depending on the steps whose output it needs, with the values a later step reads',
          "declared in the earlier step's `extract`. Assert what the brief is actually about,",
          'and abort rather than continue where a failure makes everything after it noise.',
          '',
          'Write out what each request actually sends. A step whose body, headers or query',
          'you leave empty is a step that will be called empty: a sign-up with no fields, an',
          'authenticated route with no credential on it. Put the values a run is given in',
          '`variables` and refer to them as {{name}} instead of writing a literal, and where',
          'you are checking a value the plan itself supplied, assert against that {{name}} or',
          'against what an earlier step extracted rather than against a copy of it.',
          '',
          'Only steps you can justify from what you read. A plan of four real requests is',
          'worth more than one of nine where five were guessed at.',
          correction,
        ].join('\n'),
      });
      return draftFromWire(out.object);
    });

    return { ...draft, findings: investigation.text, modelLabel: label };
  } finally {
    await research.close().catch(() => {});
  }
}
