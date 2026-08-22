import { z } from 'zod';
import type { Endpoint, PlanAssertion, PlanExtraction, PlanStepSpec, StepKind } from '@/lib/model';
import { unloadable } from '@/lib/plan';

/**
 * What the agent is allowed to produce, which is exactly what the dashboard
 * already renders.
 *
 * `mock/types.ts` -- now `lib/model.ts` -- has been the read model since before any
 * of this existed, and every screen is built against it: `plan-diff.tsx` colours
 * rows by `PlanChange['kind']`, the JSON tab pretty-prints `plan_json` verbatim,
 * `coverage.ts` joins on `covers`. So the schema below is a mirror of those types
 * rather than a new shape for the model's convenience. Anything the agent invents
 * outside it would reach a component that has no branch for it.
 *
 * Mirroring by hand is the cost, and `MIRRORS_MODEL` below is what keeps it from
 * being paid twice: the compiler holds the four shapes identical in both directions,
 * so a union widened on either side is an error here rather than a screen with no
 * branch for a value the agent can now produce.
 */

const method = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const endpointSchema = z.object({
  method,
  /**
   * A route pattern, not a resolved URL -- `/orders/:id`, never `/orders/42`.
   * Coverage is keyed by pattern, so a concrete id here joins to nothing.
   */
  path: z.string().min(1).describe('Route pattern with named params, e.g. /customers/:id/orders'),
});

/**
 * The eight things an assertion can be about, widened rather than forked.
 *
 * One schema for all three step kinds, because the operator, the target and the
 * expected value mean the same thing in every case -- so `plan-diff.tsx`, the rules
 * engine and `assertionCount` keep working with no branch. What the type list buys is
 * the one thing worth buying: `stdoutContains` on a query is refused rather than
 * quietly always-true, and a result set is asserted on by counting its rows or reading
 * a value out of one, never by string-matching the rows as printed text.
 *
 * `ASSERTIONS_BY_KIND` below is what enforces that pairing; the enum on its own only
 * says these eight exist.
 */
