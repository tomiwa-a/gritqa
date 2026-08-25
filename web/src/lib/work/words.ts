import type { AgentJobType } from '@/lib/db/schema';
import type { WorkStatus } from '@/lib/db/work';

/**
 * How work is spoken about on screen.
 *
 * Beside the page rather than inside it because the list and the detail page have to
 * agree: a row that says *Working* in green on one and *claimed* in grey on the other
 * is two features arguing about the same job. `Record` rather than a function with a
 * default, so adding a job type is a type error here instead of a silent fall-through
 * to a word that does not describe it.
 */
export const WORK_KIND: Record<AgentJobType, string> = {
  draft_plan: 'New plan',
  refine_plan: 'New version',
  answer_question: 'Answer',
};

/**
 * The status, in the words of what it means for the developer.
 *
 * Not the column's own words. `claimed` is a lease and `dead` is a retry budget, and
 * neither is what somebody watching wants to read -- what they want is whether it is
 * happening, whether it worked, and whether it is coming back.
 */
export const WORK_WORD: Record<WorkStatus, string> = {
  pending: 'Queued',
  claimed: 'Working',
  completed: 'Done',
  failed: 'Failed',
  dead: 'Gave up',
};

export const WORK_TONE: Record<WorkStatus, 'skip' | 'running' | 'pass' | 'fail'> = {
  pending: 'skip',
  claimed: 'running',
  completed: 'pass',
  failed: 'fail',
  dead: 'fail',
};

/** In flight, in the sense that opening the page should start it again. */
export function inFlight(status: WorkStatus): boolean {
  return status === 'pending' || status === 'claimed';
}
