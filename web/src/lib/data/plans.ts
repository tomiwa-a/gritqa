import { cache } from 'react';
import { currentScope } from '@/lib/db/scope';
import { listPlanDetails, listPlans, planDetail, planPassRates } from '@/lib/db/plans';
import type { TestPlan, TestPlanDetail } from '@/lib/model';

export type { PlanPassRate } from '@/lib/db/plans';

/**
 * Plans, from `test_plans`.
 *
 * `cache` is what keeps the three list functions below from being three queries: a
 * dashboard render asks for the review queue and the settled plans and the whole
 * list, and they are one read filtered three ways. The filtering is here rather
 * than in SQL for the same reason -- a `where status =` per caller would cost a
 * round trip to answer a question the first read already answered.
 */
const allPlans = cache(async (): Promise<TestPlan[]> => {
  const scope = await currentScope();
  if (!scope) return [];
  return listPlans(scope.projectId);
});

/** Drafts, newest first. The queue a reviewer works down. */
export async function getPlansAwaitingReview(): Promise<TestPlan[]> {
  return (await allPlans()).filter((plan) => plan.status === 'draft');
}

/** Approved and archived: decided, and no longer asking for anything. */
export async function getSettledPlans(): Promise<TestPlan[]> {
  return (await allPlans()).filter((plan) => plan.status !== 'draft');
}

export async function getAllPlans(): Promise<TestPlan[]> {
  return allPlans();
}

export const getPlanPassRates = cache(async () => {
  const scope = await currentScope();
  if (!scope) return [];
  return planPassRates(scope.projectId);
});

export const getPlanDetails = cache(async (): Promise<TestPlanDetail[]> => {
  const scope = await currentScope();
  if (!scope) return [];
  return listPlanDetails(scope.projectId);
});

/**
 * One plan with its steps. Undefined now means the id is not a plan of this
 * project -- either a stale link or someone else's plan, and the pages that handle
 * the gap already render the right thing for both.
 */
export const getPlanDetail = cache(
  async (publicId: string): Promise<TestPlanDetail | undefined> => {
    const scope = await currentScope();
    if (!scope) return undefined;
    return planDetail(scope.projectId, publicId);
  },
);
