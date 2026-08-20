'use server';

import { revalidatePath } from 'next/cache';
import { clientIp } from '@/lib/client-ip';
import { record } from '@/lib/db/audit';
import { enqueueRun } from '@/lib/db/jobs';
import { movePlanStatus } from '@/lib/db/plans';
import { requireScope } from '@/lib/db/scope';
import type { TestPlanRow } from '@/lib/db/schema';

/**
 * The approval gate.
 *
 * This is the sentence the product is built around -- nothing runs until you say so
 * -- and until now it was four buttons that did nothing. A decision is a status
 * transition and an audit row, in that order: the plan really moved, and the log says
 * who moved it and what it was called at the time.
 *
 * Three outcomes, not two. "Send back" and "Archive" both land on `archived`, because
 * the column has three states and a rejected draft is not a fourth one -- but they are
 * different events to anyone reading the timeline later, so they are logged as
 * different actions. Rejecting a draft is a verdict on work that was never used;
 * archiving an approved plan is retiring something that ran.
 *
 * None of them accepts a project. The scope comes from the session and the plan is
 * matched inside it, so a form cannot name a plan the developer does not own.
 */
function publicIdOf(formData: FormData): string {
  return String(formData.get('publicId') ?? '')
    .trim()
    .slice(0, 64);
}

/**
 * Four pages read a plan's status, and a fifth reads the timeline.
 *
 * Spelled out rather than looped, because the reason each one is stale is different:
 * the queue lost a row, the plans table shows a new badge, the overview's coverage
 * counts approved plans only, and the plan's own page is the one being looked at.
 */
function revalidateDecision(publicId: string): void {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/queue');
  revalidatePath('/dashboard/test-plans');
  revalidatePath(`/dashboard/test-plans/${publicId}`);
  revalidatePath('/dashboard/settings/activity');
}

/**
 * A queued run is a new row in three lists and a new page of its own.
 *
 * The plan's page is in here too, and for a different reason than the decisions
 * above: it reads `lastRun`, and the run just queued is now the last one -- which
 * is what turns `Ask to run` into `Queued` without a second query.
 */
function revalidateRun(planPublicId: string, executionPublicId: string): void {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/runs');
  revalidatePath(`/dashboard/runs/${executionPublicId}`);
  revalidatePath('/dashboard/test-plans');
  revalidatePath(`/dashboard/test-plans/${planPublicId}`);
  revalidatePath('/dashboard/settings/activity');
}

/**
 * One entry per decision, phrased from the row after the write.
 *
 * The name travels into `new_values` rather than being joined for later, which is the
 * rule the whole log follows: a plan renamed next month should still read under the
 * name it had when it was approved.
 */
async function log(action: string, row: TestPlanRow, userId: number): Promise<void> {
  await record({
    userId,
    action,
    entityType: 'test_plans',
    entityId: row.id,
    values: { name: row.name, status: row.status, version: row.version },
    ip: await clientIp(),
  });
}

export async function approvePlanAction(formData: FormData): Promise<void> {
  const publicId = publicIdOf(formData);
  if (!publicId) return;

  const scope = await requireScope();
  const row = await movePlanStatus(scope.projectId, publicId, ['draft'], 'approved');
  if (!row) return;

  await log('test_plan.approved', row, scope.userId);
  revalidateDecision(publicId);
}

/** A draft nobody wants. Archived, and logged as the rejection it is. */
export async function sendBackPlanAction(formData: FormData): Promise<void> {
  const publicId = publicIdOf(formData);
  if (!publicId) return;

  const scope = await requireScope();
  const row = await movePlanStatus(scope.projectId, publicId, ['draft'], 'archived');
  if (!row) return;

  await log('test_plan.rejected', row, scope.userId);
  revalidateDecision(publicId);
}

/** Retiring a plan that was approved. The runs it produced stay where they are. */
export async function archivePlanAction(formData: FormData): Promise<void> {
  const publicId = publicIdOf(formData);
  if (!publicId) return;

  const scope = await requireScope();
  const row = await movePlanStatus(scope.projectId, publicId, ['approved'], 'archived');
  if (!row) return;

  await log('test_plan.archived', row, scope.userId);
  revalidateDecision(publicId);
}

/**
 * Ask the machine to run an approved plan.
 *
 * The whole write is in `enqueueRun`: a `pending` execution, which is the run, and
 * an `execute_tests` job, which is the errand. Nothing here waits for either -- the
 * CLI polls, and a laptop that is closed makes this a run that has not started
 * rather than a run that failed.
 *
 * `created: false` means a run of this plan was already in flight. That is not a
 * failure and it is not logged twice: one entry per run, and the run already has
 * one. Revalidating anyway is deliberate -- whoever clicked is looking at a page
 * that does not know about the run yet.
 */
export async function runPlanAction(formData: FormData): Promise<void> {
  const publicId = publicIdOf(formData);
  if (!publicId) return;

  const scope = await requireScope();
  const queued = await enqueueRun(scope.projectId, publicId);
  if (!queued) return;

  if (queued.created) {
    await record({
      userId: scope.userId,
      action: 'test_execution.queued',
      entityType: 'test_executions',
      entityId: queued.executionId,
      values: { name: queued.plan.name, planVersion: queued.plan.version },
      ip: await clientIp(),
    });
  }

  revalidateRun(publicId, queued.executionPublicId);
}

/**
 * The two-in-one button: approve the draft, then queue the run.
 *
 * Written as approve-then-run rather than as a third kind of write, so both halves
 * keep the guards they already have. The approval only moves a `draft`, and the
 * queue only accepts an `approved` plan -- which means a replay of this form
 * approves nothing the second time and queues nothing either, and a plan somebody
 * else already approved still runs. The composition is idempotent because each
 * half is.
 *
 * Two audit rows, not one. The decision and the run are separate events and the
 * timeline should read as two lines: a plan was approved, and a run was asked for.
 */
export async function approveAndRunPlanAction(formData: FormData): Promise<void> {
  const publicId = publicIdOf(formData);
  if (!publicId) return;

  const scope = await requireScope();
  const approved = await movePlanStatus(scope.projectId, publicId, ['draft'], 'approved');
  if (approved) {
    await log('test_plan.approved', approved, scope.userId);
    revalidateDecision(publicId);
  }

  await runPlanAction(formData);
}
