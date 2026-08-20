/**
 * Executions and their step results.
 *
 * The mock kept these as two unrelated lists: six runs with a full step-by-step
 * report, and twenty-four older ones reduced to a string of `p`/`f`/`s` cells. The
 * cells did not agree with the plans they were attributed to -- a four-step plan
 * with a five-cell run -- because nothing joined them. Rows do join, so here a run
 * is a plan plus an outcome per step, and the cell string is read back out of
 * `test_results` rather than written down beside it.
 *
 * The six newest runs are pinned: their statuses, response codes and latencies are
 * transcribed from the mock so the run reports on screen are unchanged. Everything
 * older is generated from the plan's own body, which is the only way a history this
 * long can be consistent with the steps it claims to have run.
 *
 * Failures follow the plan's own `onFailure`. A step that aborts leaves the rest of
 * the run skipped, which is why a failed run rarely has exactly one bad cell.
 */
import { PLANS } from './plans.mjs';
import { DAY, HOUR } from './time.mjs';

/** Values a run would have substituted into the step URLs, so `request_url` is a URL. */
const RESOLVED = {
  authToken: 'tok_live_stub',
  userId: 'cus_8f2a41',
  customerId: 'cus_5b1e77',
  orderId: 'ord_9c34aa',
  refundId: 'ref_2f80b1',
  quoteId: 'qte_71ca09',
  checkoutId: 'ckt_44e2f8',
  subscriptionId: 'sub_0a91cd',
  payoutId: 'pyt_63bb20',
  cardId: 'crd_1de845',
  flagId: 'flg_77a3e1',
  taxTotal: '66750',
  providerEventId: 'evt_paystack_8842',
  testInvoiceId: 'inv_2026_0417',
};

export function resolveUrl(url, variables) {
  return url.replace(/\{\{(\w+)\}\}/g, (whole, name) => {
    if (RESOLVED[name] !== undefined) return RESOLVED[name];
    if (variables && variables[name] !== undefined) return String(variables[name]);
    return whole;
  });
}

/**
 * The route pattern a step's URL template names.
 *
 * The plan writes `/customers/{{userId}}/cards/{{cardId}}`; the rest of the app
 * talks in `/customers/:id/cards/:cardId`. Converting one to the other by rule
 * would mean deciding what each variable is called, and a blind `{{x}} -> :id`
 * gets `/customers/:id/cards/:id` -- a pattern that exists nowhere.
 *
 * So the plan is asked instead. `covers` already lists the endpoints the plan
 * claims, in pattern form, and a template matches one of them structurally: same
 * method, same number of segments, literals equal, and a variable wherever the
 * pattern has one. That is a lookup against the plan's own vocabulary rather than
 * a guess about naming. Of the fixture's 27 variable-bearing steps, 25 match this
 * way; the two that do not are `GET /subscriptions/{{subscriptionId}}` in a plan
 * that does not list it, and the fallback's `:id` is right there anyway.
 */
function matchesTemplate(pattern, segments) {
  const parts = pattern.split('/');
  if (parts.length !== segments.length) return false;
  return parts.every((part, i) =>
    segments[i].startsWith('{{') ? part.startsWith(':') : part === segments[i],
  );
}

export function patternOf(url, method, covers) {
  const segments = url.split('/');
  const covered = covers.find((e) => e.method === method && matchesTemplate(e.path, segments));
  if (covered) return covered.path;
  return segments.map((segment) => (segment.startsWith('{{') ? ':id' : segment)).join('/');
}

/** The status a passing run of this step would have returned. */
function expectedStatus(step) {
  const declared = step.assertions.find((a) => a.type === 'status' && a.operator === 'equals');
  return typeof declared?.expected === 'number' ? declared.expected : 200;
}

/**
 * A latency that is stable across re-seeds. `Math.random()` would churn every
 * column on every run of this script, which makes a diff of the database useless
 * for telling whether anything actually changed.
 */
