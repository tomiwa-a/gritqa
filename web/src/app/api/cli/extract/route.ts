import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { cliScope } from '@/lib/db/cli';
import { NoModelKeyError, resolveModel } from '@/lib/agent';

/**
 * The dashboard's half of `Client.Extract` (`cli/internal/index/source`).
 *
 * The CLI posts one source file (plus optional gateway context) and gets back
 * the HTTP endpoints that file serves. The contract is the CLI's: same prompt
 * shape as its local reader, same lenient reply parsing, same filtering. A
 * model that answers in prose still lands as endpoints, and one that will not
 * answer lands as a failure for that file rather than for the pass.
 *
 * Billed to the server's dev model in development (the same path drafting
 * uses when nobody stored a key). No session travels here — the bearer names
 * the project, and that binding is the whole authorization.
 *
 * Status codes are load-bearing on the CLI side, so they are chosen for it:
 * 401/403 end the whole pass (refused credential), 429 parks every worker
 * behind the shared quota gate, and anything else fails just this file with
 * retries. A missing model is therefore a 503, never a 401.
 */
export const dynamic = 'force-dynamic';

const MAX_CONTENT = 200_000;
const MAX_CONTEXT_FILES = 8;

const METHODS = new Set(['', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const SYSTEM = `You read one source file and list the HTTP endpoints it serves.

Reply with one JSON object and nothing else:

{"endpoints": [
  {"method": "POST", "path": "/api/rooms", "line": 42,
   "handler": "RoomController.create", "middleware": ["requireAdmin"]},
  {"method": "GET", "path": "/index.php?controller=rooms&action=list", "line": 61,
   "handler": "RoomController::list", "middleware": []}
]}

Two, because the shape is whatever the file serves. The first is a project with
a router; the second is one that routes on the query string, and copying that
URL as it stands is the rule rather than an exception.

Rules:
- path is what a client actually types. Copy the URL this file serves, query
  string included when the routing itself is done with query parameters. Never
  tidy it into a REST shape the server does not serve.
- You may be shown a gateway file: the front controller requests arrive at before
  they reach this one. When you are, the path is the whole URL through it — find
  the branch that reaches this file, take the parameters that branch needs, and
  add this file's own. A path that skips the gateway is a 404.
- method is GET, POST, PUT, PATCH or DELETE. Leave it "" when the file does not
  say which one it accepts.
- line is where the endpoint is declared in this file. handler is the function or
  method that serves it. middleware lists the guards it passes through, if any.
- List only what this file serves, and only what you can see. If it serves none,
  reply {"endpoints": []}. Never infer a URL from a name, a comment or a framework
  convention: a path that does not exist gets tests written against it and every
  one of them 404s.`;

type ContextFile = { path?: unknown; content?: unknown };

type Endpoint = {
  method?: unknown;
  path?: unknown;
  line?: unknown;
  handler?: unknown;
  middleware?: unknown;
};

export async function POST(request: Request) {
  const scope = await cliScope(request);
  if (!scope) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }

  let body: {
    project?: unknown;
    path?: unknown;
    language?: unknown;
    content?: unknown;
    context?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers: NO_STORE });
  }

  const path = typeof body.path === 'string' ? body.path.slice(0, 1024) : '';
  const language = typeof body.language === 'string' ? body.language.slice(0, 64) : '';
  const content = typeof body.content === 'string' ? body.content : '';
  if (!path || !content) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers: NO_STORE });
  }
  if (content.length > MAX_CONTENT) {
    return NextResponse.json({ error: 'too_large' }, { status: 413, headers: NO_STORE });
  }
  const context = Array.isArray(body.context)
    ? body.context.slice(0, MAX_CONTEXT_FILES).flatMap((c: ContextFile) => {
        if (!c || typeof c !== 'object') return [];
        const p = typeof c.path === 'string' ? c.path.slice(0, 1024) : '';
        const b = typeof c.content === 'string' ? c.content.slice(0, MAX_CONTENT) : '';
        return p && b ? [{ path: p, content: b }] : [];
      })
    : [];

  let model: Awaited<ReturnType<typeof resolveModel>>;
  try {
    model = await resolveModel();
  } catch (error) {
    // Fail-closed per file, never per pass: a 401/403 here would end the CLI's
    // whole extraction run as a refused credential, which a missing local key
    // is not.
    if (error instanceof NoModelKeyError) {
      return NextResponse.json({ error: 'no_model' }, { status: 503, headers: NO_STORE });
    }
    console.error('[extract] model unavailable', error);
    return NextResponse.json({ error: 'model_unavailable' }, { status: 503, headers: NO_STORE });
  }

  const user: string[] = [];
  for (const c of context) {
    user.push(
      `Gateway: ${c.path} — requests reach the file below through this one.\n\n${c.content}`,
    );
  }
  user.push(`File: ${path}\nLanguage: ${language}\n\n${content}`);

  let text: string;
  try {
    ({ text } = await generateText({ model: model.model, system: SYSTEM, prompt: user.join('\n\n') }));
  } catch (error) {
    console.error('[extract] generation failed', error);
    return NextResponse.json({ error: 'model_failed' }, { status: 503, headers: NO_STORE });
  }

  return NextResponse.json({ endpoints: clean(text) }, { headers: NO_STORE });
}

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * The CLI's own unwrapping, mirrored: a prose-wrapped object first, then a
 * bare array, then nothing. Whatever shape survives is filtered to what the
 * runner can hold — known methods, non-empty paths — because the CLI stamps
 * and merges whatever comes back without asking twice.
 */
function clean(raw: string): Endpoint[] {
  const found = fromObject(raw) ?? fromArray(raw) ?? [];
  return found.flatMap((e) => {
    if (!e || typeof e !== 'object') return [];
    const method = typeof e.method === 'string' ? e.method.toUpperCase() : '';
    const path = typeof e.path === 'string' ? e.path.trim() : '';
    if (!METHODS.has(method) || !path) return [];
    return [
      {
        method,
        path,
        line: typeof e.line === 'number' ? e.line : 0,
        handler: typeof e.handler === 'string' ? e.handler : '',
        middleware: Array.isArray(e.middleware)
          ? e.middleware.filter((m): m is string => typeof m === 'string')
          : [],
      },
    ];
  });
}

function fromObject(raw: string): Endpoint[] | null {
  const body = span(raw, '{', '}');
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { endpoints?: unknown };
    return Array.isArray(parsed.endpoints) ? (parsed.endpoints as Endpoint[]) : null;
  } catch {
    return null;
  }
}

function fromArray(raw: string): Endpoint[] | null {
  const body = span(raw, '[', ']');
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    return Array.isArray(parsed) ? (parsed as Endpoint[]) : null;
  } catch {
    return null;
  }
}

function span(raw: string, open: string, shut: string): string | null {
  const start = raw.indexOf(open);
  const end = raw.lastIndexOf(shut);
  if (start < 0 || end <= start) return null;
  return raw.slice(start, end + 1);
}
