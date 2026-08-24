import { NextResponse } from 'next/server';
import { cliScope, touchInstance } from '@/lib/db/cli';
import { approvedEnvironment, proposedEnvironment, recordCompose } from '@/lib/db/environment';
import type { ComposeService } from '@/lib/environment';

/**
 * The compose file goes up, the judgement comes back.
 *
 * One route rather than two, because the CLI shells `docker compose config` on every
 * boot anyway: pushing the file it just read and taking the answer in the same reply
 * is one round trip, the answer is never stale against the file it was read for, and
 * the fingerprint comparison happens on the side that holds the record.
 *
 * The body is a **fact** -- what the developer's file declares. The reply is a
 * **judgement** -- what GritQA does with each of those services, as a person
 * approved it. Nothing here decides anything: with no approved row this answers
 * `status: "none"` and the CLI carries on with whatever it had, which for most
 * projects today is the block in their config file.
 *
 * The CLI half of this contract is `cli/internal/cloud/environment.go`.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const scope = await cliScope(request);
  if (!scope) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    /* Falls through to the parse below, which rejects a non-object. */
  }

  const parsed = parse(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });
  }

  await recordCompose(scope.projectId, {
    projectName: parsed.projectName,
    fingerprint: parsed.fingerprint,
    files: parsed.files,
    services: parsed.services,
  });
  await touchInstance(scope.projectId, { instanceId: parsed.instanceId });

  const approved = await approvedEnvironment(scope.projectId);
  if (approved) {
    return NextResponse.json(
      {
        ok: true,
        status: 'approved',
        environment: approved.spec,
        fingerprint: approved.fingerprint,
        // Still approved and still what boots -- most compose edits move none of these
        // answers. Saying so is what makes the screen able to show one new row instead
        // of throwing the decision away.
        stale: approved.fingerprint !== '' && approved.fingerprint !== parsed.fingerprint,
      },
      { headers: NO_STORE },
    );
  }

  const proposed = await proposedEnvironment(scope.projectId);
  return NextResponse.json(
    {
      ok: true,
      status: proposed ? 'proposed' : 'none',
      environment: null,
      fingerprint: '',
      stale: false,
    },
    { headers: NO_STORE },
  );
}

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * A compose file with more services than this is not a compose file, and a project
 * with more than a handful of override files is not one either. Both are here so one
 * push cannot be a way to fill a database, not because a real project comes close.
 */
const MAX_SERVICES = 200;
const MAX_FILES = 50;

type Parsed =
  | {
      ok: true;
      instanceId: string;
      projectName: string;
      fingerprint: string;
      files: string[];
      services: ComposeService[];
    }
  | { ok: false; error: string };

function parse(body: unknown): Parsed {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_body' };
  }
  const input = body as Record<string, unknown>;

  const instanceId = typeof input.instanceId === 'string' ? input.instanceId.trim() : '';
  if (!instanceId || instanceId.length > 255) return { ok: false, error: 'invalid_instance' };

  // Refused rather than trimmed, for the same reason a truncated file hash is: the CLI
  // cuts both to length itself, so an over-long value means a client that is not it.
  const fingerprint = typeof input.fingerprint === 'string' ? input.fingerprint.trim() : '';
  if (!fingerprint || fingerprint.length > 64) return { ok: false, error: 'invalid_fingerprint' };

  const projectName = typeof input.projectName === 'string' ? input.projectName.trim() : '';
  if (projectName.length > 255) return { ok: false, error: 'invalid_project_name' };

  const files = strings(input.files);
  if (!files || files.length > MAX_FILES) return { ok: false, error: 'invalid_files' };

  const raw = input.services ?? [];
  if (!Array.isArray(raw)) return { ok: false, error: 'invalid_services' };
  if (raw.length > MAX_SERVICES) return { ok: false, error: 'too_many_services' };

  const services: ComposeService[] = [];
  for (const entry of raw) {
    const service = parseService(entry);
    if (!service) return { ok: false, error: 'invalid_service' };
    services.push(service);
  }
  if (!services.length) return { ok: false, error: 'no_services' };

  return { ok: true, instanceId, projectName, fingerprint, files, services };
}

/**
 * One service, and only the parts a person needs to recognise it.
 *
 * `env` is variable **names**. The CLI sends names because a value here would be a
 * copy of somebody's secret: compose expands `${MYSQL_ROOT_PASSWORD}` to the real
 * password, and a compose file can write one in literally too. A login refers to a
 * variable by name and the value is read at boot, on the developer's own machine.
 */
function parseService(entry: unknown): ComposeService | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const input = entry as Record<string, unknown>;

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 255) return null;

  const out: ComposeService = { name };
  for (const key of ['image', 'build'] as const) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || value.length > 1024) return null;
    if (value) out[key] = value;
  }
  for (const key of ['command', 'profiles', 'env'] as const) {
    const value = strings(input[key]);
    if (!value) return null;
    if (value.length) out[key] = value;
  }

  const ports = input.ports ?? [];
  if (!Array.isArray(ports)) return null;
  const parsed = [];
  for (const port of ports) {
    if (!port || typeof port !== 'object') return null;
    const p = port as Record<string, unknown>;
    if (typeof p.container !== 'number' || !Number.isInteger(p.container)) return null;
    parsed.push({
      container: p.container,
      ...(typeof p.published === 'string' && p.published ? { published: p.published } : {}),
      ...(typeof p.protocol === 'string' && p.protocol ? { protocol: p.protocol } : {}),
    });
  }
  if (parsed.length) out.ports = parsed;

  return out;
}

/** Absent is empty; anything that is not a list of short strings is wrong. */
function strings(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length > 1024) return null;
    out.push(entry);
  }
  return out;
}
