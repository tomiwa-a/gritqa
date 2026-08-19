/**
 * One import for every read in the app: `import { getRules } from '@/lib/data'`.
 *
 * The source behind these is still `src/lib/mock/`. That is the point — the seam
 * goes in while the data is known-good, so swapping a source later is one function
 * body rather than a change to every screen that reads it. See ./README.md.
 */

export { getUser } from './user';
export { getProjects, getCurrentProject } from './projects';
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
export { getCommits, getLastDraftedFrom, getPendingChanges } from './commits';
export { getAuditLog } from './activity';
export { getPeriod, type Period } from './period';
