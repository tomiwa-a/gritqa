import { getMachineStatus } from '@/lib/data';
import { currentScope } from '@/lib/db/scope';

/**
 * Is a machine there, right now.
 *
 * Everything else on the dashboard is server-rendered, and for almost everything that
 * is the right trade: a plan does not change while you read it. Liveness does. It is
 * true for thirty seconds and a dashboard tab stays open for an afternoon, so a
 * server-rendered pill saying "connected" is only honest for the first half-minute of
 * its life -- which is the same lie this whole commit is about, wearing a timestamp.
 *
 * So the browser asks again. This is the smallest possible answer to that question:
 * two fields, no project name, no hostname, nothing a caller could not already read
 * off the page it is on. The poller compares and refreshes the route when it flips,
 * which is what makes the *rest* of the page -- the disabled Run buttons, the
 * explanatory notes -- correct again without any of them learning to poll.
 *
 * Session-scoped, like every other dashboard read. A signed-out request gets 401
 * rather than a public "no", because whether a stranger's machine is on is not a
 * question this should answer.
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

  const { connected, machines } = await getMachineStatus();

  return Response.json(
    { connected, lastSeenAt: machines[0]?.lastSeenAt ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
