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