export const assertionSchema = z.object({
  type: z.enum([
    'status',
    'bodyField',
    'header',
    'responseTime',
    'rowCount',
    'valueEquals',
    'exitCode',
    'stdoutContains',
  ]),
  operator: z.enum(['equals', 'notEquals', 'contains', 'notContains', 'exists', 'lt', 'gt']),
  target: z
    .string()
    .min(1)
    .describe(
      'What is being checked: a JSON path for bodyField, a header name, "status", or a path into the result set for valueEquals -- rows[0].total',
    ),
  /* Optional because `exists` has nothing to compare against. */
  expected: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

/**
 * Which assertions belong to which kind. A step is checked against its own row on the
 * way in from the model, so a mismatch is a rejected draft rather than a check that
 * can never fail.
 *
 * `rowCount` and `exitCode` have no target to speak of -- there is one row count and
 * one exit code -- so the schema's `min(1)` on `target` is satisfied by the name of
 * the thing itself, the way `status` already is.
 */
const ASSERTIONS_BY_KIND = {
  http: ['status', 'bodyField', 'header', 'responseTime'],
  sql: ['rowCount', 'valueEquals'],
  shell: ['exitCode', 'stdoutContains'],
} as const satisfies Record<StepKind, readonly PlanAssertion['type'][]>;

export const extractionSchema = z.object({
  name: z.string().min(1).describe('Variable name later steps refer to as {{name}}'),
  path: z.string().min(1),
  /**
   * `result` and `stdout` are what let a fixture feed the request after it: an insert
   * hands over a real booking id instead of the draft inventing one.
   */
  source: z.enum(['body', 'header', 'result', 'stdout']),
});

/**
 * What a sql or shell step does, where a request step has a request.
 *
 * Three optional strings on one flat object rather than a union of three shapes, and
 * that is a decision about the dialect below rather than about taste -- `oneOf` is the
 * same family of construct as the free-form map that cost this file its first draft.
 * It is also, by luck, exactly the shape the runner already reads
 * (`Action` in `cli/internal/plan/plan.go`), and that format is decoded with unknown
 * fields disallowed, so it is the shape or nothing.
 *
 * `target` is load-bearing rather than descriptive: it decides whether the statement
 * is executed or queried, and a step that writes is what the approval confirm is drawn
 * from. See `stepFromWire` for what happens when a draft leaves it out.
 */
export const actionSchema = z.object({
  statement: z.string().min(1).optional(),
  target: z.enum(['setup', 'verify']).optional(),
  command: z.string().min(1).optional(),
});

export const requestSchema = z.object({
  method,
  /**
   * Relative to `baseUrl`, with `{{variable}}` for anything extracted earlier.
   * The runner substitutes; the plan holds the template.
   */
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
  query: z.record(z.string(), z.string()).optional(),
});

export const stepSchema = z.object({
  id: z.string().min(1).describe('Stable within the plan; later steps depend on it by this id'),
  name: z.string().min(1),
  description: z.string(),
  dependsOn: z
    .array(z.string())
    .describe('Step ids that must pass first. Empty for the first step'),
  /**
   * Absent means `http`, which is what every plan written before the other two kinds
   * existed is made of. Nothing to migrate: the runner reads an absent kind the same
   * way, and `plan_json` is one jsonb blob either way.
   */
  kind: z.enum(['http', 'sql', 'shell']).optional(),
  /** One of these two, decided by `kind`. Never both, and never neither. */
  request: requestSchema.optional(),
  action: actionSchema.optional(),
  extract: z.array(extractionSchema),
  assertions: z.array(assertionSchema),
  /**
   * `abort` when later steps cannot mean anything without this one -- a failed
   * sign-in makes every authenticated step after it noise rather than evidence.
   */
  onFailure: z.enum(['abort', 'continue']),
  retry: z
    .object({ maxAttempts: z.number().int().min(1), delayMs: z.number().int().min(0) })
    .optional(),
});

/* ---------------------------------------------------------------------------
 * The mirror, held by the compiler
 * ------------------------------------------------------------------------- */

/** True only when each type is assignable to the other -- identical, not merely close. */
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type Assert<T extends true> = T;

/**
 * The four shapes above, checked against the read model they claim to copy.
 *
 * Both directions, which is the point. One direction only catches the schema drifting
 * past `model.ts` -- and the drift that actually costs something goes the other way: a
 * ninth `AssertionType` or a fourth `StepKind` added to `model.ts` and not here is an
 * agent that cannot produce a value every screen is already prepared to render, with
 * nothing anywhere saying so. Now it does not compile.
 *
 * Types and nothing else: no value, no runtime cost, and no import for anyone. What it
 * costs is that a deliberate divergence has to be written down rather than discovered,
 * which is the trade this file was already making by hand.
 */
export type MIRRORS_MODEL = [
  Assert<Exactly<z.infer<typeof endpointSchema>, Endpoint>>,
  Assert<Exactly<z.infer<typeof assertionSchema>, PlanAssertion>>,
  Assert<Exactly<z.infer<typeof extractionSchema>, PlanExtraction>>,
  Assert<Exactly<z.infer<typeof stepSchema>, PlanStepSpec>>,
];

export const changeSchema = z.object({
  kind: z.enum([
    'step_added',
    'step_removed',
    'step_reordered',
    'assertion_added',
    'assertion_removed',
    'value_changed',
  ]),
  /** The step it happened to, by name, because that is what the diff rows group by. */
  stepName: z.string().min(1),
  detail: z.string().min(1).describe('One phrase, in the past tense, about this one change'),
  from: z.string().optional(),
  to: z.string().optional(),
});

/**
 * The whole of a revision: the plan as it should now read, plus an account of
 * what moved.
 *
 * The account is not decoration and not derivable. `plan_revisions` exists
 * because a version number records that a plan changed and never why, and the
 * why is the half a developer scrolling the history actually wants -- they would
 * otherwise be diffing two JSON blobs to infer a sentence somebody could have
 * just written down.
 */
export const revisionSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe('Keep the existing name unless the instruction changes what the plan is about'),
  description: z.string(),
  variables: z
    .record(z.string(), z.string())
    .describe(
      'Plan-level values steps interpolate. A credential is a name with a placeholder value the developer maps to their environment, never the literal secret',
    ),
  covers: z
    .array(endpointSchema)
    .describe('The endpoints this plan is about. Sign-in scaffolding excluded'),
  steps: z.array(stepSchema).min(1),
  summary: z
    .string()
    .min(1)
    .describe('What changed and why, in prose, addressed to the developer who asked'),
  /**
   * The guesses, said out loud.
   *
   * `summary` already asks the model to admit what it could not establish, and it
   * lands in a paragraph nobody reads to the end. A list is read: it goes above the
   * steps on the plan, where an assumption somebody disagrees with is one they can
   * reject before it runs. This is the one-shot wizard's substitute for a clarifying
   * question -- it cannot ask, so it has to show its work.
   *
   * A plain array of strings, which the wire dialect handles as-is: the `entries()`
   * treatment below is only needed for maps.
   */
  assumptions: z
    .array(z.string())
    .describe(
      "Anything this plan takes on faith: a value you invented because you could not find a real one, a route you inferred, an auth shape you guessed at. One short line each, in the developer's terms. Empty when you established everything from the code.",
    ),
  changes: z.array(changeSchema),
});

