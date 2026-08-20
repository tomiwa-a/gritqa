/**
 * The audit timeline, as facts rather than sentences.
 *
 * The mock wrote each entry's prose by hand, so nothing could recompute it and the
 * phrasing could not be changed without editing history. Here a row carries the
 * action, the entity it touched, and the values needed to phrase it -- the subject's
 * name included, because a log should say what a thing was called at the time rather
 * than what it is called now.
 *
 * `ip` changes partway down on purpose. The two oldest entries were a different
 * machine on a different network, which is the sort of thing an audit log exists to
 * make visible.
 */
import { DAY, HOUR } from './plans.mjs';

const HERE = '102.89.34.7';
const ELSEWHERE = '41.58.120.19';

/** [minutes ago, action, entity table, values, ip] */
export const ACTIVITY = [
  [4, 'project.indexed', 'codebase_index', { name: 'payments-api', branch: 'main' }, HERE],
  [
    12,
    'test_execution.completed',
    'test_executions',
    { name: 'Charge a checkout with a mocked provider', failedStep: 4 },
    HERE,
  ],
  [
    2 * HOUR,
    'test_plan.created',
    'test_plans',
    { name: 'Checkout applies the right tax rate', triggerSource: 'git_push' },
    HERE,
  ],
  [
    3 * HOUR,
    'test_plan.approved',
    'test_plans',
    { name: 'Webhook replay is idempotent', status: 'approved' },
    HERE,
  ],
  [
    26 * HOUR,
    'testing_rule.updated',
    'testing_rules',
    { name: 'Pagination envelope', isActive: false },
    HERE,
  ],
  [30 * HOUR, 'mock_endpoint.created', 'mock_endpoints', { name: 'Stripe webhook' }, HERE],
  [3 * DAY, 'user.ai_key.updated', 'users', { replaced: false }, HERE],
  [5 * DAY, 'project.created', 'projects', { name: 'notifications', source: 'CLI' }, ELSEWHERE],
  [5 * DAY + 20, 'user.login', 'users', { provider: 'GitHub' }, ELSEWHERE],
];
