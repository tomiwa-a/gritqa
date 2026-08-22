import { cliScope, touchInstance } from '@/lib/db/cli';
import { hold, open } from '@/lib/agent/relay';

/**
 * The CLI's end of decision 24: it opens this, and the tool surface arrives over it.
 *
 * NDJSON down one long-lived response, one JSON-RPC message per line. Lines beginning
 * `:` are keepalive and carry nothing -- they exist so an idle dial does not look dead
 * to whatever proxy is in the middle. The CLI drops them before its decoder.
 *
 * No scope is negotiated here, because there is nothing to negotiate: a dialled surface
 * is read-only at the CLI end. Approved work arrives as a job and goes through the
 * engine, which is what keeps `run_plan` deterministic (decision 34).
 */
export const dynamic = 'force-dynamic';

/** Long enough to be idle traffic, short enough to beat an ordinary proxy timeout. */
const KEEPALIVE_MS = 20_000;

export async function GET(request: Request) {
  const scope = await cliScope(request);
  if (!scope) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  const instanceId = new URL(request.url).searchParams.get('instanceId')?.trim() ?? '';
  if (!instanceId) {
    return Response.json({ error: 'invalid_instance' }, { status: 400, headers: NO_STORE });
  }

  // A dial is a sighting. Without this a machine that dialled and then sat idle would
  // read as disconnected on the dashboard for as long as it stayed quiet.
  await touchInstance(scope.projectId, { instanceId });

  const bytes = new TextEncoder();
  let release = () => {};
  let beat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let live = true;
      const write = (line: string) => {
        if (!live) return false;
        try {
          controller.enqueue(bytes.encode(line + '\n'));
          return true;
        } catch {
          live = false;
          return false;
        }
      };

      const conn = open(
        write,
        () => {
          live = false;
          if (beat) clearInterval(beat);
          release();
          try {
            controller.close();
          } catch {
            /* Already closed by the client hanging up. */
          }
        },
        Date.now(),
      );

      release = hold(scope.projectId, instanceId, conn);
      beat = setInterval(() => {
        if (!write(':')) conn.close();
      }, KEEPALIVE_MS);
    },
    cancel() {
      if (beat) clearInterval(beat);
      release();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
    },
  });
}

const NO_STORE = { 'Cache-Control': 'no-store' };