export type RevisionDraft = z.infer<typeof revisionSchema>;

/**
 * A plan being written for the first time, which is the revision schema minus the
 * part that only makes sense the second time.
 *
 * `changes` is an account of what moved, and nothing has moved yet -- every step is
 * new, so a per-step diff would just be the plan again in another shape. The v1
 * revision row stores `[]`, which is what the thread on the detail page already
 * renders for a first turn.
 *
 * The two overridden fields are overridden because their descriptions were written
 * for a refinement and would be instructions to do the wrong thing here: one tells
 * the model to keep a name it has not been given, the other asks what changed.
 */
export const draftSchema = revisionSchema
  .omit({ changes: true, name: true, summary: true })
  .extend({
    name: z
      .string()
      .min(1)
      .describe('Short, and about what the plan proves rather than the endpoints it calls'),
    summary: z
      .string()
      .min(1)
      .describe(
        'What this plan proves, and what you found in the code that shaped it. Addressed to the developer who asked, and say plainly anything you could not establish',
      ),
  });

export type PlanDraft = z.infer<typeof draftSchema>;

/* ---------------------------------------------------------------------------
 * The dialect a model can actually be asked for
 * ------------------------------------------------------------------------- */

/**
 * A free-form map cannot be asked for, and this is what that cost.
 *
 * The schemas above describe a request the way the dashboard stores one: `headers`,
 * `query`, `body` and `variables` are records, because a header name is not a field
 * anybody declares in advance. A provider's structured-output dialect is an OpenAPI
 * 3.0 subset with no such thing -- `additionalProperties` is dropped on the way in,
 * which leaves `type: object` with no declared properties, and the only value that
 * fits *that* is `{}`.
 *
 * So the first plan this ever drafted came back with eight real routes, a correct
 * dependency graph, and every single body, header, query and variable empty. It was
 * not a model failing to answer: its own summary described the values it had written
 * ("guest email is generated dynamically", "relies on query parameters guest_id,
 * check_in_from") and each one had been serialized away. A signup POST with no
 * fields, and an admin call with no Authorization header.
 *
 * The same three headers asked for three ways in one call settles what to do
 * instead: as a record, `{}`; as an array of entries, all three; as a JSON string,
 * all three. So the model is asked in a dialect it can answer -- entries for the
 * string maps, a JSON literal for the body, which is the one that nests -- and the
 * conversion back to the stored shape happens here rather than in the caller. There
 * is one place where a plan's shape is known, and this keeps it that way.
 */