function latency(runSeed, stepIndex) {
  let x = (runSeed * 2654435761 + stepIndex * 40503) % 2147483647;
  x = (x * 48271) % 2147483647;
  return 38 + (x % 165);
}

/** The six with a transcribed report — the newest run of each approved plan. */
const PINNED = [
  {
    plan: 'checkout_charge',
    status: 'failed',
    startedAgo: 12,
    durationMs: 4100,
    steps: [
      ['passed', 200, 84],
      ['passed', 200, 132],
      ['passed', 201, 148],
      ['failed', 500, 2210],
      ['skipped', null, null],
    ],
  },
  {
    plan: 'order_confirm',
    status: 'passed',
    startedAgo: 26,
    durationMs: 2900,
    steps: [
      ['passed', 200, 79],
      ['passed', 201, 141],
      ['passed', 201, 96],
      ['passed', 200, 173],
    ],
  },
  {
    plan: 'refund_paid',
    status: 'running',
    startedAgo: 0,
    durationMs: null,
    steps: [
      ['passed', 200, 81],
      ['passed', 201, 152],
      ['pending', null, null],
      ['pending', null, null],
    ],
  },
  {
    plan: 'auth_round_trip',
    status: 'passed',
    startedAgo: HOUR,
    durationMs: 1400,
    steps: [
      ['passed', 200, 77],
      ['passed', 200, 41],
      ['passed', 204, 38],
    ],
  },
  {
    plan: 'customer_crud',
    status: 'passed',
    startedAgo: 2 * HOUR,
    durationMs: 5200,
    steps: [
      ['passed', 200, 80],
      ['passed', 201, 128],
      ['passed', 200, 117],
      ['passed', 200, 64],
      ['passed', 204, 92],
    ],
  },
  {
    plan: 'subscription_lifecycle',
    status: 'failed',
    startedAgo: 3 * HOUR,
    durationMs: 3600,
    steps: [
      ['passed', 200, 83],
      ['passed', 201, 164],
      ['passed', 200, 109],
      ['failed', 409, 231],
    ],
  },
];

/**
 * How much history each approved plan has, and where it went wrong.
 *
 * `runs` counts the pinned run above as the first of them. `failures` are given as
 * `[nth-run-back, index of the step that broke]`, and their placement is the trend
 * the pass-rate cards read: failures bunched recently read as getting worse,
 * failures only in the distant past read as getting better.
 */
const SERIES = [
  { plan: 'customer_crud', runs: 31, spanDays: 70, failures: [[19, 4]] },
  {
    plan: 'auth_round_trip',
    runs: 44,
    spanDays: 70,
    failures: [
      [26, 2],
      [38, 1],
    ],
  },
  {
    plan: 'order_confirm',
    runs: 28,
    spanDays: 70,
    failures: [
      [17, 3],
      [21, 2],
      [24, 3],
      [27, 1],
    ],
  },
  {
    plan: 'checkout_charge',
    runs: 22,
    spanDays: 70,
    failures: [
      [3, 1],
      [7, 1],
    ],
  },
  {
    plan: 'refund_paid',
    runs: 17,
    spanDays: 70,
    failures: [
      [2, 2],
      [4, 1],
      [6, 2],
      [11, 2],
    ],
  },
  {
    plan: 'subscription_lifecycle',
    runs: 20,
    spanDays: 70,
    failures: [
      [5, 3],
      [13, 2],
    ],
  },
];

/**
 * Runs that belong to plans still in draft, or long archived.
 *
 * These are the three the mock declared as a `lastRun` with no report behind it,
 * and two of them are the reason `plan_version` exists: a draft that has been
 * refined since it last ran shows the run against the older text, which is the
 * only honest way to show it.
 *
 * Given as a failing step index rather than an outcome per step, so the skips come
 * from the plan's own `onFailure` instead of from a guess written here. That is
 * what corrects `partial_refund`: the mock declared three of its four steps passed,
 * but s3 aborts, so the read-back never ran and two passed. The number was never
 * checked against the plan it described.
 */
