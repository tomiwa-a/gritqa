/**
 * The agent's two dependencies, each behind one function.
 *
 * `resolveModel()` answers "which model, on whose account"; `openResearch()`
 * answers "what can it see". Both fail closed with a named code the dashboard can
 * render as a state -- `NO_MODEL_KEY` and `CLI_UNAVAILABLE` -- because a draft
 * built on a guess is worse than no draft.
 */
export { resolveModel, drafting, NoModelKeyError } from './model';
export type { ResolvedModel, Drafting } from './model';
export { openResearch, researchConfigured, CliUnavailableError } from './research';
export type { Research } from './research';
export { refinePlan } from './draft';
export type { Refinement } from './draft';
export { revisionSchema } from './plan-schema';
export type { RevisionDraft } from './plan-schema';
