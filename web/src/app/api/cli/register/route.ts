import { NextResponse } from 'next/server';
import { cliScope, touchInstance } from '@/lib/db/cli';

/**
 * The machine announces itself before its first pass, without asking for work.
 *
 * Claiming here instead would hold a job through a pass that might take
 * minutes — an AI-heavy first read over an uncached tree — while the reap
 * counts down on it. Registration only moves `last_seen_at`, so the dashboard
 * can narrate the pass live from the poll that follows, and the queue stays
 * untouched until the machine is actually ready to take something.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const scope = await cliScope(request);
  if (!scope) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  let body: {
    instanceId?: unknown;
    hostname?: unknown;
    version?: unknown;
    mcpUrl?: unknown;
    mcpToken?: unknown;
    progress?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* An empty or unparseable body is the same as no identity, handled below. */
  }

  const instanceId = typeof body.instanceId === 'string' ? body.instanceId.trim() : '';
  if (!instanceId || instanceId.length > 255) {
    return NextResponse.json({ error: 'invalid_instance' }, { status: 400, headers: NO_STORE });
  }

  await touchInstance(scope.projectId, {
    instanceId,
    hostname: str(body.hostname, 255),
    version: str(body.version, 64),
    mcpUrl: str(body.mcpUrl, 512),
    mcpToken: str(body.mcpToken, 255),
    // A pass in flight narrates itself through this same call, one post per
    // finished stage. Absent on plain registrations, which leave the last
    // label alone.
    progress: body.progress ?? undefined,
  });

  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Optional, self-reported, and length-bounded because the columns are. */
function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}
