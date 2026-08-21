import { cache } from 'react';
import { currentScope } from '@/lib/db/scope';
import { lastBaseUrl, listPlanDetails, listPlans, planDetail, planPassRates } from '@/lib/db/plans';
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

/**
 * What to prefill the generate wizard's address field with, and null when there is
 * nothing to prefill it from.
 *
 * Null rather than a plausible localhost port. `test_plans.base_url` is the address
 * a run actually calls, so a guessed value in a prefilled field is a guess the
 * developer can submit without reading -- and this project's real base URL is
 * `http://localhost/hotel/api/`, which no default would have arrived at. The form
 * shows the shape as a placeholder instead, which teaches the format without
 * claiming to know the address.
 *
 * Copied from the last plan when there is one, because the second draft against a
 * project runs where the first one did.
 */
export async function getLastBaseUrl(): Promise<string | null> {
  const scope = await currentScope();
  if (!scope) return null;
  return await lastBaseUrl(scope.projectId);
}
