/**
 * The relay: where a connection the CLI opened is held so the agent can speak MCP
 * down it.
 *
 * Decision 24. A hosted function cannot reach a laptop, so the laptop dials in and
 * this holds its two halves together -- frames out over the open response, frames back
 * in over a POST. The MCP client on the agent side sees a transport; neither end knows
 * there is an HTTP boundary in the middle.
 *
 * Process-local, and honestly so: a `Map` in module scope survives only as long as the
 * Node process that holds it. `next dev` is one process, which is what M6 is scoped to.
 * Multi-instance hosting needs a relay with an address of its own, and the plan defers
 * that.
 */

export type Held = {
  /** Push one JSON-RPC frame down to the CLI. False once the stream is gone. */
  send: (frame: string) => boolean;
  /** Take a frame the CLI sent back. Set by whoever is speaking MCP over this dial. */
  listen: (onFrame: (frame: string) => void) => void;
  receive: (frame: string) => void;
  close: () => void;
  since: number;
};

const held = new Map<string, Held>();

const key = (projectId: number, instanceId: string) => `${projectId}:${instanceId}`;

/**
 * A dial is a pair of one-way channels with a queue between them, because the CLI can
 * answer before the agent has attached a listener and a dropped response is a request
 * that never returns.
 */
export function open(send: (frame: string) => boolean, close: () => void, since: number): Held {
  let onFrame: ((frame: string) => void) | undefined;
  const waiting: string[] = [];
  return {
    send,
    close,
    since,
    listen(next) {
      onFrame = next;
      while (waiting.length) next(waiting.shift()!);
    },
    receive(frame) {
      if (onFrame) onFrame(frame);
      else waiting.push(frame);
    },
  };
}

export function hold(projectId: number, instanceId: string, conn: Held): () => void {
  const k = key(projectId, instanceId);
  // A machine that reconnects replaces itself. The old stream is already dead or about
  // to be, and leaving it in the map would route frames into it.
  held.get(k)?.close();
  held.set(k, conn);
  return () => {
    if (held.get(k) === conn) held.delete(k);
  };
}

export function dialed(projectId: number, instanceId: string): Held | undefined {
  return held.get(key(projectId, instanceId));
}

/**
 * The newest dial for this project, which is what research uses when it was not told a
 * machine. Newest rather than any: a developer with two checkouts open means the one
 * they just started is the one they are working in.
 */
export function newestDial(projectId: number): { instanceId: string; conn: Held } | undefined {
  let best: { instanceId: string; conn: Held } | undefined;
  for (const [k, conn] of held) {
    const at = k.indexOf(':');
    if (Number(k.slice(0, at)) !== projectId) continue;
    if (!best || conn.since > best.conn.since) best = { instanceId: k.slice(at + 1), conn };
  }
  return best;
}
