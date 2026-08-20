import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { jobs, testExecutions, testPlans } from '@/lib/db/schema';
import type { TestPlanRow } from '@/lib/db/schema';

/**
 * The other half of the approval gate: what happens after you say yes.
 *
 * Nothing here runs a test. The web app cannot -- the code is on the developer's
 * machine and that is the point of the product -- so approving writes down what
 * should happen and stops. Two rows say it, and they are different kinds of fact:
 *
 * - a `test_executions` row, which is *the run*. It exists from the moment you ask
 *   for it, `pending`, with no `started_at`, and it is what the dashboard shows you
 *   and what the results will eventually hang off. Every id the UI links to comes
 *   from here.
 * - a `jobs` row, which is *the errand*. It carries retries, a claimant and a
 *   backoff, and it is the thing the CLI polls for. It is bookkeeping about the
 *   delivery, not about the test.
 *
 * Keeping them apart is what lets a job be retried three times without the run
 * appearing three times, and what lets the run exist while the CLI is offline. A
 * queued run on a laptop that is shut is not an error -- `CAP.md` calls this out:
 * the research channel fails closed, but approved work waits.
 */

/** What the CLI is handed. See `enqueueRun` for why the plan travels by value. */
type RunPayload = {
  executionPublicId: string;
  planPublicId: string;
  planName: string;
  planVersion: number;
  baseUrl: string;
  plan: unknown;
};

export type EnqueuedRun = {
  plan: TestPlanRow;
  /** The run, whether this call created it or found it already in flight. */
  executionPublicId: string;
  /** For the audit row, which names rows by their BIGINT id. Never leaves the server. */
  executionId: number;
  /** False when a live run already existed. Nothing was written; nothing is wrong. */
  created: boolean;
};

/**
 * Queue a run of an approved plan.
 *
 * The plan is matched on `(project_id, public_id, status = 'approved')` in one
 * statement, so an id arriving in a form body cannot name a plan in someone else's
 * project or a draft that was never approved. Null means no such plan, which is the
 * same answer for both and the only one a caller should act on.
 *
 * **The plan travels by value.** `payload.plan` is a copy of `plan_json` as it reads
 * right now, not a pointer to be dereferenced when the CLI gets around to it.
 * Approval is approval of *this text*, and a plan revised between the click and the
 * poll would otherwise run something nobody agreed to. `plan_version` is recorded on
 * the execution for the same reason, and the runs UI reads it back to say "v1,
 * yesterday" when a result describes text that has since moved on.
 *
 * **Queueing twice is not an error.** The insert defers to
 * `test_executions_one_live_idx`, so a second click conflicts instead of starting a
 * second container, and this reports the run that already exists with
 * `created: false`. The job is only written on the branch that created the run --
 * an errand per run, not per click.
 */
export async function enqueueRun(
  projectId: number,
  planPublicId: string,
): Promise<EnqueuedRun | null> {
  return db.transaction(async (tx) => {
    const [plan] = await tx
      .select()
      .from(testPlans)
      .where(
        and(
          eq(testPlans.projectId, projectId),
          eq(testPlans.publicId, planPublicId),
          eq(testPlans.status, 'approved'),
        ),
      )
      .limit(1);
    if (!plan) return null;

    const [execution] = await tx
      .insert(testExecutions)
      .values({
        testPlanId: plan.id,
        projectId,
        planVersion: plan.version,
        status: 'pending',
      })
      .onConflictDoNothing({
        target: testExecutions.testPlanId,
        where: sql`status IN ('pending', 'running')`,
      })
      .returning({ id: testExecutions.id, publicId: testExecutions.publicId });

    if (!execution) {
      // Something of this plan's is already pending or running. The index says so
      // and this is the row it collided with -- the caller wants to show it, not to
      // hear that the click failed.
      const [live] = await tx
        .select({ id: testExecutions.id, publicId: testExecutions.publicId })
        .from(testExecutions)
        .where(
          and(
            eq(testExecutions.testPlanId, plan.id),
            inArray(testExecutions.status, ['pending', 'running']),
          ),
        )
        .limit(1);
      // A run that settled between the conflict and this read leaves nothing to
      // point at. Rare, and honestly reported: try again.
      if (!live) return null;
      return { plan, executionPublicId: live.publicId, executionId: live.id, created: false };
    }

    const payload: RunPayload = {
      executionPublicId: execution.publicId,
      planPublicId: plan.publicId,
      planName: plan.name,
      planVersion: plan.version,
      baseUrl: plan.baseUrl,
      plan: plan.planJson,
    };

    await tx.insert(jobs).values({
      projectId,
      type: 'execute_tests',
      status: 'pending',
      payload,
    });

    return {
      plan,
      executionPublicId: execution.publicId,
      executionId: execution.id,
      created: true,
    };
  });
}
