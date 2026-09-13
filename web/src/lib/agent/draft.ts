import { generateObject, generateText, stepCountIs } from 'ai';
import type { LanguageModel } from 'ai';
import { resolveModel, type Session } from './model';
import { openResearch, requireBootable, type Research } from './research';
import { verifyPlan } from './verify';
import { unwatched, recordOutcomes, watching } from './watch';
import {
  PlanShapeError,
  draftFromWire,
  revisionFromWire,
  wireDraftSchema,
  wireRevisionSchema,
  type PlanDraft,
  type RevisionDraft,
} from './plan-schema';
import type { Watcher } from './watch';
import type { PlanStepSpec, StepCheck, TestPlanDetail, TestingRule } from '@/lib/model';

/**
 * The agent, in a loop: look at the code, write the plan, check it, fix what
 * the check marks wrong, write again.
 *
 * Research and writing are different jobs and get different calls. Research
 * runs with tools and no schema, because a model working towards a shape reads
 * less than one working towards an answer. Writing runs with the schema and no
 * tools, because a small model asked to emit the whole plan as a tool call
 * errors instead -- measured, not theorised -- while the constrained call
 * lands. Verification runs with tools again and its verdicts go back into the
 * next write as text, which is how a wrong step gets fixed by the pass that
 * can see the evidence rather than merely flagged by it.
 *
 * It also makes the transcript a thing that exists. The turns between tool
 * calls are the agent's own account of what it went and read, which is what a
 * developer asking "why did it write that" is actually asking about.
 */

/**
 * How many submit-and-verify rounds the loop may run before the plan lands as
 * it stands.
 *
 * A submit that comes back with no `wrong` step ends the loop on its own. Three
 * is the cap for the other case: an agent that still writes wrong steps after
 * seeing the verifier's evidence twice is not going to get it right on a third
 * try, and a retry loop that burns minutes on a plan that needs hand-editing is
 * worse than a plan that arrives with red rows. Save with red rows is the honest
 * outcome, and the verdicts say what the code has instead, so the edit is one
 * the developer can make in one pass.
 */
const MAX_SUBMITS = 3;

/**
 * How many tool calls the first research round may make.
 *
 * A hundred buys the sandbox, information_schema, a handler through two layers
 * and the reading that actually shapes the plan. The old twelve taught the lesson
 * the other way: a tight budget makes evidence the most expensive thing the agent
 * can buy, and the cheapest route to a finished plan becomes never looking.
 */
const RESEARCH_BUDGET = 100;

/** How many tool calls a top-up round after a failed check may make. */
const TOPUP_BUDGET = 30;

/** A submitted plan, in the shape the dashboard stores and the runner reads. */
type SubmittedPlan = {
  steps: PlanStepSpec[];
  variables: Record<string, string>;
};

/**
 * One loop for both entry points: research, submit, fix, resubmit.
 *
 * Returns the last submitted plan with the checks from its verification, so a
 * loop that ran out of submits lands with red rows rather than nothing. A loop
 * that never submits gets nudged, then written once directly and checked -- the
 * old constrained path, kept as the fallback for a model that will not emit the
 * whole plan as a tool call. Only a fallback that also fails throws, because
 * research with no plan is a failure, and failing loudly is what keeps it
 * visible.
 */
