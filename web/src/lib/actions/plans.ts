'use server';

import { revalidatePath } from 'next/cache';
import { clientIp } from '@/lib/client-ip';
import { record } from '@/lib/db/audit';
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