const STANDALONE = [
  {
    plan: 'partial_refund',
    planVersion: 1,
    startedAgo: DAY,
    // s3 refunded the whole order under v1, and it is an assertion that failed
    // rather than the request -- the call returned 200 and the wrong amount.
    failAt: 2,
    failStatus: 200,
    failure: {
      expected: 'data.amount equals 4500',
      actual: '9000',
      verdict: 'undecided',
    },
  },
  { plan: 'webhook_replay', planVersion: 2, startedAgo: 3 * DAY, failAt: null },
  { plan: 'admin_flag', planVersion: 2, startedAgo: 90 * DAY, failAt: 2 },
];

const planOf = (key) => {
  const found = PLANS.find((p) => p.key === key);
  if (!found) throw new Error(`No plan fixture keyed ${key}`);
  return found;
};

/**
 * A generated run: every step passes with the status its own assertions expect,
 * unless this is one of the failing runs -- in which case the named step returns a
 * 500 and, if it aborts, the rest never happen.
 */
function generatedSteps(plan, seed, failAt, failStatus = 500) {
  return plan.steps.map((step, i) => {
    if (failAt === null || i < failAt) {
      return ['passed', expectedStatus(step), latency(seed, i)];
    }
    if (i === failAt) return ['failed', failStatus, 1200 + latency(seed, i) * 4];
    const aborts = plan.steps[failAt].onFailure !== 'continue';
    return aborts ? ['skipped', null, null] : ['passed', expectedStatus(step), latency(seed, i)];
  });
}

/**
 * Every execution to seed, newest first.
 *
 * The version each run executed walks back with its age: the newest runs are
 * against the plan as it stands, the oldest against version 1. A plan that was
 * never revised has every run at version 1, and no run of it ever shows a version
 * prefix -- which is the behaviour that makes the prefix mean something.
 */
export function executions() {
  const out = [];

  for (const series of SERIES) {
    const plan = planOf(series.plan);
    const pinned = PINNED.find((p) => p.plan === series.plan);
    if (!pinned) throw new Error(`No pinned newest run for ${series.plan}`);

    const spacing = Math.floor((series.spanDays * DAY) / series.runs);
    const failures = new Map(series.failures.map(([nth, step]) => [nth, step]));

    for (let nth = 1; nth <= series.runs; nth += 1) {
      const version = Math.max(
        1,
        plan.version - Math.floor(((nth - 1) * plan.version) / series.runs),
      );
      if (nth === 1) {
        out.push({
          plan,
          planVersion: plan.version,
          status: pinned.status,
          startedAgo: pinned.startedAgo,
          durationMs: pinned.durationMs,
          steps: pinned.steps,
        });
        continue;
      }
      const failAt = failures.has(nth) ? failures.get(nth) : null;
      const steps = generatedSteps(plan, nth * 7 + plan.steps.length, failAt);
      out.push({
        plan,
        planVersion: version,
        status: failAt === null ? 'passed' : 'failed',
        startedAgo: pinned.startedAgo + (nth - 1) * spacing,
        durationMs: steps.reduce((n, [, , ms]) => n + (ms ?? 0), 0) + 600,
        steps,
      });
    }
  }

  for (const run of STANDALONE) {
    const plan = planOf(run.plan);
    const steps = generatedSteps(
      plan,
      run.startedAgo + plan.steps.length,
      run.failAt,
      run.failStatus,
    );
    out.push({
      plan,
      planVersion: run.planVersion,
      status: run.failAt === null ? 'passed' : 'failed',
      startedAgo: run.startedAgo,
      durationMs: steps.reduce((n, [, , ms]) => n + (ms ?? 0), 0) + 600,
      steps,
      failure: run.failure,
    });
  }

  return out.sort((a, b) => a.startedAgo - b.startedAgo);
}
