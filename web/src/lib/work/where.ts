/**
 * Where queued work is watched.
 *
 * One constant rather than the string in five files, because it is the destination of
 * every action that hands something off and the page they all redirect to -- and a
 * typo in one of them would be a redirect to a 404 at the exact moment the developer
 * is trying to find out whether their draft is running.
 *
 * Distinct from `/dashboard/queue`, which is the *review* queue: plans that finished
 * and are waiting for a human to approve them. This is the work still in flight.
 */
export const WORK = '/dashboard/work';
