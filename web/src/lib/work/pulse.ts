import { requireScope } from '@/lib/db/scope';
import { workMark } from '@/lib/db/work';
import { resumeWork } from './resume';

/**
 * The poll signal for a surface that is waiting on one particular thing.
 *
 * Two jobs, because on a page like this they are the same decision. A thread with an
 * answer outstanding wants both -- a mark to poll on, so the answer appears without a
 * reload, and a resume, so an answer whose runner stopped speaking starts again by
 * being looked at. A thread being read back wants neither, and `null` is how it says so:
 * the caller mounts no poller, which is cheaper than a poller that finds nothing.
 *
 * Returning the mark rather than the component keeps the client island in one file. The
 * resume is `after()` work inside `resumeWork`, so nothing here blocks the render.
 */
export async function pulse(waiting: boolean): Promise<string | null> {
  if (!waiting) return null;

  const scope = await requireScope();
  resumeWork(scope.projectId);
  return workMark(scope.projectId);
}