const entries = (what: string) =>
  z
    .array(z.object({ name: z.string().min(1), value: z.string() }))
    .describe(`${what} One entry each, and an empty list when there are none.`);

const wireRequestSchema = z.object({
  method,
  url: z.string().min(1),
  headers: entries(
    'Everything this request must send as a header, including the credential an authenticated route needs -- Authorization: Bearer {{token}}, or whatever the code actually reads.',
  ),
  query: entries('Query-string parameters, values included.'),
  body: z
    .string()
    .describe(
      'The request body as a JSON object literal, with {{variable}} references inside the quotes: {"email":"{{guestEmail}}","nights":2}. An empty string when this request sends no body.',
    ),
});

/**
 * The same flat action, asked for in the dialect.
 *
 * Nothing here is a map or a nested object, so there is nothing for the dialect to
 * flatten into `{}` -- which is why this one crosses over unchanged where the request
 * above had to be taken apart. Optional on both sides for the same reason it is
 * optional in the stored shape: two of the three fields are meaningless for any given
 * step, and `kind` is what makes an omission checkable rather than silent.
 */
const wireActionSchema = z.object({
  statement: z
    .string()
    .optional()
    .describe(
      'For a sql step: the statement, with {{variable}} references inside it. One statement, no trailing semicolon.',
    ),
  target: z
    .enum(['setup', 'verify'])
    .optional()
    .describe(
      'For a sql step: `verify` to read evidence a request wrote what it claimed, `setup` to write a fixture the steps after it need. Decides whether the statement is queried or executed, so say which one you mean.',
    ),
  command: z
    .string()
    .optional()
    .describe(
      "For a shell step: the command, run by `sh -c` inside GritQA's own container with the project mounted at /app.",
    ),
});

const wireStepSchema = stepSchema.omit({ kind: true, request: true, action: true }).extend({
  kind: z
    .enum(['http', 'sql', 'shell'])
    .describe(
      "What this step does: `http` sends a request, `sql` runs one statement against the run's own copy of the database, `shell` runs one command in the container. Say it for every step.",
    ),
  /* Optional, and the only pair in this schema that is. Everything else the dialect
     mangles was made required-with-an-empty-value on purpose, because an optional
     field is another thing a model can silently omit -- but a request step has no
     action and an action step has no request, and there is no empty value for a URL.
     `kind` is what pays for that: a step whose payload does not match what it says it
     is fails loudly in `stepFromWire` rather than arriving as a blank request. */
  request: wireRequestSchema.optional(),
  action: wireActionSchema.optional(),
});

const wireVariables = entries(
  'Plan-level values the steps interpolate as {{name}} -- the credentials and fixtures a run is given. A credential is a name with a placeholder value the developer maps to their environment, never the literal secret.',
);

export const wireRevisionSchema = revisionSchema
  .omit({ steps: true, variables: true })
  .extend({ steps: z.array(wireStepSchema).min(1), variables: wireVariables });

export const wireDraftSchema = draftSchema
  .omit({ steps: true, variables: true })
  .extend({ steps: z.array(wireStepSchema).min(1), variables: wireVariables });

type Entry = { name: string; value: string };

/** Last entry wins, which is the only reading of a repeated name that loses nothing. */
function record(list: Entry[]): Record<string, string> {
  return Object.fromEntries(list.map((entry) => [entry.name, entry.value]));
}

/** `undefined` rather than `{}`, so the plan's JSON reads as "sends no headers". */
function optionalRecord(list: Entry[]): Record<string, string> | undefined {
  return list.length ? record(list) : undefined;
}

