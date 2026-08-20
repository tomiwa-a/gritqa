import { gunzipSync, gzipSync } from 'node:zlib';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditLogs } from '@/lib/db/schema';
import { agoLabel } from '@/lib/when';
import type { AuditEntry, AuditTone } from '@/lib/model';

/**
 * The audit log: what happened, and enough of it to read back as a sentence.
 *
 * `audit_logs` stores the fact -- an action, an entity, a time -- and not the
 * sentence. The mock stored the sentence, which is why every row had a hand-written
 * `label` and `tone` that nothing could recompute. Phrasing belongs here, in the read
 * model, where it is derived from the action and can be changed without rewriting
 * history.
 *
 * The subject's name travels in `new_values` rather than being joined for. A log
 * says what a thing was called when it happened: join to `testing_rules` and a
 * renamed rule reads under its new name, a deleted one reads as nothing at all, and
 * "Pagination envelope turned off" becomes unrecoverable the moment someone tidies
 * up. Storing it is what makes the row a record instead of a view.
 */
type Values = Record<string, unknown>;

/** `entity_type` is a table name, and the grouping the UI colours by follows from it. */
const TONES: Record<string, AuditTone> = {
  test_plans: 'plan',
  plan_revisions: 'plan',
  test_executions: 'run',
  testing_rules: 'rule',
  mock_endpoints: 'rule',
  projects: 'project',
  codebase_index: 'project',
  users: 'account',
  device_codes: 'account',
};

function pack(values: Values | null | undefined): Buffer | null {
  if (!values) return null;
  return gzipSync(Buffer.from(JSON.stringify(values), 'utf8'));
}

function unpack(blob: Buffer | null): Values {
  if (!blob || blob.length === 0) return {};
  try {
    return JSON.parse(gunzipSync(blob).toString('utf8')) as Values;
  } catch {
    // A row we cannot read is still a row that happened. Losing the detail costs a
    // vaguer sentence; throwing would lose the entry.
    return {};
  }
}

const text = (values: Values, key: string): string | null => {
  const value = values[key];
  return typeof value === 'string' && value ? value : null;
};

/**
 * The sentence for a row, in the log's own voice: subject first, verb last, so a
 * column of them scans as a list of things that happened rather than a list of
 * events that have subjects.
 *
 * An unrecognised action still renders. It reads plainly rather than well, which is
 * the right failure for a table anything is allowed to append to.
 */
const NOUNS: Record<string, string> = {
  test_plans: 'A plan',
  plan_revisions: 'A plan',
  test_executions: 'A run',
  testing_rules: 'A rule',
  mock_endpoints: 'A mock',
  projects: 'A project',
  codebase_index: 'A project',
  users: 'Your account',
  device_codes: 'A machine',
};

function labelFor(action: string, entityType: string, values: Values): string {
  const name = text(values, 'name');
  const subject = name ?? NOUNS[entityType] ?? 'Something';

  switch (action) {
    case 'project.indexed': {
      const branch = text(values, 'branch');
      return branch ? `${subject} re-read after a push to ${branch}` : `${subject} re-read`;
    }
    case 'project.created': {
      const source = text(values, 'source');
      return source ? `${subject} added from the ${source}` : `${subject} added`;
    }
    case 'test_plan.created': {
      const from = values.triggerSource === 'git_push' ? ' from a push' : '';
      return `${subject} drafted${from}`;
    }
    case 'test_plan.approved':
      return `${subject} approved by you`;
    case 'test_plan.archived':
      return `${subject} archived`;
    case 'test_plan.revised': {
      const version = values.version;
      return typeof version === 'number'
        ? `${subject} redrafted as v${version}`
        : `${subject} redrafted`;
    }
    case 'test_execution.completed': {
      const step = values.failedStep;
      if (typeof step === 'number') return `${subject} failed on step ${step}`;
      return `${subject} passed`;
    }
    case 'testing_rule.created':
      return `${subject} added`;
    case 'testing_rule.deleted':
      return `${subject} removed`;
    case 'testing_rule.updated': {
      if (values.isActive === false) return `${subject} turned off`;
      if (values.isActive === true) return `${subject} turned on`;
      return `${subject} updated`;
    }
    case 'mock_endpoint.created':
      return `${subject} mock added`;
    case 'user.ai_key.updated':
      // The key itself is never in the row -- not a prefix, not a length. `replaced`
      // is the whole payload, and it is only here because "added" and "replaced" are
      // different events to anyone reading back why drafting started working.
      return values.replaced === false ? 'AI key added' : 'AI key replaced';
    case 'user.ai_key.removed':
      return 'AI key removed';
    case 'user.login': {
      const provider = text(values, 'provider');
      return provider ? `Signed in with ${provider}` : 'Signed in';
    }
    case 'device.approved': {
      const host = text(values, 'hostname');
      return host ? `${host} approved for the CLI` : 'A machine approved for the CLI';
    }
    case 'device.denied': {
      const host = text(values, 'hostname');
      return host ? `${host} denied` : 'A machine denied';
    }
    default:
      return name ? `${action} — ${name}` : action;
  }
}

export type AuditInput = {
  userId: number | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  /** Enough of the new state to phrase the row later, plus whatever else changed. */
  values?: Values | null;
  previous?: Values | null;
  ip?: string | null;
  at?: Date;
};

/**
 * Appends one row, and never throws.
 *
 * An action that succeeded should not be reported as failed because its audit row
 * did not land -- the rule really was turned off, and surfacing a write error here
 * would roll back the developer's edit for the sake of the record of it. The failure
 * goes to the server log, which is where an operator looks.
 */
export async function record(entry: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      oldValues: pack(entry.previous),
      newValues: pack(entry.values),
      ipAddress: entry.ip ?? null,
      ...(entry.at ? { createdAt: entry.at } : {}),
    });
  } catch (error) {
    console.error('audit: could not append', entry.action, error);
  }
}

/**
 * The newest entries for one user's work.
 *
 * Scoped by user rather than by project, because `audit_logs` has no `project_id`
 * and adding one would be wrong: `user.login` and `user.ai_key.updated` belong to
 * an account, not to a codebase, and a project column would have to be null for
 * exactly the rows an account timeline most wants.
 */
export async function listAudit(userId: number, limit = 40): Promise<AuditEntry[]> {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.userId, userId))
    // By time, not by id. A real append gets both in the same order, but the seeded
    // timeline is backdated onto sequential ids, and a log that lists yesterday above
    // last week is answering "in what order were these written down" -- which is not
    // the question anyone asks it.
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit);

  return rows.map((row) => {
    const values = unpack(row.newValues);
    return {
      id: row.id,
      action: row.action,
      label: labelFor(row.action, row.entityType, values),
      tone: TONES[row.entityType] ?? 'account',
      whenLabel: agoLabel(row.createdAt),
      createdAt: row.createdAt.toISOString(),
      ip: row.ipAddress ?? '—',
    };
  });
}
