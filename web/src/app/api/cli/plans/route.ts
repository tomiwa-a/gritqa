import { NextResponse } from 'next/server';
import { z } from 'zod';
import { endpointSchema, stepInconsistency, stepSchema } from '@/lib/agent/plan-schema';
import { cliScope, savePlan, touchInstance } from '@/lib/db/cli';
import { unloadable } from '@/lib/plan';

/**
 * A plan drafted at a terminal, into the record.
 *
 * **The file under `.gritqa/drafts/` is the cache; this is the plan.** Before this
 * route a draft written by `gritqa --draft` existed only on the machine that wrote it,
 * which had two consequences worth stating: nobody else on the team could read it, and
 * the run that came out of it had nowhere to hang, because `test_executions` requires
 * a plan row. So this is a prerequisite of `/api/cli/executions` rather than a
 * convenience beside it.
 *
 * Pushing the same plan twice is not an error and does not bump anything. The CLI
 * remembers which plan a draft file became and sends it back as `planId`; the version
 * moves only when the text actually differs, so a machine that re-pushes on every boot
 * does not walk an approved plan back to `draft` for nothing.
 *
 * Validated with the same schemas the model's output goes through -- `stepSchema`,
 * `stepInconsistency`, `unloadable` -- rather than a looser check of its own. A plan
 * arriving from a terminal reaches exactly the screens a plan arriving from a
 * conversation does, so a second opinion about what a step may look like would show up
 * as a plan page that cannot render one of them.
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

  const parsed = pushSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_plan', detail: parsed.error.issues[0]?.message ?? '' },
      { status: 400, headers: NO_STORE },
    );
  }
  const push = parsed.data;

  /* Two checks the shape cannot make. A step whose assertions do not belong to its
     kind is one the runner would refuse, and a `{{name}}` that resolves to nothing is
     a plan that declines at the first step -- both worth refusing here rather than
     letting them sit on the queue looking runnable. */
  for (const [i, step] of push.steps.entries()) {
    const wrong = stepInconsistency(step);
    if (wrong) {
      return NextResponse.json(
        { error: 'invalid_plan', detail: `step ${i + 1} (${step.id}) ${wrong}` },
        { status: 400, headers: NO_STORE },
      );
    }
  }
  const bad = unloadable({ variables: push.variables, steps: push.steps });
  if (bad) {
    return NextResponse.json(
      { error: 'invalid_plan', detail: bad },
      { status: 400, headers: NO_STORE },
    );
  }

  const saved = await savePlan(scope, {
    planPublicId: push.planId ?? null,
    name: push.name,
    description: push.description || null,
    baseUrl: push.baseUrl,
    /* Assembled here rather than taken as one blob, because the column's shape is the
       web's to decide: `checks` is a verdict this writer has no way to have, and it
       reads as unverified when it is absent. */
    planJson: {
      variables: push.variables,
      covers: push.covers,
      steps: push.steps,
      assumptions: push.assumptions,
      checks: [],
    },
    summary: push.summary || 'Drafted on a developer’s machine.',
  });

  await touchInstance(scope.projectId, { instanceId: push.instanceId });

  if (!saved.ok) {
    /* `unknown` is 404 and `archived` is 409, which is the difference between "there is
       no such plan here" and "there is, and it is not accepting new text". */
    const status = saved.reason === 'archived' ? 409 : 404;
    return NextResponse.json({ error: saved.reason }, { status, headers: NO_STORE });
  }

  return NextResponse.json(
    { ok: true, planId: saved.publicId, version: saved.version, changed: saved.changed },
    { headers: NO_STORE },
  );
}

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Bounds, so one push cannot be a way to fill a database. A plan a person can read is
 * nowhere near any of these -- the largest thing the drafter has produced is eleven
 * steps.
 */
const MAX_STEPS = 200;
const MAX_COVERS = 500;
const MAX_ASSUMPTIONS = 100;

const pushSchema = z.object({
  instanceId: z.string().trim().min(1).max(255),
  /** Absent for a plan that did not exist; the CLI remembers it after the first push. */
  planId: z.string().trim().min(1).max(64).nullish(),
  name: z.string().trim().min(1).max(255),
  description: z.string().max(4_000).default(''),
  baseUrl: z.string().trim().min(1).max(2_048),
  variables: z.record(z.string().max(255), z.string().max(4_000)),
  steps: z.array(stepSchema).min(1).max(MAX_STEPS),
  covers: z.array(endpointSchema).max(MAX_COVERS).default([]),
  assumptions: z.array(z.string().max(2_000)).max(MAX_ASSUMPTIONS).default([]),
  /** One line for the revision thread. Defaulted rather than required. */
  summary: z.string().max(1_000).optional(),
});
