import { NextResponse } from 'next/server';
import { cliScope, mirrorIndex, touchInstance } from '@/lib/db/cli';
import type { MirroredFile } from '@/lib/db/cli';

/**
 * The codebase mirror arrives. The web half of the contract written down in
 * `cli/internal/cloud/index.go`, which has been posting to nothing until now.
 *
 * `complete: true` says this is the whole tree, which is what lets a file the project
 * no longer has be dropped. Without it a deleted controller would sit in the mirror
 * for ever and the coverage page counts rows.
 *
 * Nothing here is correctness-bearing. The agent reads files through the CLI's tool
 * surface, not out of this table, so a mirror that is stale or missing costs a page its
 * numbers and costs a run nothing.
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

  const { written, removed } = await mirrorIndex(scope.projectId, parsed.files, parsed.complete);

  // Pushing an index is a sighting, same as the poll and a completion.
  await touchInstance(scope.projectId, { instanceId: parsed.instanceId });

  return NextResponse.json({ ok: true, written, removed }, { headers: NO_STORE });
}

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * More files than this is not a project. Well past the 1000-file target the CLI is
 * measured against, and low enough that one push cannot be a way to fill a database.
 */
const MAX_FILES = 20_000;

type Parsed =
  | { ok: true; instanceId: string; complete: boolean; files: MirroredFile[] }
  | { ok: false; error: string };

function parse(body: unknown): Parsed {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_body' };
  }
  const input = body as Record<string, unknown>;

  const instanceId = typeof input.instanceId === 'string' ? input.instanceId.trim() : '';
  if (!instanceId || instanceId.length > 255) return { ok: false, error: 'invalid_instance' };

  const raw = input.files ?? [];
  if (!Array.isArray(raw)) return { ok: false, error: 'invalid_files' };
  if (raw.length > MAX_FILES) return { ok: false, error: 'too_many_files' };

  const files: MirroredFile[] = [];
  for (const entry of raw) {
    const file = parseFile(entry);
    if (!file) return { ok: false, error: 'invalid_file' };
    files.push(file);
  }

  return { ok: true, instanceId, complete: input.complete === true, files };
}

/**
 * Null for anything that is not a file, which the caller turns into a 400.
 *
 * The two bounded columns are refused rather than trimmed: a truncated hash describes
 * a file that does not exist, and the CLI already cuts both to length, so an over-long
 * value means a client that is not it. Either may be blank -- a file whose language
 * nothing recognised still belongs in the mirror.
 */
function parseFile(entry: unknown): MirroredFile | null {
  if (!entry || typeof entry !== 'object') return null;
  const file = entry as Record<string, unknown>;

  const filePath = typeof file.filePath === 'string' ? file.filePath.trim() : '';
  if (!filePath || filePath.length > 4096) return null;

  if (typeof file.fileHash !== 'string' || file.fileHash.length > 64) return null;
  if (typeof file.language !== 'string' || file.language.length > 50) return null;

  const symbols = list(file.symbols);
  const dependencies = list(file.dependencies);
  const endpoints = list(file.endpoints);
  if (!symbols || !dependencies || !endpoints) return null;

  return {
    filePath,
    fileHash: file.fileHash,
    language: file.language,
    symbols,
    dependencies,
    endpoints,
  };
}

/** All three are `jsonb NOT NULL DEFAULT '[]'`, so absent is empty and a non-list is wrong. */
function list(value: unknown): unknown[] | null {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : null;
}
