import { NextResponse } from 'next/server';
import { cliScope, recordSteps, touchInstance } from '@/lib/db/cli';
import type { StepReport } from '@/lib/db/cli';
import { MAX_MOVED, MAX_STEPS, ledgerRows, parseStep } from '@/lib/cli/report';

/**
 * "This step just finished."
 *
 * A preview of a run that is still going, so `/dashboard/runs` has something to show
 * during a thirty-second walk instead of a blank panel followed by everything at once.
 * The completion is still the record: it clears every row written here before writing
 * its own, and the CLI stops previewing before it sends one, so which arrival wins is
 * not a question the two endpoints have to agree on.
 *
 * Read off the wire by the same code the completion uses, deliberately -- the two
 * differing on what a `status` may be would show up as a run whose steps changed when
 * it finished.
 *
 * 404 for the same three cases as the heartbeat, meaning the same thing: stop working
 * on it, it is not yours. This renews the claim too, because a machine sending steps
 * is a machine still working.
 */
export const dynamic = 'force-dynamic';

type Parsed = { ok: true; instanceId: string; steps: StepReport[] } | { ok: false; error: string };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await cliScope(request);
  if (!scope) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    /* Falls through to the shape check. */
  }

  const parsed = parse(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });
  }

  const { id } = await params;
  const written = await recordSteps(scope, id, parsed.instanceId, parsed.steps);
  if (written === null) {
    return NextResponse.json({ error: 'not_your_job' }, { status: 404, headers: NO_STORE });
  }

  await touchInstance(scope.projectId, { instanceId: parsed.instanceId });

  return NextResponse.json({ ok: true, steps: written }, { headers: NO_STORE });
}

function parse(body: unknown): Parsed {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid_body' };
  const input = body as Record<string, unknown>;

  const instanceId = typeof input.instanceId === 'string' ? input.instanceId.trim() : '';
  if (!instanceId) return { ok: false, error: 'invalid_instance' };

  if (!Array.isArray(input.steps)) return { ok: false, error: 'invalid_steps' };
  if (input.steps.length > MAX_STEPS) return { ok: false, error: 'too_many_steps' };

  const steps: StepReport[] = [];
  for (const entry of input.steps) {
    const step = parseStep(entry);
    if (!step) return { ok: false, error: 'invalid_step' };
    steps.push(step);
  }

  if (ledgerRows(steps, []) > MAX_MOVED) return { ok: false, error: 'too_much_state' };

  return { ok: true, instanceId, steps };
}

const NO_STORE = { 'Cache-Control': 'no-store' };
