'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { clientIp } from '@/lib/client-ip';
import { record } from '@/lib/db/audit';
import { PlanArchivedError, PlanMovedError, writeNewPlan, writeRevision } from '@/lib/db/drafts';
import { planDetail } from '@/lib/db/plans';
import { requireScope } from '@/lib/db/scope';
import { revisionSchema } from '@/lib/agent/plan-schema';
import {
  changesBetween,
  checksAfter,
  noteOn,
  planProblems,
  type EditedPlan,
} from '@/lib/plan-edit';

/**
 * Writing a plan by hand, and editing one.
 *
 * The same two writers the agent uses, with the model taken out of the middle. That
 * is the whole of it: `writeRevision` does not care who decided, and `plan_revisions`
 * already distinguishes the two by `author`, so a hand edit is a first-class version
 * of the plan rather than a second kind of thing.
 *
 * What is not taken out is the gate. A hand-built plan goes through `planProblems`
 * before it is stored, so a step that could never run is refused in the form rather
 * than on the machine that would have tried it.
 */

/** A note is a sentence about the edit, not a pasted file. */
const MAX_NOTE = 2_000;

/** A plan with a hundred steps and pasted bodies, and not much more. */
const MAX_PLAN = 512_000;

/** Exactly what a person edits: the plan, without the account of how it got here. */
const editedSchema = revisionSchema.omit({ summary: true, changes: true });

export type EditState = null | { error: string } | { ok: true; version: number; summary: string };

function revalidatePlan(publicId: string): void {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/queue');
  revalidatePath('/dashboard/test-plans');
  revalidatePath(`/dashboard/test-plans/${publicId}`);
  revalidatePath('/dashboard/settings/activity');
}

/**
 * The submitted plan, or the reason it is not one.
 *
 * Parsed rather than trusted: the working copy lives in the browser, so this is the
 * boundary, and `editedSchema` is the same shape the agent's output is held to.
 */
function submitted(formData: FormData): EditedPlan | string {
  const raw = String(formData.get('plan') ?? '');
  if (!raw) return 'Nothing was submitted. Reload the page and try again.';
  if (raw.length > MAX_PLAN) return 'That plan is too large to save.';

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return 'The editor sent something GritQA could not read. Reload the page and try again.';
  }

  const parsed = editedSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return `That plan is not a shape GritQA can store: ${first.path.join('.') || 'the plan'} ${first.message.toLowerCase()}.`;
  }
  return parsed.data;
}

/** The first problem, and how many others are waiting behind it. */
function refusal(plan: EditedPlan): string | null {
  const problems = planProblems(plan);
  if (problems.length === 0) return null;
  const rest = problems.length - 1;
  return rest > 0
    ? `${problems[0].problem} And ${rest} other ${rest === 1 ? 'problem' : 'problems'}.`
    : problems[0].problem;
}

function readable(error: unknown): string {
  if (error instanceof PlanMovedError) {
    return 'This plan changed while you were editing it. Reload the page — your edit is still here — and save again.';
  }
  if (error instanceof PlanArchivedError) {
    return 'This plan is archived. Restore it before editing it.';
  }
  console.error('edit: could not write the plan', error);
  return 'GritQA could not save that. Try again.';
}

export async function savePlanEditAction(
  _previous: EditState,
  formData: FormData,
): Promise<EditState> {
  const publicId = String(formData.get('publicId') ?? '')
    .trim()
    .slice(0, 64);
  const fromVersion = Number(formData.get('fromVersion'));
  const note =
    String(formData.get('note') ?? '')
      .trim()
      .slice(0, MAX_NOTE) || null;

  if (!publicId || !Number.isInteger(fromVersion)) {
    return { error: 'Reload the page and try again.' };
  }

  const edited = submitted(formData);
  if (typeof edited === 'string') return { error: edited };

  const bad = refusal(edited);
  if (bad) return { error: bad };

  const scope = await requireScope();
  const detail = await planDetail(scope.projectId, publicId);
  if (!detail) return { error: 'That plan is not in this project any more.' };

  /* Checked here as well as in the write, because the diff below is computed against
     `detail` -- so a stale working copy would otherwise produce a truthful-looking
     account of a change from text nobody is looking at. */
  if (detail.version !== fromVersion) return { error: readable(new PlanMovedError(fromVersion)) };

  const changes = changesBetween(
    {
      name: detail.name,
      description: detail.description,
      variables: detail.variables,
      covers: detail.covers,
      steps: detail.steps,
      assumptions: detail.assumptions,
    },
    edited,
  );
  if (changes.length === 0) {
    return { error: 'Nothing about this plan has changed, so there is no new version to write.' };
  }

  const summary = noteOn(changes);

  try {
    const written = await writeRevision({
      projectId: scope.projectId,
      userId: scope.userId,
      planPublicId: publicId,
      fromVersion,
      /* Never null: `writeRevision` reads a null instruction as the agent acting on
         its own, and a hand edit is the one thing that certainly was not that. */
      instruction: note ?? 'Edited by hand.',
      draft: { ...edited, summary, changes },
      /* Only the verdicts the edit did not invalidate. A check on a step somebody has
         since rewritten is a check on text that is no longer in the plan. */
      checks: checksAfter(detail.steps, edited.steps, detail.checks),
    });

    await record({
      userId: scope.userId,
      action: 'test_plan.revised',
      entityType: 'test_plans',
      entityId: written.planId,
      values: { name: edited.name, version: written.version, by: 'hand' },
      ip: await clientIp(),
    });

    revalidatePlan(publicId);
    return { ok: true, version: written.version, summary };
  } catch (error) {
    return { error: readable(error) };
  }
}

export type BuildState = null | { error: string };

export async function createPlanByHandAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const baseUrl = baseUrlOf(String(formData.get('baseUrl') ?? '').trim());
  const note =
    String(formData.get('note') ?? '')
      .trim()
      .slice(0, MAX_NOTE) || null;

  if (!baseUrl) {
    return { error: 'That address is not a URL GritQA can call. Try http://localhost:8080.' };
  }

  const built = submitted(formData);
  if (typeof built === 'string') return { error: built };

  const bad = refusal(built);
  if (bad) return { error: bad };

  const scope = await requireScope();

  let written: Awaited<ReturnType<typeof writeNewPlan>>;
  try {
    written = await writeNewPlan({
      projectId: scope.projectId,
      userId: scope.userId,
      baseUrl,
      instruction: note ?? 'Written by hand.',
      draft: { ...built, summary: built.description.trim() || 'Written by hand.' },
    });

    await record({
      userId: scope.userId,
      action: 'test_plan.drafted',
      entityType: 'test_plans',
      entityId: written.planId,
      values: { name: written.name, steps: built.steps.length, by: 'hand' },
      ip: await clientIp(),
    });
  } catch (error) {
    return { error: readable(error) };
  }

  revalidatePlan(written.publicId);
  redirect(`/dashboard/test-plans/${written.publicId}`);
}

function baseUrlOf(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