async function runLoop<P extends SubmittedPlan>(input: {
  model: LanguageModel;
  research: Research;
  system: string;
  prompt: string;
  baseUrl: string;
  watch: Watcher;
  wireSchema: typeof wireDraftSchema | typeof wireRevisionSchema;
  fromWire: (value: never) => P;
  writePrompt: (findings: string, correction: string) => string;
}): Promise<{
  plan: P;
  checks: StepCheck[];
  findings: string;
}> {
  const watch = input.watch;
  let tornDown = false;
  const callbacks = watching(watch, 'research');
  const onToolExecutionStart: typeof callbacks.onToolExecutionStart = (event) => {
    if (event.toolCall.toolName === 'teardown') tornDown = true;
    return callbacks.onToolExecutionStart(event);
  };
  const findings: string[] = [];

  /* One research round, first or top-up: tools on, no schema, because a model
     working towards a shape reads less than one working towards an answer. */
  const researchRound = async (extra: string | null, budget: number): Promise<void> => {
    const loop = await generateText({
      model: input.model,
      system: input.system,
      prompt: [
        input.prompt,
        ...(extra ? ['', extra] : []),
        '',
        'Never call teardown -- the runner takes the sandbox down when the work ends.',
      ].join('\n'),
      tools: input.research.tools,
      stopWhen: stepCountIs(budget),
      onStepEnd: callbacks.onStepEnd,
      onToolExecutionStart,
    });
    recordOutcomes(watch, 'research', loop.content);
    if (loop.text.trim()) findings.push(loop.text);
  };

  /* One submit: the constrained call, with one correction turn on a shape
     refusal. Constrained because a small model asked to emit the whole plan as
     a tool call errors instead -- measured, not theorised -- and the schema is
     what makes the answer a plan rather than prose about one. */
  const submitRound = async (correction: string): Promise<P> => {
    const prompt = input.writePrompt(findings.join('\n\n'), correction);
    try {
      const out = await generateObject({
        model: input.model,
        schema: input.wireSchema,
        system: input.system,
        prompt,
      });
      return input.fromWire(out.object as never);
    } catch (error) {
      if (!(error instanceof PlanShapeError)) throw error;
      console.warn(`draft: submit refused (${error.message}) -- asking once for a correction`);
      const retry = await generateObject({
        model: input.model,
        schema: input.wireSchema,
        system: input.system,
        prompt: input.writePrompt(
          findings.join('\n\n'),
          [
            'Your last answer did not load:',
            error.message,
            'Send the whole plan again with that fixed, and change nothing else about it.',
          ].join('\n'),
        ),
      });
      return input.fromWire(retry.object as never);
    }
  };

  try {
    /* Skipped outright when a previous attempt at this same job already did it:
       its findings are in the record, and the reading is the expensive part. */
    if (watch.resumeFrom) {
      watch.note({
        phase: 'research',
        kind: 'note',
        label: 'Picked up where the last attempt got to, reusing what it read.',
      });
      findings.push(watch.resumeFrom);
    } else {
      watch.note({ phase: 'research', kind: 'note', label: 'Reading the code.' });
      await researchRound(null, RESEARCH_BUDGET);
      /* The one `findings` note per job: a resume reads it back rather than
         paying for the reading twice. */
      if (findings.length > 0) {
        watch.note({ phase: 'research', kind: 'findings', label: findings.join('\n\n') });
      }
    }

    let correction = '';
    for (let round = 1; ; round++) {
      const plan = await submitRound(correction);
      watch.note({
        phase: 'write',
        kind: 'note',
        label:
          round === 1
            ? `Wrote ${plan.steps.length} steps.`
            : `Rewrote ${plan.steps.length} steps after checking.`,
      });

      watch.note({
        phase: 'verify',
        kind: 'note',
        label: `Checking ${plan.steps.length} steps against the code.`,
      });
      const verified = await verifyPlan({
        model: input.model,
        tools: input.research.tools,
        steps: plan.steps,
        variables: plan.variables,
        baseUrl: input.baseUrl,
        watch,
      });

      const wrong = verified.checks.filter((c) => c.verdict === 'wrong');
      const confirmed = verified.checks.filter((c) => c.verdict === 'confirmed').length;
      const unsupported = verified.checks.length - wrong.length - confirmed;
      watch.note({
        phase: 'write',
        kind: 'note',
        label:
          wrong.length === 0
            ? `Checking came back clean: ${confirmed} confirmed, ${unsupported} unsupported.`
            : `Checking marked ${wrong.length} wrong, ${confirmed} confirmed, ${unsupported} unsupported.`,
      });

      if (wrong.length === 0 || round >= MAX_SUBMITS) {
        return {
          plan,
          checks: verified.checks,
          findings: [...findings, verified.findings].filter(Boolean).join('\n\n'),
        };
      }

      /* The verdicts name what the code has instead, so the next submit fixes
         from evidence rather than memory -- with a top-up round first, because
         a verdict can point at a file the loop has not read yet. */
      correction = [
        report(verified.checks),
        '',
        'Fix every step marked wrong and return the whole plan again, corrected and complete.',
      ].join('\n');
      watch.note({
        phase: 'write',
        kind: 'note',
        label: 'Reading again for what the checking marked wrong.',
      });
      await researchRound(
        [
          'The checker marked steps of the last draft wrong:',
          report(verified.checks),
          '',
          'Read what settles each one: the route in the index, the handler, the columns in information_schema.',
        ].join('\n'),
        TOPUP_BUDGET,
      );
    }
  } finally {
    /* Always. The agent is told never to call teardown itself, so an exit
       without one is the normal path rather than a lapse -- and a thrown error
       is exactly when nothing else is going to clean the sandbox up. */
    if (!tornDown) await teardownSandbox(input.research, watch);
  }
}


