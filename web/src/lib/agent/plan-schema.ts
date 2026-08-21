import { z } from 'zod';

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
 * Mirroring by hand is the cost. The compiler checks it in one direction --
 * `satisfies` in `draft.ts` will not accept a schema that stops producing a
 * `PlanStepSpec` -- and a widened union in `model.ts` shows up there rather than
 * silently passing through.
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

export const assertionSchema = z.object({
  type: z.enum(['status', 'bodyField', 'header', 'responseTime']),
  operator: z.enum(['equals', 'notEquals', 'contains', 'notContains', 'exists', 'lt', 'gt']),
  target: z
    .string()
    .min(1)
    .describe('What is being checked: a JSON path for bodyField, a header name, or "status"'),
  /* Optional because `exists` has nothing to compare against. */
  expected: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const extractionSchema = z.object({
  name: z.string().min(1).describe('Variable name later steps refer to as {{name}}'),
  path: z.string().min(1),
  source: z.enum(['body', 'header']),
});

export const stepSchema = z.object({
  id: z.string().min(1).describe('Stable within the plan; later steps depend on it by this id'),
  name: z.string().min(1),
  description: z.string(),
  dependsOn: z
    .array(z.string())
    .describe('Step ids that must pass first. Empty for the first step'),
  request: z.object({
    method,
    /**
     * Relative to `baseUrl`, with `{{variable}}` for anything extracted earlier.
     * The runner substitutes; the plan holds the template.
     */
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
    query: z.record(z.string(), z.string()).optional(),
  }),
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
    .describe('Plan-level values steps interpolate. Secrets by $ENV reference, never literal'),
  covers: z
    .array(endpointSchema)
    .describe('The endpoints this plan is about. Sign-in scaffolding excluded'),
  steps: z.array(stepSchema).min(1),
  summary: z
    .string()
    .min(1)
    .describe('What changed and why, in prose, addressed to the developer who asked'),
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

const wireStepSchema = stepSchema.omit({ request: true }).extend({ request: wireRequestSchema });

const wireVariables = entries(
  'Plan-level values the steps interpolate as {{name}} -- the credentials and fixtures a run is given. Secrets by $ENV reference, never the literal.',
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

function stepFromWire(step: z.infer<typeof wireStepSchema>): z.infer<typeof stepSchema> {
  return {
    ...step,
    request: {
      method: step.request.method,
      url: step.request.url,
      headers: optionalRecord(step.request.headers),
      query: optionalRecord(step.request.query),
      body: body(step.request.body, step.id),
    },
  };
}

export function draftFromWire(draft: z.infer<typeof wireDraftSchema>): PlanDraft {
  return { ...draft, variables: record(draft.variables), steps: draft.steps.map(stepFromWire) };
}

export function revisionFromWire(revision: z.infer<typeof wireRevisionSchema>): RevisionDraft {
  return {
    ...revision,
    variables: record(revision.variables),
    steps: revision.steps.map(stepFromWire),
  };
}
