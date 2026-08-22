import { cliScope } from '@/lib/db/cli';
import { dialed } from '@/lib/agent/relay';

/**
 * The other half of a dial: one POST per frame the CLI sends back.
 *
 * A duplex request would save the round trip, but a request body that never ends is not
 * something a serverless runtime reliably reads, and on loopback this costs about a
 * millisecond. 409 means the machine is not dialled in here -- a different process, or a
 * stream that has since closed -- which tells the CLI to redial rather than retry.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const scope = await cliScope(request);
  if (!scope) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  let body: { instanceId?: unknown; frame?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* Falls through to the invalid_frame check. */
  }

  const instanceId = typeof body.instanceId === 'string' ? body.instanceId.trim() : '';
  if (!instanceId || body.frame === undefined) {
    return Response.json({ error: 'invalid_frame' }, { status: 400, headers: NO_STORE });
  }

  const conn = dialed(scope.projectId, instanceId);
  if (!conn) {
    return Response.json({ error: 'not_dialed' }, { status: 409, headers: NO_STORE });
  }

  conn.receive(JSON.stringify(body.frame));
  return Response.json({ ok: true }, { headers: NO_STORE });
}

const NO_STORE = { 'Cache-Control': 'no-store' };
