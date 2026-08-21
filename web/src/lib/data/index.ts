/**
 * One import for every read in the app: `import { getRules } from '@/lib/data'`.
 *
 * The seam is doing the job it was built for: every function here reads Postgres, the
 * mock it was built over is deleted, and not one screen changed as each entity switched
 * across. See ./README.md.
 */

export { getUser, getSessionUser } from './user';
export { getProjects, getCurrentProject, getCurrentProjectOrNull } from './projects';
export { getRules } from './rules';
export {
  getAllPlans,
  getLastBaseUrl,
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
export { getMachineStatus, isCliConnected } from './machine';
