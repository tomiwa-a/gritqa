'use server';

import { revalidatePath } from 'next/cache';
import { requireScope } from '@/lib/db/scope';
import { deleteProof } from '@/lib/db/endpoint-checks';
import { planDetail } from '@/lib/db/plans';
import { getAllPlans } from '@/lib/data';
import { writeRevision } from '@/lib/db/drafts';
import { record } from '@/lib/db/audit';
import { clientIp } from '@/lib/client-ip';

/**
 * Delete an invalid endpoint: the proof row goes, and every live plan stops
 * claiming it.
 *
 * Plans are revised, not edited in place: approval is approval of a particular
 * text, so a plan that loses coverage goes back to draft with a revision row
 * saying what left and why. Steps still naming the endpoint stay — they are
 * wrong, and the Look-again hand is where wrong steps get fixed — but a draft
 * cannot run, so nothing executes against a route that does not exist.
 */
export async function deleteInvalidEndpointAction(formData: FormData): Promise<void> {
  const method = String(formData.get('method') ?? '').trim().slice(0, 16);
  const path = String(formData.get('path') ?? '').trim().slice(0, 1024);
  if (!method || !path) return;

  const scope = await requireScope();

  await deleteProof(scope.projectId, method, path);

  const touched: string[] = [];
  const plans = await getAllPlans();
  for (const plan of plans) {
    if (plan.status === 'archived') continue;
    if (!plan.covers.some((c) => c.method === method && c.path === path)) continue;

    const detail = await planDetail(scope.projectId, plan.publicId);
    if (!detail) continue;
    const covers = detail.covers.filter((c) => !(c.method === method && c.path === path));
    if (covers.length === detail.covers.length) continue;

    await writeRevision({
      projectId: scope.projectId,
      userId: scope.userId,
      planPublicId: plan.publicId,
      fromVersion: detail.version,
      instruction: null,
      draft: {
        name: detail.name,
        description: detail.description,
        variables: detail.variables,
        covers,
        steps: detail.steps,
        assumptions: detail.assumptions,
        summary: `Removed ${method} ${path} from coverage: proved invalid.`,
        changes: [
          {
            kind: 'value_changed',
            stepName: 'coverage',
            detail: `Removed ${method} ${path}: no such endpoint.`,
          },
        ],
      },
      checks: detail.checks,
    });
    touched.push(plan.name);
  }

  await record({
    userId: scope.userId,
    action: 'endpoint.invalid_deleted',
    entityType: 'endpoint_checks',
    values: { method, path, plans: touched },
    ip: await clientIp(),
  });

  revalidatePath('/dashboard/test-plans');
  revalidatePath('/dashboard');
}