/**
 * The body, or nothing, and a warning rather than silence when it was neither.
 *
 * A body that will not parse is the one failure here that a developer would
 * otherwise read as "the model left it out" -- which is precisely the mistake this
 * whole layer exists to stop repeating. The plan still lands, because seven good
 * steps are worth more than a refusal, and the log says which step to look at.
 */
function body(json: string, stepId: string): Record<string, unknown> | undefined {
  const text = json.trim();
  if (!text) return undefined;

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    console.warn(`plan-schema: step ${stepId} gave a body that is not an object: ${text}`);
  } catch {
    console.warn(`plan-schema: step ${stepId} gave a body that is not JSON: ${text}`);
  }
  return undefined;
}

/**
 * A drafted step in the shape the dashboard stores and the runner reads.
 *
 * Loud rather than lenient about a payload that does not match what the step says it
 * is. `body()` above warns and carries on because seven good steps beat a refusal and
 * a missing body is visible on screen; a step with no payload at all is not the same
 * thing -- it is unrunnable, the runner would refuse the whole plan on it
 * (`load.go`: *"is a sql step with no action"*), and it would sit in the queue looking
 * approvable. Better to fail the draft and say which step, since pass two is a
 * reshape with the research already in hand and costs a fraction of a retry.
 */
function stepFromWire(step: z.infer<typeof wireStepSchema>): z.infer<typeof stepSchema> {
  const { kind, request, action, ...common } = step;

  const wrong = (what: string) =>
    new Error(`plan-schema: step ${step.id} says kind "${kind}" and ${what}`);

  const allowed: readonly PlanAssertion['type'][] = ASSERTIONS_BY_KIND[kind];
  for (const assertion of common.assertions) {
    if (!allowed.includes(assertion.type)) {
      throw wrong(
        `asserts on ${assertion.type}, which is not something a ${kind} step has — ` +
          `${allowed.join(', ')} are`,
      );
    }
  }

  if (kind === 'http') {
    if (!request) throw wrong('sends no request');
    return {
      ...common,
      kind,
      request: {
        method: request.method,
        url: request.url,
        headers: optionalRecord(request.headers),
        query: optionalRecord(request.query),
        body: body(request.body, step.id),
      },
    };
  }

  if (kind === 'sql') {
    if (!action?.statement) throw wrong('has no statement to run');
    /* `verify` when the draft did not say, because the two readings fail in different
       directions and this is the one whose failure is visible. A write read as a
       `verify` still executes -- the statement goes through `Query` instead of `Exec`
       and only its row count goes unreported. A read left as `setup` goes through
       `Exec`, which reports zero rows affected for a SELECT, and every count assertion
       on it compares against 0. Neither is silent, and this one does not touch the
       approval confirm's reading of what writes. */
    return {
      ...common,
      kind,
      action: { statement: action.statement, target: action.target ?? 'verify' },
    };
  }

  if (!action?.command) throw wrong('has no command to run');
  return { ...common, kind, action: { command: action.command } };
}

/**
 * The last gate before a plan becomes a row.
 *
 * `stepFromWire` above refuses a step whose payload contradicts its `kind`; this
 * refuses one the runner could not interpolate. Same argument, and it is the one the
 * plan format's own comment makes -- an unloadable plan otherwise sits in the queue
 * looking approvable, and the developer finds out minutes later when their machine
 * declines it before the first step.
 */
function loadable<T extends { variables: Record<string, string>; steps: PlanStepSpec[] }>(
  plan: T,
): T {
  const bad = unloadable(plan);
  if (bad) throw new Error(`plan-schema: ${bad}`);
  return plan;
}

export function draftFromWire(draft: z.infer<typeof wireDraftSchema>): PlanDraft {
  return loadable({
    ...draft,
    variables: record(draft.variables),
    steps: draft.steps.map(stepFromWire),
  });
}

export function revisionFromWire(revision: z.infer<typeof wireRevisionSchema>): RevisionDraft {
  return loadable({
    ...revision,
    variables: record(revision.variables),
    steps: revision.steps.map(stepFromWire),
  });
}