/** The verdicts back as the fix list the next submit answers. */
function report(checks: StepCheck[]): string {
  const wrong = checks.filter((c) => c.verdict === 'wrong');
  const confirmed = checks.filter((c) => c.verdict === 'confirmed').length;
  const unsupported = checks.length - wrong.length - confirmed;
  const lines = [
    `Verdicts: ${confirmed} confirmed, ${unsupported} unsupported, ${wrong.length} wrong.`,
  ];
  for (const c of wrong) lines.push(`- ${c.stepId}: WRONG -- ${c.note || 'no detail recorded'}`);
  return lines.join('\n');
}

/**
 * The sandbox down at the loop's end, through the tool rather than around it.
 *
 * Missing tool (an older CLI) or a teardown that throws is a warning rather than
 * a failure: the loop's plan is already in hand, and a container left running is
 * housekeeping, not a wrong answer. The CLI's own idle timeout is the backstop
 * for the cases this cannot reach.
 */
async function teardownSandbox(research: Research, watch: Watcher): Promise<void> {
  const candidate = (research.tools as Record<string, unknown>).teardown;
  if (!candidate || typeof candidate !== 'object') return;
  const execute = (candidate as { execute?: unknown }).execute;
  if (typeof execute !== 'function') return;
  try {
    await (execute as (args: unknown, options: unknown) => Promise<unknown>)(
      {},
      { toolCallId: 'loop-teardown', messages: [] },
    );
    watch.note({ phase: 'research', kind: 'tool', label: 'Took the sandbox down' });
  } catch (error) {
    console.warn('draft: final teardown failed:', error instanceof Error ? error.message : error);
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

Read the database, do not reason about it. \`start_sandbox\` brings up a copy of this
project with its own migrations and seed data applied, and \`db\` queries it -- so
information_schema tells you what a column is really called, and a SELECT against a
seeded table tells you what a row actually looks like. Both are worth their cost:
a column name you guessed at is a step that fails on a typo and reads like a bug in
the code. Use the seeded data too, rather than inventing an account -- a plan that
signs in as a guest that exists is a plan whose first step passes.

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

Extract paths are relative to the payload: \`data.token\`, never \`body.data.token\`.
The source already says where to look (\`body\`, \`header\`, \`result\`, \`stdout\`), so
a path repeating it looks for a key that does not exist and the extraction fails.
An assertion target and an extraction path for the same value always read identically.

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
  /** How each step came out when it was checked. Empty when verification could not run. */
  checks: StepCheck[];
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
  /**
   * Somewhere to say what it is doing, when this is queued work rather than a
   * request somebody is waiting on. Omitted everywhere else, and the agent behaves
   * identically either way.
   */
  watch?: Watcher;
  /** Pre-read session to avoid `cookies()` inside `after()`. */
  session?: Session | null;
}): Promise<Refinement> {
  const watch = input.watch ?? unwatched;
  const { model, label } = await resolveModel(input.session);
  const research = await openResearch();
  const context = [
    HOUSE_RULES,
    rulesPrompt(input.rules),
    failurePrompt(input.detail),
    `\nThe plan as it stands:\n${planPrompt(input.detail)}`,
  ].join('\n');

  try {
    // Before a single model call: drafting into a project that cannot boot burns
    // a full loop to conclude what one status read already knows.
    await requireBootable(research);
    const out = await runLoop({
      model,
      research,
      system: context,
      prompt: [
        `The developer asks: "${input.instruction}"`,
        ...(watch.resumeFrom
          ? [
              '',
              'A previous attempt already researched this. What it found:',
              watch.resumeFrom,
              '',
              'Confirm it and fill the gaps rather than starting over. Anything already',
              'established needs one check that it is still true, not a fresh investigation;',
              'spend the reading on what the revision needs and the findings do not cover.',
            ]
          : []),
        '',
        'Research whatever you need in the codebase to answer it well: the routes and',
        'handlers involved, the request and response shapes you confirm, and anything',
        'you look for and cannot establish. Report what you read and what you could',
        'not establish.',
      ].join('\n'),
      baseUrl: input.detail.baseUrl,
      watch,
      wireSchema: wireRevisionSchema,
      fromWire: (value) => revisionFromWire(value),
      writePrompt: (findings, correction) =>
        [
          `The developer asked: "${input.instruction}"`,
          '',
          'What you found when you looked:',
          findings,
          '',
          `Write the plan as it should now read, in full, as version ${input.detail.version + 1}.`,
          'Carry over every step the instruction does not touch, unchanged and with the',
          'same ids, so that what you return is the whole plan and not a fragment of it.',
          '',
          'Then account for the difference: summary is what you changed and why,',
          'addressed to the developer who asked, and changes is the same thing per',
          'step so the diff can be read without prose.',
          ...(correction ? ['', correction] : []),
        ].join('\n'),
    });

    return {
      ...out.plan,
      checks: out.checks,
      findings: out.findings,
      modelLabel: label,
    };
  } finally {
    /* Always. An open session holds the project's SQLite handle and possibly a
       sandbox on the developer's machine, and a thrown error is exactly when
       nothing else is going to clean either of them up. */
    await research.close().catch(() => {});
  }
}



export type Draft = PlanDraft & {
  /** How each step came out when it was checked. Empty when verification could not run. */
  checks: StepCheck[];
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
  /** See `refinePlan`. Notes go here when this is queued work. */
  watch?: Watcher;
  /** Pre-read session to avoid `cookies()` inside `after()`. */
  session?: Session | null;
}): Promise<Draft> {
  const watch = input.watch ?? unwatched;
  const { model, label } = await resolveModel(input.session);
  const research = await openResearch();
  const context = [HOUSE_RULES, rulesPrompt(input.rules)].join('\n');

  try {
    // Before a single model call: drafting into a project that cannot boot burns
    // a full loop to conclude what one status read already knows.
    await requireBootable(research);
    const out = await runLoop({
      model,
      research,
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
        'Report what you read and what you could not establish.',
      ].join('\n'),
      baseUrl: input.baseUrl,
      watch,
      wireSchema: wireDraftSchema,
      fromWire: (value) => draftFromWire(value),
      writePrompt: (findings, correction) =>
        [
          `The developer asked for: "${input.brief}"`,
          '',
          'What you found when you looked:',
          findings,
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
          ...(correction ? ['', correction] : []),
        ].join('\n'),
    });

    return {
      ...out.plan,
      checks: out.checks,
      findings: out.findings,
      modelLabel: label,
    };
  } finally {
    await research.close().catch(() => {});
  }
}


