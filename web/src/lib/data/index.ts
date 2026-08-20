/**
 * One import for every read in the app: `import { getRules } from '@/lib/data'`.
 *
 * The seam is doing the job it was built for. Everything here reads Postgres except
 * the period selector, which still returns a constant out of `src/lib/mock/`, and not
 * one screen changed as each switched over. See ./README.md.
 */

export { getUser, getSessionUser } from './user';
export { getProjects, getCurrentProject, getCurrentProjectOrNull } from './projects';
export { getRules } from './rules';
export {
  getAllPlans,
  getPlanDetail,
  getPlanDetails,
  getPlanPassRates,
  getPlansAwaitingReview,
  getSettledPlans,
  type PlanPassRate,
} from './plans';
export { getRecentRuns, getRunHistory, getRunStripStats, type RunStripStats } from './runs';
export { getCoverage, getCoverageTotals, type CoverageTotals } from './coverage';
export { getCommits, getLastDraftedFrom } from './commits';
export { getAuditLog } from './activity';
export { getPeriod, type Period } from './period';
