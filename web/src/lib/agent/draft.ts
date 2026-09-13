import { generateObject, generateText, stepCountIs, tool } from 'ai';
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
 * The agent, in one loop: look at the code, submit the plan, fix what the
 * check marks wrong, submit again.
 *
 * This used to be three passes -- research with tools, write without, verify
 * after -- and the middle one was the failure. A writer with no tools cannot
 * re-check anything, so routes and column names came out of memory rather than
 * the reading, and verification could only attach red verdicts to a plan nobody
 * would fix. The loop keeps the writer inside the agent: `submit_plan` is a
 * tool like the rest, its result is the per-step verdicts, and the model that
 * wrote a wrong step is the one holding the evidence of what the code has
 * instead, with the sandbox still warm.
 *
 * It also makes the transcript a thing that exists. The turns between tool
 * calls are the agent's own account of what it went and read, which is what a
 * developer asking "why did it write that" is actually asking about.
 */

/**
 * How many tool calls one draft or refinement may make, submits included.
 *
 * A budget rather than a natural stop, because the failure mode without one is not an
 * error -- it is an agent quietly reading a hundred files while somebody watches a
 * spinner.
 *
 * It was twelve, on the reasoning that twelve buys a route, its handler, one layer
 * down and a look at the schema. Measured against what drafts actually did, that was
 * wrong in a specific way: across every draft this project had stored, the agent spent
 * *three* calls in total and never once opened the sandbox or queried the database. A
 * tight budget does not make an agent read carefully, it makes evidence the most
 * expensive thing it can buy -- `start_sandbox` is one call and twenty-three seconds,
 * a schema query is another, and with twelve to spend the cheapest route to a finished
 * plan is to never look. Which is the exact inverse of what a developer does by hand,
 * and it is where the invented field names were coming from.
 *
 * One-fifty keeps that lesson and adds room for the fixing: research, up to three
 * submit-and-verify rounds, and the re-reading the verdicts send the loop back for.
 * The cost is real and it is wall-clock: a draft can take minutes rather than
 * seconds. That is the right trade for a plan a human is about to be asked to
 * approve.
 *
 * The number is the smallest of the levers, and it is worth being honest about the
 * order. Claude Code makes 50-200 tool calls on a task like this, but what makes it
 * reliable is that it runs what it wrote and reads the failure. A short agent that
 * executes beats a long one that only reads. This budget buys the reading; the submit
 * tool below buys the rest, because a plan nobody runs is a plan nobody checked.
 */
const LOOP_STEPS = 150;

/**
 * How many times the loop may submit before the plan lands as it stands.
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
 * How many times a loop that stopped without submitting is asked, plainly, to
 * submit before the runner stops asking and writes the plan itself.
 *
 * The loop ending with no submit is a small model declining to emit the whole
 * plan as one tool call -- it researched, then stopped rather than produce the
 * giant argument. A direct instruction in a continued conversation fixes the
 * common case; the fallback below fixes the rest.
 */
const MAX_NUDGES = 2;

/**
 * The loop contract, stated once for both entry points.
 *
 * The submit tool is the only way to finish: no submit, no plan, and the job
 * fails loudly rather than saving nothing. Verdicts come back as the tool's
 * result, so fixing is a continuation rather than a second draft. Teardown is
 * deliberately absent from the agent's responsibilities -- the runner takes the
 * sandbox down in a `finally`, because a teardown the agent forgets is a
 * container nobody owns.
 */
