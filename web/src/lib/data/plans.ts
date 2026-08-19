import { allPlans, planPassRates, plansAwaitingReview, settledPlans } from '@/lib/mock/data';
import { planDetailFor, planDetails } from '@/lib/mock/plans';
import type { TestPlan, TestPlanDetail } from '@/lib/mock/types';

/**
 * A plan's pass rate over its recent runs. Inferred from the source rather than
 * declared, so the shape cannot drift from what the charts already read; it needs a
 * real type when it becomes an aggregate over `test_executions`.
 */
export type PlanPassRate = (typeof planPassRates)[number];

export async function getPlansAwaitingReview(): Promise<TestPlan[]> {
  return plansAwaitingReview;
}

export async function getSettledPlans(): Promise<TestPlan[]> {
  return settledPlans;
}

export async function getAllPlans(): Promise<TestPlan[]> {
  return allPlans;
}

export async function getPlanPassRates(): Promise<PlanPassRate[]> {
  return planPassRates;
}

export async function getPlanDetails(): Promise<TestPlanDetail[]> {
  return planDetails;
}

/**
 * One plan with its steps. Returns undefined for four of the plans on record — the
 * detail is genuinely absent, not pending, and callers already handle the gap.
 */
export async function getPlanDetail(publicId: string): Promise<TestPlanDetail | undefined> {
  return planDetailFor(publicId);
}
