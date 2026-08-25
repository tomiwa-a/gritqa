import { currentScope } from '@/lib/db/scope';
import { workMark } from '@/lib/db/work';

/**
 * Has the work moved.
 *
 * The same shape as `/api/machine` and for the same reason: everything on the
 * dashboard is server-rendered, which is right for a plan and wrong for a job that is
 * halfway through reading a codebase. So the browser asks again, and this is the
 * smallest question it can ask -- one opaque string, no labels, no job ids, nothing a
 * caller could not already read off the page it is on.
 *
 * `mark` is deliberately not documented to the client as anything but a value to
 * compare. The poller's whole logic is *did this change*, so what it is made of is
 * this module's business and can change without touching the browser.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const scope = await currentScope();
  if (!scope) {
    return Response.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return Response.json(
    { mark: await workMark(scope.projectId) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