const LOOP_RULES = `
Work in one loop: research with the tools, then submit the whole plan with the
submit_plan tool. A submit is checked automatically and the verdicts come back as
the result: every step marked wrong names what the code has instead, so fix those
steps -- re-reading with the tools where you need to -- and submit the whole plan
again. The loop ends when a submit comes back with no wrong step, or after three
submits; then stop calling tools and finish with a short summary of what the plan
proves. Never call teardown -- the runner takes the sandbox down when the loop ends.
`.trim();

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
  submitDescription: string;
  wireSchema: typeof wireDraftSchema | typeof wireRevisionSchema;
  fromWire: (value: never) => P;
}): Promise<{
  plan: P;
  checks: StepCheck[];
  findings: string;
}> {
  const watch = input.watch;
  let submits = 0;
  let finished = false;
  let tornDown = false;
  const outcome: {
    current: { plan: P; checks: StepCheck[]; findings: string } | null;
  } = { current: null };

  const submit = tool({
    description: input.submitDescription,
    inputSchema: input.wireSchema,
    execute: async (value) => {
      submits += 1;
      let plan: P;
      try {
        plan = input.fromWire(value as never);
      } catch (error) {
        /* A malformed submit costs one tool step, not a research pass: the
           mistake quoted back is the correction turn the old pass two had, now
           without leaving the loop. */
        const complaint = error instanceof PlanShapeError ? error.message : String(error);
        return [
          `Submit ${submits} refused: ${complaint}`,
          'Send the whole plan again with that fixed, and change nothing else about it.',
        ].join('\n');
      }

      watch.note({
        phase: 'write',
        kind: 'note',
        label: `Submitted ${plan.steps.length} steps for checking.`,
      });
      const verified = await verifyPlan({
        model: input.model,
        tools: input.research.tools,
        steps: plan.steps,
        variables: plan.variables,
        baseUrl: input.baseUrl,
        watch,
      });
      outcome.current = { plan, checks: verified.checks, findings: verified.findings };

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

      if (wrong.length === 0) {
        finished = true;
        return [
          `Submit ${submits} checked: ${confirmed} confirmed, ${unsupported} unsupported, none wrong.`,
          'The plan is clean. Stop calling tools and finish with a short summary of what it proves.',
        ].join('\n');
      }
      if (submits >= MAX_SUBMITS) {
        finished = true;
        return [
          report(verified.checks),
          '',
          'That was the last submit: the plan lands with these verdicts attached.',
          'Stop calling tools and finish with a short summary of what it proves and what it still gets wrong.',
        ].join('\n');
      }
      const left = MAX_SUBMITS - submits;
      return [
        report(verified.checks),
        '',
        `Fix every step marked wrong -- the verdict names what the code has instead -- and submit the whole plan again. ${left} submit${left === 1 ? '' : 's'} left.`,
      ].join('\n');
    },
  });

  const callbacks = watching(watch, 'research');
  const tools = { ...input.research.tools, submit_plan: submit };
  const system = [input.system, LOOP_RULES].join('\n');
  const stops = [stepCountIs(LOOP_STEPS), () => finished];
  const onToolExecutionStart: typeof callbacks.onToolExecutionStart = (event) => {
    if (event.toolCall.toolName === 'teardown') tornDown = true;
    return callbacks.onToolExecutionStart(event);
  };
  const texts: string[] = [];
  try {
    let messages:
      | Parameters<typeof generateText>[0]['messages']
      | undefined;
    for (let round = 0; ; round++) {
      const loop = messages
        ? await generateText({
            model: input.model,
            system,
            messages,
            tools,
            stopWhen: stops,
            onStepEnd: callbacks.onStepEnd,
            onToolExecutionStart,
          })
        : await generateText({
            model: input.model,
            system,
            prompt: input.prompt,
            tools,
            stopWhen: stops,
            onStepEnd: callbacks.onStepEnd,
            onToolExecutionStart,
          });
      recordOutcomes(watch, 'research', loop.content);
      texts.push(loop.text);
      if (outcome.current) break;
      if (round >= MAX_NUDGES) break;
      watch.note({
        phase: 'write',
        kind: 'note',
        label: 'The loop stopped without submitting -- asking it to submit.',
      });
      messages = [
        ...loop.response.messages,
        {
          role: 'user' as const,
          content:
            'You stopped without submitting. Call submit_plan now with the complete plan -- every step, the variables, everything the schema asks for. Do not write the plan as text; the tool call is the only way it lands.',
        },
      ];
    }
    const last = outcome.current;
    if (last) {
      return { ...last, findings: [...texts, last.findings].filter(Boolean).join('\n\n') };
    }
    return await fallbackPlan(input, texts, watch);
  } finally {
    /* Always. The agent is told never to call teardown itself, so an exit
       without one is the normal path rather than a lapse -- and a thrown error
       is exactly when nothing else is going to clean the sandbox up. */
    if (!tornDown) await teardownSandbox(input.research, watch);
  }
}

