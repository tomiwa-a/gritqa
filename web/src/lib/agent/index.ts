/**
 * The agent's two dependencies, each behind one function.
 *
 * `resolveModel()` answers "which model, on whose account"; `openResearch()`
 * answers "what can it see". Both fail closed with a named code the dashboard can
 * render as a state -- `NO_MODEL_KEY` and `CLI_UNAVAILABLE` -- because a draft
 * built on a guess is worse than no draft.
 */
export { resolveModel, drafting, NoModelKeyError, NeedsConfigError } from './model';
export type { ResolvedModel, Drafting } from './model';
export { openResearch, researchConfigured, requireBootable, CliUnavailableError } from './research';
export type { Research } from './research';
export { refinePlan, draftPlan } from './draft';
export type { Refinement, Draft } from './draft';
export { verifyPlan, recheckStep } from './verify';
export type { Verification } from './verify';
export { askAgent, priorFindingsOf, proposeBrief } from './ask';
export type { AskTurn, PriorTurn } from './ask';
export { revisionSchema, draftSchema } from './plan-schema';
export type { RevisionDraft, PlanDraft } from './plan-schema';