/**
 * The constrained write, kept as the fallback for a model that researched and
 * then would not emit the whole plan as a tool call.
 *
 * One structured call over the loop's own findings, one correction turn on a
 * shape refusal, then a single verification -- the old pipeline, run once, with
 * no fixing loop after it. What lands carries whatever checks that one
 * verification returned, red rows included.
 */
async function fallbackPlan<P extends SubmittedPlan>(
  input: {
    model: LanguageModel;
    research: Research;
    system: string;
    prompt: string;
    baseUrl: string;
    watch: Watcher;
    wireSchema: typeof wireDraftSchema | typeof wireRevisionSchema;
    fromWire: (value: never) => P;
  },
  texts: string[],
  watch: Watcher,
): Promise<{ plan: P; checks: StepCheck[]; findings: string }> {
  watch.note({
    phase: 'write',
    kind: 'note',
    label: 'No submit came back, so writing the plan once directly and checking it.',
  });
  const prompt = [
    input.prompt,
    '',
    'What you found when you looked:',
    texts.filter(Boolean).join('\n\n'),
    '',
    'submit_plan is unavailable: return the plan itself as the answer, in full.',
  ].join('\n');

  const attempt = async (correction: string): Promise<P> => {
    const out = await generateObject({
      model: input.model,
      schema: input.wireSchema,
      system: input.system,
      prompt: correction ? `${prompt}\n${correction}` : prompt,
    });
    return input.fromWire(out.object as never);
  };

  let plan: P;
  try {
    plan = await attempt('');
  } catch (error) {
    if (!(error instanceof PlanShapeError)) throw error;
    console.warn(`draft: fallback refused (${error.message}) -- asking once for a correction`);
    plan = await attempt(
      [
        '',
        'Your last answer did not load:',
        error.message,
        'Send the whole plan again with that fixed, and change nothing else about it.',
      ].join('\n'),
    );
  }

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
  return {
    plan,
    checks: verified.checks,
    findings: [...texts, verified.findings].filter(Boolean).join('\n\n'),
  };
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
    if (watch.resumeFrom) {
      watch.note({
        phase: 'research',
        kind: 'note',
        label: 'Picked up where the last attempt got to, reusing what it read.',
      });
    } else {
      watch.note({ phase: 'research', kind: 'note', label: 'Reading the code.' });
    }
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
        'you look for and cannot establish. Then submit the plan as it should now read,',
        `in full, as version ${input.detail.version + 1}: carry over every step the`,
        'instruction does not touch, unchanged and with the same ids, so that what you',
        'submit is the whole plan and not a fragment of it.',
        '',
        'Then account for the difference: summary is what you changed and why,',
        'addressed to the developer who asked, and changes is the same thing per',
        'step so the diff can be read without prose.',
      ].join('\n'),
      baseUrl: input.detail.baseUrl,
      watch,
      submitDescription:
        'Submit the revised plan in full for automatic checking. The verdicts per step come back as the result: fix every step marked wrong and submit again.',
      wireSchema: wireRevisionSchema,
      fromWire: (value) => revisionFromWire(value),
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
    if (watch.resumeFrom) {
      watch.note({
        phase: 'research',
        kind: 'note',
        label: 'Picked up where the last attempt got to, reusing what it read.',
      });
    } else {
      watch.note({ phase: 'research', kind: 'note', label: 'Reading the code.' });
    }
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
        '',
        `The plan will run against ${input.baseUrl}, so every step's url is relative to that.`,
        input.name
          ? `The developer named it "${input.name}". Keep that name.`
          : 'Name it yourself, after what it proves.',
        '',
        'Then submit the plan: the steps in the order they have to happen, each one',
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
      ].join('\n'),
      baseUrl: input.baseUrl,
      watch,
      submitDescription:
        'Submit the whole plan for automatic checking. The verdicts per step come back as the result: fix every step marked wrong and submit again.',
      wireSchema: wireDraftSchema,
      fromWire: (value) => draftFromWire(value),
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

